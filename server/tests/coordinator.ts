import assert from "node:assert/strict"
import { test } from "node:test"
import { evaluateCase, type CaseSnapshot } from "../src/coordinator"

function snapshot(): CaseSnapshot {
  return {
    case_id: 7, status: "open", now: 20_000,
    child: { name: "Ava", description: "Red coat", last_seen_location_id: "bench", last_seen_at: "15:00" },
    reporter: { name: "Alex", relationship: "parent (self-reported)" },
    helpers: [
      { profile_id: 2, name: "Blair", phone: "+15555550102", location_id: "bench", available: true },
      { profile_id: 3, name: "Casey", phone: "+15555550103", location_id: "playground", available: true },
    ],
    locations: [{ id: "bench", label: "Park bench" }, { id: "playground", label: "Playground" }],
    reports: [{ id: "obs_1", source_name: "Alex", text: "Ava was last seen at the park bench.", received_at: 0 }],
    attempts: [],
  }
}

const call = (profile_id = 2) => ({ profile_id, ask: "Can you check the park bench?", context: "Ava was reported missing." })
const proposal = (ids = [2, 3]) => ({ reason: "Check the two known locations.", calls: ids.map(call) })
const attempt = (overrides: Partial<CaseSnapshot["attempts"][number]> = {}): CaseSnapshot["attempts"][number] => ({
  id: 1, profile_id: 2, ask: "Check the bench?", answer: "I can check.", transport: "ended", accepted_at: 10_000, ...overrides,
})

test("allows two independent initial conversations without exposing phone fields to the planner", async () => {
  const state = snapshot()
  let received: Record<string, unknown> = {}
  const result = await evaluateCase(state, async context => { received = context; return proposal() })
  assert.equal(result.status, "planned")
  assert.equal(result.calls.length, 2)
  assert.ok(!JSON.stringify(received).includes("+1555555"))
  assert.deepEqual(received.reports, state.reports)
  assert.deepEqual(received.locations, state.locations)
})

test("uses the latest attributed report in a due follow-up while retaining its history", async () => {
  const state = snapshot()
  state.attempts = [attempt()]
  state.reports.push({ id: "obs_2", source_name: "Casey", text: "Someone matching Ava is near the playground.", received_at: 19_000 })
  const changed = { ...call(), ask: "Casey reports a possible sighting. Can you check the playground?" }
  const result = await evaluateCase(state, async context => {
    assert.deepEqual(context.reports, state.reports)
    assert.deepEqual(context.attempts, state.attempts)
    return { calls: [changed], reason: "Follow the new attributed sighting." }
  })
  assert.equal(result.status, "planned")
  assert.deepEqual(result.calls, [changed])
  assert.equal(state.attempts.length, 1, "evaluation must not mutate persisted work")
})

test("waits until ten seconds after acceptance before permitting that helper's follow-up", async () => {
  const state = snapshot()
  state.now = 19_999
  state.attempts = [attempt()]
  const result = await evaluateCase(state, async () => proposal([2]))
  assert.equal(result.status, "rejected")
  assert.deepEqual(result.calls, [])
})

for (const transport of ["active", "unknown"] as const) {
  test(`an ${transport} prior call blocks same-destination outreach, even after acceptance and deadline`, async () => {
    const state = snapshot()
    state.attempts = [attempt({ transport })]
    assert.equal((await evaluateCase(state, async () => proposal([2]))).status, "rejected")
    assert.equal((await evaluateCase(state, async () => proposal([3]))).status, "planned")
  })
}

test("a second profile with the same destination cannot bypass an active call", async () => {
  const state = snapshot()
  state.helpers[1].phone = state.helpers[0].phone
  state.attempts = [attempt({ transport: "active" })]
  assert.deepEqual((await evaluateCase(state, async () => proposal([3]))).calls, [])
})

test("rejects duplicate destinations in a proposal atomically", async () => {
  const state = snapshot()
  state.helpers[1].phone = state.helpers[0].phone
  const result = await evaluateCase(state, async () => proposal())
  assert.equal(result.status, "rejected")
  assert.deepEqual(result.calls, [])
})

test("rejects invented and repeated targets without substituting or partially authorizing", async () => {
  for (const ids of [[2, 999], [2, 2], [2, 3, 2]]) {
    const result = await evaluateCase(snapshot(), async () => proposal(ids))
    assert.equal(result.status, "rejected")
    assert.deepEqual(result.calls, [])
  }
})

test("two prior attempts exhaust that helper's budget, including unknown dispatch", async () => {
  const state = snapshot()
  state.attempts = [attempt(), attempt({ id: 2, transport: "unknown" })]
  assert.equal((await evaluateCase(state, async () => proposal([2]))).status, "rejected")
  assert.equal((await evaluateCase(state, async () => proposal([3]))).status, "planned")
})

test("does not invent acceptance from an answered call", async () => {
  const state = snapshot()
  state.attempts = [attempt({ accepted_at: null })]
  assert.equal((await evaluateCase(state, async () => proposal([2]))).status, "rejected")
})

test("filters unavailable helpers from both context and authorization", async () => {
  const state = snapshot()
  state.helpers[0].available = false
  const result = await evaluateCase(state, async context => {
    assert.deepEqual((context.candidates as {profile_id:number}[]).map(p => p.profile_id), [3])
    return proposal([2])
  })
  assert.equal(result.status, "rejected")
})

test("closed case does not invoke the planner or authorize outreach", async () => {
  const state = snapshot()
  state.status = "closed"
  let invoked = false
  const result = await evaluateCase(state, async () => { invoked = true; return proposal() })
  assert.equal(result.status, "closed")
  assert.equal(invoked, false)
  assert.deepEqual(result.calls, [])
})

test("a possible find does not silently close a case", async () => {
  const state = snapshot()
  state.reports.push({id: "obs_2", source_name: "Blair", text: "Found someone matching Ava.", received_at: 19_000})
  const result = await evaluateCase(state, async () => ({calls: [], reason: "Await parent reunion confirmation."}))
  assert.equal(result.status, "waiting")
  assert.equal(state.status, "open")
  assert.match(result.reason, /confirmation/)
})

test("planner failure authorizes no fallback call", async () => {
  const result = await evaluateCase(snapshot(), async () => { throw new Error("API unavailable") })
  assert.equal(result.status, "failed")
  assert.deepEqual(result.calls, [])
})

test("invalid or partial model output authorizes nothing", async () => {
  for (const invalid of [null, {}, {calls: [call()]}, {reason: "partial", calls: [call(), {profile_id: 3}]}, {reason: "empty question", calls: [{...call(), ask: " "}]}]) {
    const result = await evaluateCase(snapshot(), async () => invalid)
    assert.equal(result.status, "rejected")
    assert.deepEqual(result.calls, [])
  }
})
