import type * as db from "./db"
import type { createCaseInputService } from "./case-inputs"
import { assessDemoIntake, type DemoIntake } from "./intake"
import { ServiceError } from "./service"

export type IncomingInterpretation = {
  kind: "intake" | "update" | "confirmation"
  intake: unknown
  childIdentityConfirmed: boolean
  reunited: boolean
}
export type IncomingRequestRow = {
  id: number; provider_call_id: string; from_phone: string; direction: string; text: string
  revision: number; status: string; decision_json: string; reply: string
  support_case_id: number | null; failure_count: number; retry_at_ms: number
}
export type IncomingRequestPorts = Pick<typeof db, "profiles" | "supportCases" | "caseIntakes" | "caseProgress" | "callReducer"> & {
  incomingRequests(): Promise<IncomingRequestRow[]>
  interpret(text: string, mode: "intake" | "update"): Promise<IncomingInterpretation>
  caseInputs: ReturnType<typeof createCaseInputService>
  now?: () => number
}
type Config = { reporterProfileId: number; helperProfileIds: number[] }
type Action =
  | { kind: "intake"; reporterProfileId: number; helperProfileIds: number[]; intake: DemoIntake }
  | { kind: "update"; reporterProfileId: number; caseId: number; text: string }
  | { kind: "confirmation"; reporterProfileId: number; caseId: number; text: string; childIdentityConfirmed: boolean; reunited: boolean }
const REVIEW = "Your report has been saved for review."
const PENDING = "Your report has been saved and is being processed."
const RECORDED = "Thank you; your report has been recorded."
function response(row: IncomingRequestRow) {
  // Never disclose a case identifier or case facts to an inbound caller.
  return { request_id: row.id, status: row.status, reply: row.reply || PENDING }
}
function required(value: unknown, name: string, limit: number): string {
  if (typeof value !== "string" || !value.trim() || value.trim().length > limit || value.includes("{{")) {
    throw new ServiceError(400, name + " is missing or invalid")
  }
  return value.trim()
}

export function createIncomingRequestService(ports: IncomingRequestPorts, config: Config) {
  const ids = [config.reporterProfileId, ...config.helperProfileIds]
  if (config.helperProfileIds.length !== 2 || ids.some(id => !Number.isSafeInteger(id) || id <= 0) || new Set(ids).size !== 3) {
    throw new Error("Inbound demo requires one reporter and two distinct helper profile IDs")
  }
  const inFlight = new Map<number, Promise<void>>()
  const now = ports.now ?? Date.now
  const load = async (id: number) => (await ports.incomingRequests()).find(row => row.id === id)

  async function prepare(row: IncomingRequestRow): Promise<void> {
    const profiles = (await ports.profiles()).filter(profile => profile.phone === row.from_phone)
    const person = profiles.length === 1 && ids.includes(profiles[0].id) ? profiles[0] : undefined
    const save = (status: string, reply: string, action?: Action) => ports.callReducer("prepareIncomingRequest",
      [row.id, row.revision, JSON.stringify(action ?? {}), status, reply])
    if (!person) { await save("needs_review", REVIEW); return }
    const [cases, intakes, coordination] = await Promise.all([ports.supportCases(), ports.caseIntakes(), ports.caseProgress()])
    const candidates = cases.filter(candidate => candidate.status === "open" && intakes.some(intake =>
      intake.support_case_id === candidate.id && (intake.reporter_profile_id === person.id || coordination.some(progress =>
        progress.support_case_id === candidate.id && progress.helper_profile_ids.includes(person.id)))))
    if (candidates.length > 1 || (!candidates.length && person.id !== config.reporterProfileId)) {
      await save("needs_review", REVIEW); return
    }
    const supportCase = candidates[0]
    const interpreted = await ports.interpret(row.text, supportCase ? "update" : "intake")
    if (!interpreted || !["intake", "update", "confirmation"].includes(interpreted.kind) ||
      typeof interpreted.childIdentityConfirmed !== "boolean" || typeof interpreted.reunited !== "boolean") {
      throw new Error("Invalid inbound interpretation")
    }
    if (!supportCase) {
      if (interpreted.kind !== "intake") { await save("needs_review", REVIEW); return }
      const assessment = assessDemoIntake(interpreted.intake)
      if (assessment.status === "needs_clarification") {
        await save("needs_clarification", assessment.questions[0].question); return
      }
      await save("prepared", PENDING, { kind: "intake", reporterProfileId: person.id, helperProfileIds: [...config.helperProfileIds], intake: assessment.intake })
      return
    }
    if (interpreted.kind === "intake") { await save("needs_review", REVIEW); return }
    const originalReporter = intakes.find(intake => intake.support_case_id === supportCase.id)?.reporter_profile_id
    const meta = { reporterProfileId: person.id, caseId: supportCase.id, text: row.text }
    await save("prepared", PENDING, interpreted.kind === "confirmation" && originalReporter === person.id
      ? { kind: "confirmation", ...meta, childIdentityConfirmed: interpreted.childIdentityConfirmed, reunited: interpreted.reunited }
      : { kind: "update", ...meta })
  }

  async function apply(row: IncomingRequestRow): Promise<void> {
    // Only a persisted application decision is executed. This makes a crash
    // after case mutation recoverable through the existing case-input receipt.
    const action = JSON.parse(row.decision_json) as Action
    if (!action || !["intake", "update", "confirmation"].includes(action.kind)) throw new Error("Invalid stored inbound decision")
    const meta = { eventKey: `inbound:${row.id}:${row.revision}`, reporterProfileId: action.reporterProfileId }
    const result = action.kind === "intake"
      ? await ports.caseInputs.createCaseFromIntake(action.intake, { ...meta, helperProfileIds: action.helperProfileIds })
      : action.kind === "update"
        ? await ports.caseInputs.addCaseUpdate({ ...meta, caseId: action.caseId }, action.text)
        : await ports.caseInputs.confirmCaseReunion({ ...meta, caseId: action.caseId }, {
          childIdentityConfirmed: action.childIdentityConfirmed, reunited: action.reunited, text: action.text,
        })
    if (result.status !== "recorded") throw new Error("Stored intake was incomplete")
    await ports.callReducer("finishIncomingRequest", [row.id, row.revision, result.support_case_id, RECORDED])
  }

  async function run(id: number): Promise<void> {
    let row = await load(id)
    if (!row || !["pending", "prepared"].includes(row.status) || row.retry_at_ms > now()) return
    try {
      if (row.status === "pending") {
        try { await prepare(row) } catch (error) {
          const latest = await load(id)
          // A second processor may have won the decision CAS. Its stored
          // action is authoritative; never apply this invocation's proposal.
          if (!latest || latest.revision !== row.revision || latest.status === "pending") throw error
        }
        row = await load(id)
      }
      if (row?.status === "prepared") await apply(row)
    } catch {
      if (row) {
        const latest = await load(id)
        if (latest?.revision === row.revision && ["pending", "prepared"].includes(latest.status)) {
          await ports.callReducer("failIncomingRequest", [row.id, row.revision])
        }
      }
    }
  }
  function process(id: number): Promise<void> {
    const existing = inFlight.get(id)
    if (existing) return existing
    const pending = run(id).finally(() => { inFlight.delete(id) })
    inFlight.set(id, pending)
    return pending
  }
  async function receive(body: unknown) {
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new ServiceError(400, "body must be an object")
    const input = body as Record<string, unknown>
    const providerCallId = required(input.provider_call_id, "provider_call_id", 200)
    if (/[{}\s]/.test(providerCallId)) throw new ServiceError(400, "provider_call_id is invalid")
    const phone = required(input.from_phone, "from_phone", 32)
    if (!/^\+[1-9]\d{7,14}$/.test(phone)) throw new ServiceError(400, "from_phone must be E.164")
    if (input.direction !== "inbound") throw new ServiceError(400, "direction must be inbound")
    const text = required(input.text, "text", 20_000)
    try {
      await ports.callReducer("receiveIncomingRequest", [providerCallId, phone, "inbound", text])
    } catch (error) {
      // These are explicit sender errors from the reducer; infrastructure
      // failures retain their original error instead of looking like a conflict.
      const message = error instanceof Error ? error.message : ""
      if (/Incoming request (metadata|content) conflict/.test(message)) {
        throw new ServiceError(409, "This call already contains a different report")
      }
      throw error
    }
    const row = (await ports.incomingRequests()).find(candidate => candidate.provider_call_id === providerCallId)
    if (!row) throw new Error("Incoming request receipt missing")
    // Persistence precedes acknowledgement. The scan also recovers this work
    // after restart; provider retries are not assumed.
    void process(row.id).catch(() => {})
    return response(row)
  }
  async function sweep(): Promise<void> {
    const rows = await ports.incomingRequests()
    for (const row of rows) {
      if (["pending", "prepared"].includes(row.status) && row.retry_at_ms <= now()) await process(row.id)
    }
  }
  return { receive, process, sweep }
}
