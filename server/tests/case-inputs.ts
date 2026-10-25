import assert from "node:assert/strict"
import { test } from "node:test"
import { createCaseInputService, resolveCaseForReporter, type CaseInputPorts } from "../src/case-inputs"
import type { CaseInputRow, CaseIntakeRow, CaseProgressRow, SupportCaseRow } from "../src/db"
const draft = { child: { name: "Ava", description: "Red jacket", last_seen_location_id: "park-bench", last_seen_time: "about 3 pm" }, reporter: { name: "Morgan", relationship: "mother" } }
const meta = { eventKey: "intake-1", reporterProfileId: 3, helperProfileIds: [1, 2] }
const supportCase = (id: number, status = "open"): SupportCaseRow => ({ id, incident_id: 1, victim_profile_id: 4, goal: "Find Ava", brief: "", status })
const intake = (id: number): CaseIntakeRow => ({ support_case_id: id, reporter_profile_id: 3, child_description: "Red jacket", last_seen_location_id: "park-bench", last_seen_time: "about 3 pm", reporter_name: "Morgan", reporter_relationship: "mother", reunion_confirmed: false, confirmed_at: null })
const progress = (id: number): CaseProgressRow => ({ support_case_id: id, helper_profile_ids: [1, 2], input_revision: 1, evaluated_revision: 0, failure_count: 0, retry_at_ms: null, blocked_reason: "" })
function setup() {
  const writes: { name: string; args: unknown[] }[] = [], receipts: CaseInputRow[] = []
  const cases = [supportCase(8)], intakes = [intake(8)], coordination = [progress(8)]
  const ports: CaseInputPorts = {
    supportCases: async () => cases, caseIntakes: async () => intakes, caseProgress: async () => coordination, caseInputs: async () => receipts,
    callReducer: async (name, args) => {
      writes.push({ name, args })
      if (name === "recordCaseIntake" && !receipts.some(row => row.event_key === args[0])) receipts.push({ event_key: args[0] as string, support_case_id: 8, reporter_profile_id: args[1] as number, kind: "intake", payload: args[3] as string, received_at: new Date(0).toISOString() })
    },
  }
  return { ...createCaseInputService(ports), writes, receipts, cases, intakes, coordination, ports }
}
test("incomplete intake returns questions without invoking a reducer", async () => {
  const service = setup()
  assert.equal((await service.createCaseFromIntake({}, meta)).status, "needs_clarification")
  assert.deepEqual(service.writes, [])
})
test("malformed trusted metadata fails before writes", async () => {
  const service = setup()
  for (const bad of [null, { ...meta, eventKey: " " }, { ...meta, reporterProfileId: 0 }, { ...meta, reporterProfileId: "3" }, { ...meta, helperProfileIds: [1] }, { ...meta, helperProfileIds: [1, 1] }, { ...meta, helperProfileIds: [1, 3] }, { ...meta, helperProfileIds: [1, -2] }]) await assert.rejects(service.createCaseFromIntake(draft, bad as typeof meta))
  await assert.rejects(service.addCaseUpdate({ eventKey: "update", reporterProfileId: 3, caseId: -1 }, "clue"))
  assert.deepEqual(service.writes, [])
})
test("intake drops untrusted identity claims and returns the same receipt ID on replay", async () => {
  const service = setup(), input = { ...draft, reporter: { ...draft.reporter, profile_id: 999, verified: true } }
  assert.deepEqual(await service.createCaseFromIntake(input, meta), { status: "recorded", support_case_id: 8 })
  assert.deepEqual(await service.createCaseFromIntake(input, meta), { status: "recorded", support_case_id: 8 })
  assert.equal(service.receipts.length, 1)
  assert.deepEqual(JSON.parse(service.writes[0].args[3] as string).reporter, { name: "Morgan", relationship: "mother", attribution: "self_reported" })
})
test("a missing durable receipt cannot report success", async () => {
  const service = setup(), broken = createCaseInputService({ ...service.ports, callReducer: async () => {} })
  await assert.rejects(broken.createCaseFromIntake(draft, meta), /receipt/)
})
test("association requires intake and participation and never guesses the newest case", () => {
  const common = { cases: [supportCase(8), supportCase(20)], intakes: [intake(8), intake(20)], coordination: [progress(8), progress(20)] }
  assert.throws(() => resolveCaseForReporter({ ...common, reporterProfileId: 3 }), /Ambiguous/)
  assert.throws(() => resolveCaseForReporter({ ...common, reporterProfileId: 1 }), /Ambiguous/)
  assert.equal(resolveCaseForReporter({ ...common, reporterProfileId: 1, caseId: 8 }).id, 8)
  assert.throws(() => resolveCaseForReporter({ ...common, reporterProfileId: 99, caseId: 8 }), /No matching/)
  assert.throws(() => resolveCaseForReporter({ ...common, reporterProfileId: 1, caseId: 8, intakes: [] }), /No matching/)
})
test("explicit case IDs accept late reports; implicit association only selects open cases", async () => {
  const service = setup()
  service.cases[0].status = "closed"
  await assert.rejects(service.addCaseUpdate({ eventKey: "late", reporterProfileId: 1 }, "late clue"), /No matching/)
  assert.deepEqual(await service.addCaseUpdate({ eventKey: "late", reporterProfileId: 1, caseId: 8 }, "late clue"), { status: "recorded", support_case_id: 8 })
  assert.equal(service.writes[0].name, "recordCaseUpdate")
})
test("nonparticipants and helper reunion confirmations fail without writes", async () => {
  const service = setup()
  await assert.rejects(service.addCaseUpdate({ eventKey: "update", reporterProfileId: 99, caseId: 8 }, "clue"), /No matching/)
  await assert.rejects(service.confirmCaseReunion({ eventKey: "confirm", reporterProfileId: 1, caseId: 8 }, { childIdentityConfirmed: true, reunited: true, text: "Found her" }), /original intake reporter/)
  await assert.rejects(service.confirmCaseReunion({ eventKey: "confirm", reporterProfileId: 3, caseId: 8 }, { childIdentityConfirmed: "yes", reunited: true, text: "Found her" } as never), /Explicit/)
  assert.deepEqual(service.writes, [])
})
test("original reporter confirmation sends both explicit booleans to the reducer", async () => {
  const service = setup()
  await service.confirmCaseReunion({ eventKey: "confirm", reporterProfileId: 3, caseId: 8 }, { childIdentityConfirmed: true, reunited: false, text: "It is Ava but we are apart" })
  assert.deepEqual(service.writes, [{ name: "recordReunionConfirmation", args: ["confirm", 8, 3, true, false, "It is Ava but we are apart"] }])
})

test("implicit confirmation replay keeps its receipt case after closure and still checks content", async () => {
  const state = setup()
  let reducerCalls = 0, mutations = 0
  const service = createCaseInputService({ ...state.ports, callReducer: async (name, args) => {
    reducerCalls++
    const payload = JSON.stringify(args), previous = state.receipts.find(row => row.event_key === args[0])
    if (previous) {
      if (previous.kind !== name || previous.payload !== payload) throw new Error("Event key already contains different input")
      return
    }
    mutations++
    state.receipts.push({ event_key: args[0] as string, support_case_id: args[1] as number, reporter_profile_id: args[2] as number, kind: name, payload, received_at: new Date(0).toISOString() })
    state.cases[0].status = "closed"
  } })
  const input = { eventKey: "reunion", reporterProfileId: 3 }
  const confirmation = { childIdentityConfirmed: true, reunited: true, text: "Together again" }
  assert.deepEqual(await service.confirmCaseReunion(input, confirmation), { status: "recorded", support_case_id: 8 })
  assert.equal(state.cases[0].status, "closed")
  // An unrelated newer open case must not steal this retry.
  state.cases.push(supportCase(20)); state.intakes.push(intake(20)); state.coordination.push(progress(20))
  assert.deepEqual(await service.confirmCaseReunion(input, confirmation), { status: "recorded", support_case_id: 8 })
  assert.equal(reducerCalls, 2)
  assert.equal(mutations, 1)
  await assert.rejects(service.addCaseUpdate({ ...input, reporterProfileId: 1 }, "clue"), /different reporter/)
  assert.equal(reducerCalls, 2)
  await assert.rejects(service.addCaseUpdate(input, "clue"), /different input/)
  await assert.rejects(service.confirmCaseReunion(input, { ...confirmation, text: "changed" }), /different input/)
  assert.equal(reducerCalls, 4)
  assert.equal(mutations, 1)
})
