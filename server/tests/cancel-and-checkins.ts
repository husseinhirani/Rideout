import { test } from "node:test"
import assert from "node:assert/strict"
const reducers = await import("../spacetimedb/src/index")
import { storeHarness } from "./store-harness"
import { cancelRefusal } from "../src/loop"
const r = reducers as unknown as Record<string, (...args: any[]) => any>
function coordinated() {
  const s = storeHarness()
  for (const [id, name, phone] of [[1n, "Child", ""], [2n, "Alex", "+15550000002"], [3n, "Sam", "+15550000003"]] as const) s.db.profile.insert({ id, name, phone, lat: 0, lng: 0, contact_profile_ids: [] })
  s.db.supportCase.insert({ id: 1n, incident_id: 1n, victim_profile_id: 1n, goal: "Find child", status: "open", brief: "" })
  s.run(r.enableCoordination, { support_case_id: 1n, helper_profile_ids: [2n, 3n] })
  s.run(r.commitCoordinationPlan, { support_case_id: 1n, expected_revision: s.rows.caseProgress[0].input_revision, calls_json: JSON.stringify([{ profile_id: 2, ask: "Can you check?", context: "Child is missing" }]) })
  return s
}
test("a queued call cancels without counting as input or against the budget", () => {
  const s = coordinated(); const revision = s.rows.caseProgress[0].input_revision
  s.run(r.cancelAttempt, { attempt_id: 1n })
  assert.equal(s.rows.attemptProgress[0].transport, "cancelled"); assert.equal(s.rows.attempt[0].outcome, "cancelled")
  assert.equal(s.rows.caseProgress[0].input_revision, revision)
  assert.throws(() => s.run(r.cancelAttempt, { attempt_id: 1n }), /already finished/)
})
test("a simulated active call ends; a real or dispatching call is refused", () => {
  const s = coordinated(); s.run(r.claimCoordinationAttempt, { attempt_id: 1n, claim_token: "w" })
  assert.throws(() => s.run(r.cancelAttempt, { attempt_id: 1n }), /being placed/)
  s.run(r.recordCoordinationDispatch, { attempt_id: 1n, claim_token: "w", call_id: "sim_1", error: "" })
  s.run(r.cancelAttempt, { attempt_id: 1n }); assert.equal(s.rows.attemptProgress[0].transport, "ended")
  const real = coordinated(); real.run(r.claimCoordinationAttempt, { attempt_id: 1n, claim_token: "w" })
  real.run(r.recordCoordinationDispatch, { attempt_id: 1n, claim_token: "w", call_id: "ca_real", error: "" })
  assert.throws(() => real.run(r.cancelAttempt, { attempt_id: 1n }), /cannot be ended/)
  assert.equal(real.rows.attemptProgress[0].transport, "active")
})
test("route refusals match the reducer", () => {
  const row = (call_id: string | null, outcome: string | null = null) => ({ id: 1, support_case_id: 1, profile_id: 2, ask: "", call_id, outcome, answer: "", concern: "", created_at: "" })
  assert.equal(cancelRefusal(row(null), "queued"), "")
  assert.equal(cancelRefusal(row("sim_1"), "active"), "")
  assert.match(cancelRefusal(row("ca_1"), "active"), /cannot be ended/)
  assert.match(cancelRefusal(row("ca_1"), "unknown"), /cannot be ended/)
  assert.equal(cancelRefusal(row("sim_1"), undefined), "")
  assert.match(cancelRefusal(row("ca_1"), undefined), /live call/)
  assert.match(cancelRefusal(row("sim_1", "answered"), undefined), /outcome/)
})
test("an unanswered check-in becomes unknown and a late answer still lands", () => {
  const s = storeHarness()
  s.db.profile.insert({ id: 1n, name: "Helen", phone: "+15550000001", lat: 0, lng: 0, contact_profile_ids: [] })
  s.run(r.createIncident, { type: "wildfire", description: "drill", lat: 0, lng: 0, radius_m: 100 })
  s.run(r.markCheckInUnanswered, { incident_id: 1n, profile_id: 1n })
  assert.equal(s.rows.incidentPerson[0].status, "unknown")
  s.run(r.recordCheckIn, { incident_id: 1n, profile_id: 1n, result: "victim" })
  assert.equal(s.rows.incidentPerson[0].status, "victim"); assert.equal(s.rows.supportCase.length, 1)
  s.run(r.markCheckInUnanswered, { incident_id: 1n, profile_id: 1n })
  assert.equal(s.rows.incidentPerson[0].status, "victim")
})
