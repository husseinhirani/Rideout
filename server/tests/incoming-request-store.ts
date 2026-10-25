import { test } from "node:test"
import assert from "node:assert/strict"
import { storeHarness } from "./store-harness"
const r = await import("../spacetimedb/src/index") as unknown as Record<string, (...args: any[]) => any>
const received = { provider_call_id: "ac_inbound", from_phone: "+15555550104", direction: "inbound", text: "My child is missing" }
const prepared = { request_id: 1n, expected_revision: 1n, decision_json: '{"kind":"update"}', status: "prepared", reply: "Your report is being recorded." }
function fixture() { const s = storeHarness(); s.run(r.receiveIncomingRequest, received); return s }

test("inbound receipt persists once and rejects changed text or metadata atomically", () => {
  const s = fixture(), before = structuredClone(s.rows)
  s.run(r.receiveIncomingRequest, received)
  assert.deepEqual(structuredClone(s.rows), before)
  assert.equal(s.rows.incomingRequest[0].status, "pending")
  for (const patch of [{ text: "Different" }, { from_phone: "+15555550105" }, { direction: "outbound" }]) {
    assert.throws(() => s.run(r.receiveIncomingRequest, { ...received, ...patch }))
    assert.deepEqual(structuredClone(s.rows), before)
  }
})
test("bound metadata rejects placeholders, missing fields, invalid direction and oversized text", () => {
  const s = storeHarness()
  for (const patch of [{ provider_call_id: "{{system__conversation_id}}" }, { provider_call_id: "" }, { from_phone: "unknown" }, { direction: "outbound" }, { text: " " }, { text: "x".repeat(20_001) }]) {
    assert.throws(() => s.run(r.receiveIncomingRequest, { ...received, ...patch }))
    assert.equal(s.rows.incomingRequest.length, 0)
  }
})
test("clarification permits a replacement transcript and rejects the prior revision", () => {
  const s = fixture()
  s.run(r.prepareIncomingRequest, { ...prepared, status: "needs_clarification", decision_json: "{}", reply: "What is the child's name?" })
  s.run(r.receiveIncomingRequest, { ...received, text: "My child Ava is missing" })
  assert.equal(s.rows.incomingRequest[0].revision, 2n)
  assert.equal(s.rows.incomingRequest[0].status, "pending")
  assert.equal(s.rows.incomingRequest[0].decision_json, "")
  assert.throws(() => s.run(r.prepareIncomingRequest, prepared))
})
test("prepared decision is immutable and recording completion replays only exactly", () => {
  const s = fixture(); s.run(r.prepareIncomingRequest, prepared)
  const before = structuredClone(s.rows)
  assert.throws(() => s.run(r.prepareIncomingRequest, { ...prepared, decision_json: '{"kind":"intake"}' }))
  assert.deepEqual(structuredClone(s.rows), before)
  const finish = { request_id: 1n, expected_revision: 1n, support_case_id: 3n, reply: "Your report is recorded." }
  s.run(r.finishIncomingRequest, finish)
  s.run(r.finishIncomingRequest, finish)
  assert.equal(s.rows.incomingRequest[0].support_case_id, 3n)
  assert.throws(() => s.run(r.finishIncomingRequest, { ...finish, support_case_id: 4n }))
})
test("failures back off and stop after three while retaining a prepared decision", () => {
  const s = fixture(); s.run(r.prepareIncomingRequest, prepared)
  const args = { request_id: 1n, expected_revision: 1n }
  s.run(r.failIncomingRequest, args)
  assert.equal(s.rows.incomingRequest[0].retry_at_ms, 3000n)
  assert.equal(s.rows.incomingRequest[0].status, "prepared")
  s.time(3000); s.run(r.failIncomingRequest, args)
  assert.equal(s.rows.incomingRequest[0].retry_at_ms, 7000n)
  s.time(7000); s.run(r.failIncomingRequest, args)
  assert.equal(s.rows.incomingRequest[0].status, "needs_review")
  assert.equal(s.rows.incomingRequest[0].decision_json, prepared.decision_json)
  assert.throws(() => s.run(r.failIncomingRequest, args))
})
test("invalid prepared JSON and completion before preparation leave receipt unchanged", () => {
  const s = fixture(), before = structuredClone(s.rows)
  assert.throws(() => s.run(r.prepareIncomingRequest, { ...prepared, decision_json: "bad" }))
  assert.throws(() => s.run(r.finishIncomingRequest, { request_id: 1n, expected_revision: 1n, support_case_id: 2n, reply: "Recorded" }))
  assert.deepEqual(structuredClone(s.rows), before)
})
