import * as db from "./db"
import { createCaseInputService } from "./case-inputs"
import { createIncomingRequestService, type IncomingInterpretation } from "./incoming-requests"
import { interpretIncomingRequest } from "./agent"
import { recordingMode } from "./recording-model"
import { ServiceError } from "./service"

export function incomingConfig(env: NodeJS.ProcessEnv) {
  if (env.INBOUND_REQUESTS !== "1") return null
  if (env.AUTO_COORDINATE !== "1") throw new Error("Inbound demo requires AUTO_COORDINATE=1")
  const reporterProfileId = Number(env.COORDINATOR_REPORTER_ID)
  const helperProfileIds = (env.COORDINATOR_HELPER_IDS ?? "").split(",").map(Number)
  const ids = [reporterProfileId, ...helperProfileIds]
  if (helperProfileIds.length !== 2 || ids.some(id => !Number.isSafeInteger(id) || id <= 0) || new Set(ids).size !== 3) {
    throw new Error("Inbound requires distinct configured reporter and two helper profile IDs")
  }
  return { reporterProfileId, helperProfileIds }
}

export async function scriptedIncoming(text: string, mode: "intake" | "update"): Promise<IncomingInterpretation> {
  if (mode === "intake") {
    if (text !== "My child Ava, age 7, red jacket, was last seen at the Park bench at 15:00. I am Morgan, her parent.") throw new Error("Unknown scripted intake fixture")
    return {kind:"intake",intake:{child:{name:"Ava",description:"Age 7, red jacket",last_seen_location_id:"park-bench",last_seen_time:"15:00"},reporter:{name:"Morgan",relationship:"parent"}},childIdentityConfirmed:false,reunited:false}
  }
  const confirmed = text === "I confirm this is my child Ava and we are physically reunited."
  return {kind:confirmed ? "confirmation" : "update",intake:null,childIdentityConfirmed:confirmed,reunited:confirmed}
}

let instance: ReturnType<typeof createIncomingRequestService> | undefined
function service() {
  const config = incomingConfig(process.env)
  if (!config) throw new ServiceError(503, "Inbound requests are not enabled")
  return instance ??= createIncomingRequestService({ ...db, caseInputs: createCaseInputService(db),
    interpret: recordingMode() ? scriptedIncoming : interpretIncomingRequest,
  }, config)
}

export async function receiveIncoming(body: unknown) {
  const current = service()
  const receipt = await current.receive(body)
  if (!["pending", "prepared"].includes(receipt.status)) return receipt
  // Durable receipt first; allow a short synchronous answer for clarification.
  // The worker keeps processing after this deadline or a disconnected caller.
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([current.process(receipt.request_id), new Promise<void>(resolve => { timer = setTimeout(resolve, 20_000) })])
  } finally { if (timer) clearTimeout(timer) }
  return current.receive(body)
}

export function startIncomingWorker(): void {
  if (!incomingConfig(process.env)) return
  const current = service()
  let scanning = false
  const scan = async () => {
    if (scanning) return
    scanning = true
    try { await current.sweep() } catch { console.error("Inbound request scan failed; persisted work will be retried") }
    finally { scanning = false }
  }
  void scan()
  setInterval(() => { void scan() }, 1_000).unref()
}
