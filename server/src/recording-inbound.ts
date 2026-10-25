import { randomUUID } from "node:crypto"
import { pathToFileURL } from "node:url"
import { loadEnv } from "./env"
import { runRecordingDemo, type RecordingCaseInputs, type RecordingOptions, type RecordingState } from "./recording-demo"

export const RECORDING_INTAKE = "My child Ava, age 7, red jacket, was last seen at the Park bench at 15:00. I am Morgan, her parent."
export const RECORDING_CONFIRMATION = "I confirm this is my child Ava and we are physically reunited."
type RequestBody = { from_phone: string; provider_call_id: string; direction: "inbound"; text: string }
type RequestReply = { request_id: number; status: string; reply: string }

/** HTTP-only recording adapter. Caller metadata is explicitly fictional, not provider verification. */
export function createRecordingInbound(options: RecordingOptions): RecordingCaseInputs {
  const base = new URL(options.baseUrl ?? "http://127.0.0.1:8787")
  if (base.protocol !== "http:" || base.hostname !== "127.0.0.1" || base.pathname !== "/" || base.search || base.hash || base.username || base.password) throw new Error("Inbound recording requires a local http://127.0.0.1:<port> URL")
  if (!/^rideout-recording-[a-z0-9-]+$/.test(options.database)) throw new Error("Inbound recording requires a dedicated rideout-recording-* database")
  const fetcher = options.fetch ?? fetch
  let openedId: number | undefined
  let helperPhone: string | undefined
  const body = (phone: string, text: string): RequestBody => ({ from_phone: phone, provider_call_id: "sim-inbound-" + randomUUID(), direction: "inbound", text })
  async function request<T>(path: string, value?: RequestBody): Promise<T> {
    const response = await fetcher(new URL(path, base), {
      method: value ? "POST" : "GET", headers: { "Content-Type": "application/json", ...(value && options.callbackSecret ? { Authorization: "Bearer " + options.callbackSecret } : {}) },
      body: value ? JSON.stringify(value) : undefined, signal: AbortSignal.timeout(25_000),
    })
    if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`)
    return await response.json() as T
  }
  async function recorded(value: RequestBody): Promise<RequestReply> {
    const deadline = Date.now() + (options.timeoutMs ?? 60_000)
    let requestId: number | undefined
    do {
      const reply = await request<RequestReply>("/requests", value)
      if (!Number.isSafeInteger(reply.request_id) || reply.request_id < 1 || (requestId !== undefined && requestId !== reply.request_id)) throw new Error("Inbound request receipt ID changed or is missing")
      requestId = reply.request_id
      if (reply.status === "recorded") return reply
      if (reply.status !== "pending" && reply.status !== "prepared") throw new Error(`Inbound recording requires recorded result; received ${reply.status}`)
      if (Date.now() >= deadline) break
      await new Promise(resolve => setTimeout(resolve, options.pollMs ?? 300))
    } while (Date.now() < deadline)
    throw new Error("Timed out waiting for inbound request processing")
  }
  return {
    async open(state) {
      const mode = state.demo_mode
      if (!mode?.simulate || !mode.scripted || !mode.auto_coordinate || mode.database !== options.database) throw new Error("Inbound recording requires matching simulated scripted automatic backend")
      const parent = state.profiles.find(row => row.name === "Morgan (recording)" && row.phone === "+15555550104")
      const helpers = mode.helper_ids.map(id => state.profiles.find(row => row.id === id))
      if (!parent || mode.helper_ids.includes(parent.id) || helpers.length !== 2 || new Set(mode.helper_ids).size !== 2 || helpers.some(row => !row?.phone.startsWith("+1555555")) || new Set(helpers.map(row => row!.phone)).size !== 2) throw new Error("Seed separate Morgan and two helpers with fictional recording phones")
      if (state.cases.some(row => row.status !== "closed") || state.attempt_progress.some(row => !["ended", "cancelled"].includes(row.transport))) throw new Error("Resolve previous recording work before starting inbound replay")
      helperPhone = helpers[0]!.phone
      const intake = body(parent.phone, RECORDING_INTAKE)
      const receipt = await recorded(intake)
      const after = await request<RecordingState>("/state")
      const added = after.cases.filter(row => !state.cases.some(old => old.id === row.id))
      if (added.length !== 1) throw new Error("Inbound intake did not create exactly one new case")
      const replay = await recorded(intake)
      const afterReplay = await request<RecordingState>("/state")
      if (receipt.request_id !== replay.request_id || JSON.stringify(after.cases.map(row => row.id).sort()) !== JSON.stringify(afterReplay.cases.map(row => row.id).sort())) throw new Error("Inbound intake replay created another request or case")
      openedId = added[0]!.id
      options.report?.({ stage: "inbound-intake-replay-deduplicated", at: new Date().toISOString(), detail: { request_id: receipt.request_id, support_case_id: openedId, notice: "Real HTTP /requests; simulated phone metadata and scripted interpretation. No live provider or identity verification." } })
      return { support_case_id: openedId, incident_id: added[0]!.incident_id }
    },
    async update(caseId, text) {
      if (caseId !== openedId || !helperPhone) throw new Error("Open the inbound recording case before updating")
      await recorded(body(helperPhone, text))
    },
    async confirm(caseId) {
      if (openedId === undefined || caseId !== openedId) throw new Error("Open the inbound recording case before confirming")
      await recorded(body("+15555550104", RECORDING_CONFIRMATION))
    },
  }
}

async function main(): Promise<void> {
  if (process.argv.includes("--help")) {
    console.log("Usage: RECORDING_DATABASE=rideout-recording-<name> npm run demo:inbound\nOptional RECORDING_URL=http://127.0.0.1:8787 and CALLBACK_SECRET. Requires seeded scripted simulation. All intake, updates and confirmation use HTTP /requests with fictional phone metadata; no real call or hosted configuration changes.")
    return
  }
  if (process.argv.length > 2) throw new Error("Unknown argument; use --help")
  loadEnv()
  const options: RecordingOptions = {
    database: process.env.RECORDING_DATABASE ?? "", baseUrl: process.env.RECORDING_URL,
    callbackSecret: process.env.CALLBACK_SECRET?.trim(),
    report: event => {
      if (event.stage === "new-clue") event = { ...event, detail: { text: "Unverified red-backpack clue delivered through HTTP /requests with a simulated helper caller binding." } }
      if (event.stage === "simulated-reporter-confirmation") event = { ...event, detail: { ...event.detail as object, notice: "Reported reunion delivered through HTTP /requests with simulated original reporter metadata; no live phone or verified identity." } }
      console.log(JSON.stringify(event))
    },
  }
  await runRecordingDemo({ ...options, caseInputs: createRecordingInbound(options) })
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(`Inbound recording failed: ${error instanceof Error ? error.message : String(error)}`); process.exitCode = 1 })
}
