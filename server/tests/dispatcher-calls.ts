import { test } from "node:test"
import assert from "node:assert/strict"
import { storeHarness } from "./store-harness"
const r = await import("../spacetimedb/src/index") as unknown as Record<string, (...args: any[]) => any>

test("human call log binds one call, deduplicates transcript, and rejects stale guidance", () => {
  const s = storeHarness()
  s.db.profile.insert({ id: 1n, name: "Alex", phone: "+14155550123", lat: 0, lng: 0, contact_profile_ids: [] })
  s.db.supportCase.insert({ id: 1n, incident_id: 1n, victim_profile_id: 1n, goal: "Find child", status: "open", brief: "" })
  s.run(r.openDispatcherCall, { id: "call-one", support_case_id: 1n, profile_id: 1n })
  assert.throws(() => s.run(r.openDispatcherCall, { id: "call-one", support_case_id: 1n, profile_id: 1n }))
  s.run(r.connectDispatcherCall, { id: "call-one", call_sid: "CAone" })
  s.run(r.progressDispatcherCall, { id: "call-one", call_sid: "CAone", status: "ringing" })
  s.run(r.progressDispatcherCall, { id: "call-one", call_sid: "CAone", status: "active" })
  s.run(r.progressDispatcherCall, { id: "call-one", call_sid: "CAone", status: "ringing" })
  assert.equal(s.rows.dispatcherCall[0].status, "active")
  assert.throws(() => s.run(r.connectDispatcherCall, { id: "call-one", call_sid: "CAtwo" }))
  const line = { id: "call-one", call_sid: "CAone", key: "GTone:outbound_track:2", speaker: "resident", text: "I saw a red backpack" }
  s.run(r.appendDispatcherTranscript, line)
  s.run(r.appendDispatcherTranscript, line)
  assert.equal(JSON.parse(s.rows.dispatcherCall[0].transcript).length, 1)
  s.run(r.setDispatcherGuidance, { id: "call-one", line_count: 0n, guidance: "stale" })
  assert.equal(s.rows.dispatcherCall[0].guidance, "")
  s.run(r.setDispatcherGuidance, { id: "call-one", line_count: 1n, guidance: "Ask where" })
  assert.equal(s.rows.dispatcherCall[0].guidance, "Ask where")
  s.run(r.finishDispatcherCall, { id: "call-one", status: "completed" })
  s.run(r.appendDispatcherTranscript, { ...line, key: "GTone:outbound_track:3" })
  assert.equal(JSON.parse(s.rows.dispatcherCall[0].transcript).length, 2)
  assert.equal(s.rows.dispatcherCall[0].status, "completed")
})
