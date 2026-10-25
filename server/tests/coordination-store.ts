import { test } from "node:test"
import assert from "node:assert/strict"
const reducers = await import("../spacetimedb/src/index")
import { storeHarness } from "./store-harness"
const r = reducers as unknown as Record<string, (...args: any[]) => any>
function fixture() {
  const s = storeHarness()
  for (const [id, name, phone] of [[1n, "Parent", "+15550000001"], [2n, "Alex", "+15550000002"], [3n, "Sam", "+15550000003"]] as const) s.db.profile.insert({ id, name, phone, lat: 0, lng: 0, contact_profile_ids: [] })
  s.db.supportCase.insert({ id: 1n, incident_id: 1n, victim_profile_id: 1n, goal: "Find child", status: "open", brief: "" })
  s.run(r.enableCoordination, { support_case_id: 1n, helper_profile_ids: [2n, 3n] }); return s
}
const call = (id = 2) => ({ profile_id: id, ask: "Can you check?", context: "Child is missing" })
function plan(s: ReturnType<typeof fixture>, calls = [call()]) { s.run(r.commitCoordinationPlan, { support_case_id: 1n, expected_revision: s.rows.caseProgress[0].input_revision, calls_json: JSON.stringify(calls) }) }
function claim(s: ReturnType<typeof fixture>, id = 1n, token = "worker1") { s.run(r.claimCoordinationAttempt, { attempt_id: id, claim_token: token }) }
function receive(s: ReturnType<typeof fixture>, id = 1n) { s.run(r.receiveCoordinationReport, { attempt_id: id, answer: "I will check", concern: "" }) }
function finish(s: ReturnType<typeof fixture>, id = 1n) { s.run(r.finishCoordinationReport, { attempt_id: id, reached: true, accepted: true, notes_json: JSON.stringify([{ text: "Checking park", has_place: false, lat: 0, lng: 0, radius_m: 0 }]), concern: "" }) }
test("enabling validates helpers and preserves configuration", () => {
  const s = fixture(); s.run(r.enableCoordination, { support_case_id: 1n, helper_profile_ids: [2n, 3n] }); assert.equal(s.rows.caseProgress.length, 1)
  assert.throws(() => s.run(r.enableCoordination, { support_case_id: 1n, helper_profile_ids: [2n, 2n] }))
})
test("stale plans, pending reports and double commits cannot create calls", () => {
  const s = fixture(); plan(s); assert.throws(() => plan(s)); claim(s); receive(s)
  assert.throws(() => plan(s, [call(3)])); assert.equal(s.rows.attempt.length, 1)
  assert.throws(() => s.run(r.commitCoordinationPlan, { support_case_id: 1n, expected_revision: 1n, calls_json: "[]" }))
})
test("raw report survives before processing; delivery and processing are idempotent", () => {
  const s = fixture(); plan(s); claim(s); receive(s)
  assert.equal(s.rows.attempt[0].answer, "I will check"); assert.equal(s.rows.attemptProgress[0].report_processed, false)
  const revision = s.rows.caseProgress[0].input_revision; receive(s); assert.equal(s.rows.caseProgress[0].input_revision, revision)
  assert.throws(() => s.run(r.receiveCoordinationReport, { attempt_id: 1n, answer: "Different", concern: "" }))
  s.time(5_000); finish(s); finish(s); receive(s)
  assert.equal(s.rows.note.length, 1); assert.equal(s.rows.note[0].text, "Alex: Checking park")
  assert.equal(s.rows.attemptProgress[0].accepted_at_ms, 1_000); assert.equal(s.rows.attemptProgress[0].transport, "dispatching")
})
test("claim has one winner and dispatch errors remain unknown across ticks", () => {
  const s = fixture(); plan(s); claim(s); assert.throws(() => claim(s, 1n, "worker2"))
  assert.throws(() => s.run(r.recordCoordinationDispatch, { attempt_id: 1n, claim_token: "worker2", call_id: "x", error: "" }))
  s.run(r.recordCoordinationDispatch, { attempt_id: 1n, claim_token: "worker1", call_id: "", error: "network timeout" })
  s.time(500_000); s.run(r.tickCoordination, { support_case_id: 1n })
  assert.equal(s.rows.attemptProgress[0].transport, "unknown"); assert.equal(s.rows.attempt[0].outcome, undefined)
  assert.throws(() => plan(s))
})
test("closure cancels queued calls and late reports never reopen", () => {
  const s = fixture(); plan(s, [call(), call(3)]); claim(s); s.run(r.setCaseStatus, { support_case_id: 1n, status: "closed" })
  assert.equal(s.rows.attemptProgress[1].transport, "cancelled"); assert.throws(() => claim(s, 2n))
  receive(s); finish(s); assert.equal(s.rows.supportCase[0].status, "closed"); assert.throws(() => plan(s))
})
test("ten-second acceptance review is consumed once; retry requires ended transport", () => {
  const s = fixture(); plan(s); claim(s); receive(s); finish(s); plan(s, [])
  const revision = s.rows.caseProgress[0].input_revision
  s.time(10_999); s.run(r.tickCoordination, { support_case_id: 1n }); assert.equal(s.rows.caseProgress[0].input_revision, revision)
  s.time(11_000); s.run(r.tickCoordination, { support_case_id: 1n }); assert.equal(s.rows.caseProgress[0].input_revision, revision + 1n)
  s.run(r.tickCoordination, { support_case_id: 1n }); assert.equal(s.rows.caseProgress[0].input_revision, revision + 1n); assert.throws(() => plan(s))
  s.run(r.markCoordinationEnded, { attempt_id: 1n, end_reason: "completed" }); plan(s); assert.equal(s.rows.attempt.length, 2)
})
test("invalid whole proposal and notes roll back without partial writes", () => {
  const s = fixture(); assert.throws(() => plan(s, [call(), call(1)])); assert.equal(s.rows.attempt.length, 0)
  plan(s); claim(s); receive(s)
  assert.throws(() => s.run(r.finishCoordinationReport, { attempt_id: 1n, reached: true, accepted: true, notes_json: '[{"text":"valid","has_place":false},{"text":""}]', concern: "" }))
  assert.equal(s.rows.note.length, 0); assert.equal(s.rows.attemptProgress[0].report_processed, false)
})
test("failure backoff is bounded and ticks do not create a hot loop", () => {
  const s = fixture(); const revision = s.rows.caseProgress[0].input_revision
  const fail = () => s.run(r.recordCoordinationFailure, { support_case_id: 1n, expected_revision: revision, message: "model unavailable" })
  fail(); assert.equal(s.rows.caseProgress[0].retry_at_ms, 3_000)
  s.time(3_000); fail(); assert.equal(s.rows.caseProgress[0].retry_at_ms, 7_000)
  s.time(7_000); fail(); assert.equal(s.rows.caseProgress[0].failure_count, 3); assert.equal(s.rows.caseProgress[0].blocked_reason, "model unavailable")
  s.time(1_000_000); s.run(r.tickCoordination, { support_case_id: 1n }); assert.equal(s.rows.caseProgress[0].input_revision, revision); assert.equal(s.rows.caseProgress[0].failure_count, 3)
})
test("legacy reducers cannot bypass coordinated attempt state", () => {
  const s = fixture(); plan(s)
  assert.throws(() => s.run(r.addAttempt, { support_case_id: 1n, profile_id: 2n, ask: "Bypass" }))
  assert.throws(() => s.run(r.recordAnswer, { attempt_id: 1n, outcome: "no_answer", answer: "", concern: "" }))
  assert.throws(() => s.run(r.setAttemptCall, { attempt_id: 1n, call_id: "unclaimed" }))
})
test("new input cancels queued work and releases its helper budget", () => {
  const s = fixture()
  for (let i = 0; i < 3; i++) {
    plan(s)
    s.run(r.addNote, { support_case_id: 1n, attempt_id: 0n, source: "dispatcher", text: "New input", has_place: false, lat: 0, lng: 0, radius_m: 0 })
  }
  plan(s); claim(s, 4n)
  assert.deepEqual(s.rows.attemptProgress.map(p => p.transport), ["cancelled", "cancelled", "cancelled", "dispatching"])
})
test("same destination cannot be claimed across cases or against any legacy outcome", () => {
  const s = fixture(); plan(s); claim(s)
  s.db.supportCase.insert({ ...s.rows.supportCase[0], id: 2n })
  s.run(r.enableCoordination, { support_case_id: 2n, helper_profile_ids: [2n, 3n] })
  s.run(r.commitCoordinationPlan, { support_case_id: 2n, expected_revision: 1n, calls_json: JSON.stringify([call()]) })
  assert.throws(() => claim(s, 2n)); assert.equal(s.rows.attemptProgress[1].transport, "queued")
  s.run(r.markCoordinationEnded, { attempt_id: 1n, end_reason: "completed" })
  s.db.attempt.insert({ ...s.rows.attempt[0], id: 3n, support_case_id: 3n, outcome: undefined })
  assert.throws(() => claim(s, 2n))
  for (const outcome of ["answered", "no_answer", "superseded"]) {
    s.db.attempt.id.update({ ...s.rows.attempt[2], outcome })
    assert.throws(() => claim(s, 2n))
    assert.equal(s.rows.attemptProgress[1].transport, "queued")
  }
})
test("claim expiry is unknown exactly once and never requeues", () => {
  const s = fixture(); plan(s); claim(s)
  s.time(60_999); s.run(r.tickCoordination, { support_case_id: 1n }); assert.equal(s.rows.attemptProgress[0].transport, "dispatching")
  s.time(61_000); s.run(r.tickCoordination, { support_case_id: 1n }); assert.equal(s.rows.attemptProgress[0].transport, "unknown")
  const revision = s.rows.caseProgress[0].input_revision
  s.time(90_000); s.run(r.tickCoordination, { support_case_id: 1n }); assert.equal(s.rows.caseProgress[0].input_revision, revision)
  assert.throws(() => claim(s))
})
test("early simulated report ends only when matching simulated dispatch is recorded", () => {
  for (const callId of ["sim_one", "live_one"]) {
    const s = fixture(); plan(s); claim(s); receive(s); finish(s)
    s.run(r.recordCoordinationDispatch, { attempt_id: 1n, claim_token: "worker1", call_id: callId, error: "" })
    assert.equal(s.rows.attemptProgress[0].transport, callId.startsWith("sim_") ? "ended" : "active")
    s.run(r.markCoordinationEnded, { attempt_id: 1n, end_reason: "completed" })
    s.run(r.recordCoordinationDispatch, { attempt_id: 1n, claim_token: "worker1", call_id: callId, error: "" })
    assert.equal(s.rows.attemptProgress[0].transport, "ended")
  }
})
test("third helper call is rejected even after both earlier calls ended", () => {
  const s = fixture(); plan(s); claim(s); receive(s); finish(s)
  s.run(r.markCoordinationEnded, { attempt_id: 1n, end_reason: "completed" }); s.time(11_000); plan(s)
  claim(s, 2n); receive(s, 2n); finish(s, 2n); s.run(r.markCoordinationEnded, { attempt_id: 2n, end_reason: "completed" })
  s.time(21_000); assert.throws(() => plan(s)); assert.equal(s.rows.attempt.length, 2)
})
test("receipt clears failure block and preserves raw concern after normalization", () => {
  const s = fixture(); plan(s); claim(s)
  s.run(r.addNote, { support_case_id: 1n, attempt_id: 0n, source: "dispatcher", text: "New input", has_place: false, lat: 0, lng: 0, radius_m: 0 })
  for (const now of [1_000, 3_000, 7_000]) {
    s.time(now); s.run(r.recordCoordinationFailure, { support_case_id: 1n, expected_revision: 2n, message: "offline" })
  }
  assert.equal(s.rows.caseProgress[0].failure_count, 3)
  s.run(r.receiveCoordinationReport, { attempt_id: 1n, answer: "Road is blocked", concern: "Smoke" })
  assert.equal(s.rows.caseProgress[0].failure_count, 0); assert.equal(s.rows.caseProgress[0].blocked_reason, "")
  s.run(r.finishCoordinationReport, { attempt_id: 1n, reached: true, accepted: false, notes_json: "[]", concern: "Unsafe route" })
  s.run(r.receiveCoordinationReport, { attempt_id: 1n, answer: "Road is blocked", concern: "Smoke" })
  assert.equal(s.rows.attempt[0].answer, "Road is blocked"); assert.equal(s.rows.attempt[0].concern, "Smoke; Unsafe route")
  assert.equal(s.rows.note.at(-1).source, "concern"); assert.equal(s.rows.attemptProgress[0].accepted_at_ms, undefined)
})
test("enable rejects untracked legacy calls, duplicate phones and incident victims", () => {
  for (const invalid of ["legacy", "phone", "victim"]) {
    const s = fixture(); s.rows.caseProgress.length = 0
    if (invalid === "legacy") s.db.attempt.insert({ id: 1n, support_case_id: 1n })
    if (invalid === "phone") s.db.profile.id.update({ ...s.rows.profile[2], phone: s.rows.profile[1].phone })
    if (invalid === "victim") s.db.incidentPerson.insert({ id: 1n, incident_id: 1n, profile_id: 2n, status: "victim" })
    assert.throws(() => s.run(r.enableCoordination, { support_case_id: 1n, helper_profile_ids: [2n, 3n] }))
  }
})
test("notes cannot attach an attempt from a different case", () => {
  const s = fixture(); plan(s)
  s.db.supportCase.insert({ ...s.rows.supportCase[0], id: 2n })
  assert.throws(() => s.run(r.addNote, { support_case_id: 2n, attempt_id: 1n, source: "call", text: "Wrong case", has_place: false, lat: 0, lng: 0, radius_m: 0 }))
  assert.equal(s.rows.note.length, 0)
})

test("dispatch errors remain durable without replacing raw report concerns", () => {
  const s = fixture(); plan(s); claim(s)
  assert.equal(s.rows.attemptProgress[0].dispatch_error, "")
  s.run(r.recordCoordinationDispatch, { attempt_id: 1n, claim_token: "worker1", call_id: "", error: "Connection reset after request" })
  assert.equal(s.rows.attemptProgress[0].dispatch_error, "Connection reset after request")
  receive(s); finish(s)
  assert.equal(s.rows.attemptProgress[0].dispatch_error, "Connection reset after request")
  assert.equal(s.rows.attempt[0].concern, "")
})
test("blank reports reject before writing receipt, raw data or revision", () => {
  const s = fixture(); plan(s); claim(s)
  for (const answer of ["", " \n\t "]) {
    const before = structuredClone(s.rows)
    assert.throws(() => s.run(r.receiveCoordinationReport, { attempt_id: 1n, answer, concern: "Smoke" }))
    assert.deepEqual(s.rows, before)
  }
})
test("losing planner cannot record failure against an already committed revision", () => {
  const s = fixture(); plan(s)
  s.run(r.recordCoordinationFailure, { support_case_id: 1n, expected_revision: 1n, message: "Concurrent plan rejected" })
  assert.equal(s.rows.caseProgress[0].failure_count, 0)
  assert.equal(s.rows.caseProgress[0].retry_at_ms, undefined)
})
test("durable case and incident briefs reflect latest reports, waiting, blocked and closure", () => {
  const s = fixture(); s.db.incident.insert({ id: 1n, brief: "" }); plan(s)
  assert.match(JSON.parse(s.rows.supportCase[0].brief).summary, /waiting/i)
  claim(s); receive(s); finish(s)
  assert.match(JSON.parse(s.rows.supportCase[0].brief).summary, /Alex: Checking park/)
  assert.match(JSON.parse(s.rows.supportCase[0].brief).summary, /not verified/i)
  assert.match(JSON.parse(s.rows.incident[0].brief).summary, /Alex: Checking park/)
  const expected_revision = s.rows.caseProgress[0].input_revision
  for (const now of [1_000, 3_000, 7_000]) {
    s.time(now); s.run(r.recordCoordinationFailure, { support_case_id: 1n, expected_revision, message: "Planner unavailable" })
  }
  assert.match(JSON.parse(s.rows.supportCase[0].brief).summary, /blocked.*Planner unavailable/i)
  s.run(r.setCaseStatus, { support_case_id: 1n, status: "closed" })
  assert.match(JSON.parse(s.rows.supportCase[0].brief).summary, /closed/i)
})

test("late legacy summaries cannot overwrite coordinated case or incident state", () => {
  const s = fixture()
  s.db.incident.insert({id:1n,type:"missing",description:"Child missing",area:{lat:0,lng:0,radius_m:0},status:"active",brief:"",created_at:undefined})
  s.run(r.setCaseStatus,{support_case_id:1n,status:"closed"})
  const caseBrief=s.rows.supportCase[0].brief, incidentBrief=s.rows.incident[0].brief
  s.run(r.setBrief,{support_case_id:1n,brief:"outdated model summary"})
  s.run(r.setIncidentBrief,{incident_id:1n,brief:"outdated model summary"})
  assert.equal(s.rows.supportCase[0].brief,caseBrief)
  assert.equal(s.rows.incident[0].brief,incidentBrief)
})

test("expected stale plan rejection is a sender error", () => {
  const s=fixture();plan(s)
  assert.throws(()=>plan(s),{name:"SenderError",message:/Stale/})
})
