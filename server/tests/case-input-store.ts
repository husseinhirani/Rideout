import { test } from "node:test"
import assert from "node:assert/strict"
import { storeHarness } from "./store-harness"
const r = await import("../spacetimedb/src/index") as unknown as Record<string, (...args: any[]) => any>
const intake = { child: { name: "Ava", description: "Red coat", last_seen_location_id: "park-bench", last_seen_time: "about 3pm" }, reporter: { name: "Ana", relationship: "mother" } }
const input = { event_key: "intake-1", reporter_profile_id: 1n, helper_profile_ids: [2n, 3n], intake_json: JSON.stringify(intake) }
function fixture(open = true) {
  const s = storeHarness()
  for (const [id, name] of [[1n, "Ana"], [2n, "Alex"], [3n, "Sam"], [4n, "Other"]] as const) s.db.profile.insert({ id, name, phone: `+1555000000${id}`, lat: 0, lng: 0, contact_profile_ids: [] })
  if (open) s.run(r.recordCaseIntake, input)
  return s
}
const update = { event_key: "update-1", support_case_id: 1n, reporter_profile_id: 2n, text: "I may have found her" }
const confirmation = { event_key: "confirmation-1", support_case_id: 1n, reporter_profile_id: 1n, child_identity_confirmed: true, reunited: true, text: "She is with me" }
test("complete intake atomically creates attributed facts and no calls; semantic replay is inert", () => {
  const s = fixture()
  assert.equal(s.rows.supportCase.length, 1); assert.equal(s.rows.incident.length, 1)
  assert.equal(s.rows.profile[4].phone, ""); assert.deepEqual(s.rows.profile[4].contact_profile_ids, [1n, 2n, 3n])
  assert.equal(s.rows.caseIntake[0].last_seen_time, "about 3pm")
  assert.equal(s.rows.caseProgress[0].input_revision, 1n); assert.equal(s.rows.attempt.length, 0)
  assert.equal(s.rows.note[0].attempt_id, undefined); assert.match(s.rows.note[0].text, /Ana.*unverified intake/)
  const before = structuredClone(s.rows)
  s.run(r.recordCaseIntake, { ...input, intake_json: JSON.stringify({ reporter: intake.reporter, child: { ...intake.child, name: " Ava " } }) })
  assert.deepEqual(structuredClone(s.rows), before)
})
test("incomplete intake, unknown profiles, duplicate destinations and event conflicts leave no writes", () => {
  const s = fixture(false), before = structuredClone(s.rows)
  for (const args of [
    { ...input, intake_json: JSON.stringify({ ...intake, child: { ...intake.child, last_seen_time: "unknown" } }) },
    { ...input, reporter_profile_id: 99n }, { ...input, helper_profile_ids: [1n, 2n] }, { ...input, helper_profile_ids: [2n, 2n] },
  ]) { assert.throws(() => s.run(r.recordCaseIntake, args)); assert.deepEqual(structuredClone(s.rows), before) }
  s.db.profile.id.update({ ...s.rows.profile[2], phone: s.rows.profile[0].phone })
  assert.throws(() => s.run(r.recordCaseIntake, input)); assert.equal(s.rows.caseInput.length, 0)
  const opened = fixture(), snapshot = structuredClone(opened.rows)
  assert.throws(() => opened.run(r.recordCaseIntake, { ...input, intake_json: JSON.stringify({ ...intake, child: { ...intake.child, name: "Other" } }) }))
  assert.throws(() => opened.run(r.recordCaseUpdate, { ...update, event_key: input.event_key }))
  assert.deepEqual(structuredClone(opened.rows), snapshot)
})
test("participant updates preserve raw text; possible find never closes; replay and conflicts are atomic", () => {
  const s = fixture(); s.run(r.recordCaseUpdate, update)
  assert.equal(s.rows.supportCase[0].status, "open"); assert.match(s.rows.note[1].text, /Alex.*I may have found her/)
  assert.equal(s.rows.attempt.length, 0); assert.equal(s.rows.caseProgress[0].input_revision, 2n)
  const snapshot = structuredClone(s.rows)
  s.run(r.recordCaseUpdate, update); assert.deepEqual(structuredClone(s.rows), snapshot)
  for (const args of [{ ...update, text: "Different" }, { ...update, support_case_id: 2n }, { ...update, event_key: "unknown", reporter_profile_id: 4n }]) assert.throws(() => s.run(r.recordCaseUpdate, args))
  assert.deepEqual(structuredClone(s.rows), snapshot)
})
test("only original reporter with both explicit confirmations closes and cancels queued work", () => {
  const s = fixture()
  assert.throws(() => s.run(r.recordReunionConfirmation, { ...confirmation, reporter_profile_id: 2n }))
  assert.equal(s.rows.caseInput.length, 1)
  for (const [index, flags] of [[false, false], [false, true], [true, false]].entries()) {
    s.run(r.recordReunionConfirmation, { ...confirmation, event_key: `partial-${index}`, child_identity_confirmed: flags[0], reunited: flags[1] })
    assert.equal(s.rows.supportCase[0].status, "open"); assert.equal(s.rows.caseIntake[0].reunion_confirmed, false)
  }
  s.run(r.commitCoordinationPlan, { support_case_id: 1n, expected_revision: s.rows.caseProgress[0].input_revision, calls_json: JSON.stringify([{ profile_id: 2, ask: "Check?", context: "Missing child" }]) })
  s.time(5000); s.run(r.recordReunionConfirmation, confirmation)
  assert.equal(s.rows.supportCase[0].status, "closed"); assert.equal(s.rows.caseIntake[0].reunion_confirmed, true)
  assert.equal(s.rows.caseIntake[0].confirmed_at.microsSinceUnixEpoch, 5_000_000n)
  assert.equal(s.rows.attemptProgress[0].transport, "cancelled")
  const snapshot = structuredClone(s.rows)
  s.run(r.recordReunionConfirmation, confirmation); s.run(r.recordCaseIntake, input)
  assert.deepEqual(structuredClone(s.rows), snapshot)
  assert.throws(() => s.run(r.recordReunionConfirmation, { ...confirmation, reunited: false }))
  s.run(r.recordCaseUpdate, update)
  assert.equal(s.rows.supportCase[0].status, "closed"); assert.match(s.rows.note.at(-1).text, /I may have found her/)
  assert.equal(s.rows.supportCase.length, 1)
})

test("expected input conflicts are sender errors rather than runtime failures", () => {
  const s=fixture()
  assert.throws(()=>s.run(r.recordCaseIntake,{...input,intake_json:JSON.stringify({...intake,child:{...intake.child,name:"Other"}})}),{name:"SenderError",message:/different input/})
})
