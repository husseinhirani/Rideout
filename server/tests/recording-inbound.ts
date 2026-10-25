import assert from "node:assert/strict"
import { test } from "node:test"
import { createRecordingInbound } from "../src/recording-inbound"
import type { RecordingState } from "../src/recording-demo"
const base = { database: "sealert-recording-test", baseUrl: "http://127.0.0.1:8790", callbackSecret: "test-secret", pollMs: 0 }
function fixture() {
  const state = { profiles: [{ id: 1, name: "Blair", phone: "+15555550102", lat: 0, lng: 0, contact_profile_ids: [] }, { id: 2, name: "Casey", phone: "+15555550103", lat: 0, lng: 0, contact_profile_ids: [] }, { id: 4, name: "Morgan (recording)", phone: "+15555550104", lat: 0, lng: 0, contact_profile_ids: [] }], cases: [], attempts: [], attempt_progress: [], notes: [], coordination: [], demo_mode: { helper_ids: [1, 2], simulate: true, scripted: true, auto_coordinate: true, database: base.database } } as RecordingState
  const calls: { url: string; body: any; headers: Headers }[] = []
  let pending = true
  const fetcher: typeof fetch = async (url, init) => {
    const path = new URL(String(url)).pathname
    const body = init?.body ? JSON.parse(String(init.body)) : undefined
    calls.push({ url: path, body, headers: new Headers(init?.headers) })
    if (path === "/state") return Response.json({ ...state, cases: [{ id: 7, incident_id: 8, status: "open" }] })
    if (pending) { pending = false; return Response.json({ request_id: 1, status: "pending", reply: "Saved" }) }
    return Response.json({ request_id: 1, status: "recorded", reply: "Recorded" })
  }
  return { state, calls, fetcher }
}
test("HTTP adapter polls identical intake, replays it and binds distinct simulated calls", async () => {
  const f = fixture(), adapter = createRecordingInbound({ ...base, fetch: f.fetcher })
  assert.deepEqual(await adapter.open(f.state), { support_case_id: 7, incident_id: 8 })
  await adapter.update(7, "A witness reports a red backpack near the playground.")
  await adapter.confirm(7)
  const posts = f.calls.filter(call => call.url === "/requests")
  assert.deepEqual(posts[0]!.body, posts[1]!.body)
  assert.deepEqual(posts[0]!.body, posts[2]!.body)
  assert.equal(posts[0]!.body.from_phone, "+15555550104")
  assert.equal(posts[3]!.body.from_phone, "+15555550102")
  assert.equal(posts[4]!.body.from_phone, "+15555550104")
  assert.equal(new Set(posts.map(call => call.body.provider_call_id)).size, 3)
  assert.ok(posts.every(call => call.body.direction === "inbound" && call.headers.get("authorization") === "Bearer test-secret"))
  assert.ok(posts.every(call => !Object.keys(call.body).includes("attempt_id")))
  assert.match(posts[4]!.body.text, /physically reunited/)
})
test("unsafe modes, real participant numbers and remote URLs fail before requests", async () => {
  assert.throws(() => createRecordingInbound({ ...base, baseUrl: "https://example.com" }), /local/)
  assert.throws(() => createRecordingInbound({ ...base, database: "sealert" }), /dedicated/)
  for (const change of ["mode", "parent", "helper"]) {
    const f = fixture()
    if (change === "mode") f.state.demo_mode!.scripted = false
    if (change === "parent") f.state.profiles[2]!.phone = "+14155550123"
    if (change === "helper") f.state.profiles[0]!.phone = "+14155550123"
    await assert.rejects(createRecordingInbound({ ...base, fetch: f.fetcher }).open(f.state))
    assert.equal(f.calls.length, 0)
  }
})
test("pending timeout, review and HTTP rejection stop without progressing to further writes", async () => {
  for (const response of [Response.json({ request_id: 1, status: "pending" }), Response.json({ request_id: 1, status: "needs_review" }), Response.json({ error: "unauthorized" }, { status: 401 })]) {
    const f = fixture(), calls: string[] = []
    const fetcher: typeof fetch = async url => { calls.push(String(url)); return response.clone() }
    await assert.rejects(createRecordingInbound({ ...base, fetch: fetcher, timeoutMs: 0 }).open(f.state))
    assert.equal(calls.length, 1)
  }
})
test("a replay that produces another case is rejected", async () => {
  const f = fixture(); let states = 0
  const fetcher: typeof fetch = async (url, init) => {
    if (new URL(String(url)).pathname !== "/state") return f.fetcher(url, init)
    return Response.json({ ...f.state, cases: Array.from({ length: ++states }, (_, i) => ({ id: 7 + i, incident_id: 8 + i })) })
  }
  await assert.rejects(createRecordingInbound({ ...base, fetch: fetcher }).open(f.state), /replay/)
})

test("prepared receipt keeps polling with a timeout longer than bounded interpretation", async () => {
  const f = fixture()
  let posts = 0
  const fetcher: typeof fetch = async (url, init) => {
    if (new URL(String(url)).pathname !== "/requests") return f.fetcher(url, init)
    assert.ok(init?.signal)
    if (++posts === 1) return Response.json({ request_id: 1, status: "prepared", reply: "Processing" })
    return Response.json({ request_id: 1, status: "recorded", reply: "Recorded" })
  }
  const original = AbortSignal.timeout
  const deadlines: number[] = []
  AbortSignal.timeout = milliseconds => { deadlines.push(milliseconds); return original(milliseconds) }
  try {
    assert.deepEqual(await createRecordingInbound({ ...base, fetch: fetcher }).open(f.state), { support_case_id: 7, incident_id: 8 })
    assert.ok(deadlines.every(value => value >= 25_000))
    assert.equal(posts, 3)
  } finally { AbortSignal.timeout = original }
})
