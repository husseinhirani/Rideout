import assert from "node:assert/strict"
import { test } from "node:test"
import { runRecordingDemo } from "../src/recording-demo"

function backend() {
  const state: any = {
    demo_mode: { simulate: true, scripted: true, auto_coordinate: true, database: "rideout-recording-test", helper_ids: [1, 2] },
    profiles: [{ id: 1, phone: "+15555550101" }, { id: 2, phone: "+15555550102" }, { id: 3, name: "Ava (recording)", phone: "" }],
    cases: [], attempts: [], attempt_progress: [], notes: [], coordination: [],
  }
  const mutations: string[] = []
  function calls(start: number) {
    for (let i = 0; i < 2; i++) {
      state.attempts.push({ id: start + i, support_case_id: 1, profile_id: i + 1, ask: start === 1 ? "Can you check safely?" : "Can you check the playground clue?" })
      state.attempt_progress.push({ attempt_id: start + i, transport: "active", report_processed: false, accepted_at_ms: null })
    }
  }
  const fetcher = (async (input, init) => {
    const path = new URL(String(input)).pathname
    const body = init?.body ? JSON.parse(String(init.body)) : {}
    if (init?.method === "POST") mutations.push(path)
    let result: unknown = {}
    if (path === "/state") result = state
    else if (path === "/incidents") result = { incident_id: 1 }
    else if (path === "/cases") {
      state.cases.push({ id: 1, brief: "", status: "open" })
      calls(1)
      result = { support_case_id: 1 }
    } else if (path === "/calls/report") {
      const progress = state.attempt_progress.find((row: any) => row.attempt_id === Number(body.attempt_id))
      progress.report_processed = true
      progress.accepted_at_ms = 1
      progress.transport = "ended"
      if (body.answer.includes("Possible find")) state.cases[0].brief = body.answer
    } else if (path.endsWith("/input")) calls(3)
    else if (path.endsWith("/close")) state.cases[0].status = "closed"
    else throw new Error(`Unexpected route ${path}`)
    return new Response(JSON.stringify(result), { status: 200 })
  }) as typeof fetch
  return { state, fetcher, mutations }
}

test("recording uses existing routes and discloses simulated/manual outcomes", async () => {
  const fake = backend()
  const events = await runRecordingDemo({ database: "rideout-recording-test", fetch: fake.fetcher, pollMs: 0 })
  assert.deepEqual(events.map(event => event.stage), ["mode", "case-opened", "initial-calls", "helpers-accepted", "new-clue", "follow-up-calls", "possible-find-still-open", "manually-closed"])
  assert.equal(fake.mutations.filter(path => path === "/calls/report").length, 4)
  assert.equal(fake.mutations.at(-1), "/cases/1/close")
  assert.match(JSON.stringify(events.at(-1)), /does not verify parent identity/)
})

test("recording refuses unsafe modes and targets before writes", async () => {
  for (const flag of ["simulate", "scripted", "auto_coordinate"]) {
    const fake = backend()
    fake.state.demo_mode[flag] = false
    await assert.rejects(runRecordingDemo({ database: "rideout-recording-test", fetch: fake.fetcher }), /Backend must report/)
    assert.equal(fake.mutations.length, 0)
  }
  const fake = backend()
  await assert.rejects(runRecordingDemo({ database: "rideout", fetch: fake.fetcher }), /dedicated/)
  await assert.rejects(runRecordingDemo({ database: "rideout-recording-test", baseUrl: "https://example.org", fetch: fake.fetcher }), /127.0.0.1/)
  fake.state.demo_mode.database = "other"
  await assert.rejects(runRecordingDemo({ database: "rideout-recording-test", fetch: fake.fetcher }), /matching dedicated database/)
  assert.equal(fake.mutations.length, 0)
})

test("recording refuses real helper numbers and missing child", async () => {
  const fake = backend()
  fake.state.profiles[0].phone = "+14155550123"
  await assert.rejects(runRecordingDemo({ database: "rideout-recording-test", fetch: fake.fetcher }), /fictional/)
  fake.state.profiles[0].phone = "+15555550101"
  fake.state.profiles[2].phone = "+15555550103"
  await assert.rejects(runRecordingDemo({ database: "rideout-recording-test", fetch: fake.fetcher }), /separate Ava/)
  assert.equal(fake.mutations.length, 0)
})

test("recording bounds waits and gives progress diagnostics", async () => {
  const fake = backend()
  const fetcher = (async (input, init) => {
    const response = await fake.fetcher(input, init)
    if (new URL(String(input)).pathname === "/state" && fake.state.cases.length) return new Response(JSON.stringify({ ...fake.state, attempts: [] }))
    return response
  }) as typeof fetch
  await assert.rejects(runRecordingDemo({ database: "rideout-recording-test", fetch: fetcher, timeoutMs: 1, pollMs: 0 }), /Timed out waiting for two initial helper calls.*coordination/)
})

test("recording rejects unresolved calls left on closed cases before creating another case", async () => {
  const fake=backend()
  fake.state.cases.push({id:4,status:"closed"})
  fake.state.attempt_progress.push({attempt_id:7,transport:"active"})
  await assert.rejects(runRecordingDemo({database:"rideout-recording-test",fetch:fake.fetcher,timeoutMs:1,pollMs:0}),/outstanding simulated calls/)
  assert.equal(fake.mutations.length,0)
})
