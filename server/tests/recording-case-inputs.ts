import assert from "node:assert/strict"
import { test } from "node:test"
import { recordingCaseInputConfig, createRecordingCaseInputs } from "../src/recording-case-inputs"
import type { RecordingState } from "../src/recording-demo"
const config = { SPACETIMEDB_URL: "http://127.0.0.1:3000", SPACETIMEDB_DATABASE: "sealert-recording-test", RECORDING_DATABASE: "sealert-recording-test" }
test("requires explicit matching dedicated database and local endpoint", () => {
  assert.equal(recordingCaseInputConfig(config).database, config.RECORDING_DATABASE)
  for (const override of [{ SPACETIMEDB_URL: undefined }, { SPACETIMEDB_URL: "http://example.com" }, { SPACETIMEDB_URL: "https://127.0.0.1" }, { SPACETIMEDB_URL: "http://127.0.0.1/path" }, { SPACETIMEDB_DATABASE: undefined }, { SPACETIMEDB_DATABASE: "sealert" }, { RECORDING_DATABASE: "sealert-recording" }]) assert.throws(() => recordingCaseInputConfig({ ...config, ...override }))
})
function fixtures() {
  const profiles = [{ id: 1, name: "Blair", phone: "+15555550102" }, { id: 2, name: "Casey", phone: "+15555550103" }, { id: 4, name: "Morgan (recording)", phone: "+15555550104" }]
  const state = { profiles, demo_mode: { helper_ids: [1, 2] } } as RecordingState
  const calls: any[] = []
  const ports: any = {
    profiles: async () => profiles,
    caseInputs: async () => [{ support_case_id: 7, event_key: "persisted" }],
    supportCases: async () => [{ id: 7, incident_id: 8 }],
    createCaseFromIntake: async (draft: unknown, meta: unknown) => { calls.push({ draft, meta }); return { status: "recorded", support_case_id: 7 } },
    addCaseUpdate: async (meta: unknown, text: string) => { calls.push({ meta, text }) },
    confirmCaseReunion: async (meta: unknown, confirmation: unknown) => { calls.push({ meta, confirmation }) },
  }
  return { profiles, state, calls, ports }
}
test("adapter replays exact intake and binds helper update and original reporter confirmation", async () => {
  const fake = fixtures(), adapter = createRecordingCaseInputs(fake.ports)
  assert.deepEqual(await adapter.open(fake.state), { support_case_id: 7, incident_id: 8 })
  assert.deepEqual(fake.calls[0], fake.calls[1])
  assert.match(fake.calls[0].meta.eventKey, /^[0-9a-f-]{36}$/)
  await adapter.update(7, "playground clue")
  await adapter.confirm(7)
  assert.equal(fake.calls[2].meta.reporterProfileId, 1)
  assert.equal(fake.calls[3].meta.reporterProfileId, 4)
  assert.equal(fake.calls[3].confirmation.reunited, true)
  assert.equal(new Set(fake.calls.map(call => call.meta.eventKey)).size, 3)
})
test("mismatched fixtures fail before writes; duplicate intake events fail replay assertion", async () => {
  const fake = fixtures()
  fake.ports.profiles = async () => fake.profiles.map(row => ({ ...row, name: "different" }))
  await assert.rejects(createRecordingCaseInputs(fake.ports).open(fake.state), /do not match/)
  assert.equal(fake.calls.length, 0)
  const duplicate = fixtures()
  let reads = 0
  duplicate.ports.caseInputs = async () => Array.from({ length: ++reads }, () => ({ support_case_id: 7 }))
  await assert.rejects(createRecordingCaseInputs(duplicate.ports).open(duplicate.state), /did not preserve/)
})
test("parent fixture must be separate and use its expected fictional phone", async () => {
  for (const change of ["phone", "helper"]) {
    const fake = fixtures()
    if (change === "phone") fake.profiles[2]!.phone = "+14155550123"
    else fake.state.demo_mode!.helper_ids = [1, 4]
    await assert.rejects(createRecordingCaseInputs(fake.ports).open(fake.state), /separate Morgan/)
    assert.equal(fake.calls.length, 0)
  }
})
