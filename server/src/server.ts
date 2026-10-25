import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import { resolve } from "node:path"
import { loadEnv } from "./env"
import { authorizeRequest, readAccessConfig } from "./operator-auth"
import { createLocalConsole } from "./local-console"
import { getState, registerProfile } from "./loop"
import { profiles, attempts, callReducer, incomingRequests, type ProfileRow, type AttemptProgressRow } from "./db"
import { configureInformationCase, createInformationCase, directory, readInformationState, readInformationPlanning, receiveInformationReport, requestInformationCall, inputInformationCase, retryInformationReport, readInformationIncomingState, configureInformationIntake, reviewInformationIncoming, closeInformationCase, cancelInformationAttempt } from "./information"
import { receiveInformationRequest } from "./information-incoming"
import { startInformationWorker } from "./information-worker"
import { asId, asNumber, asString, ServiceError } from "./service"
import { contactScope } from "../shared/information"
import { startWildfireDrill, wildfireDemo, wildfireDrills, configureDrillParticipants } from "./wildfire-drill"
import { attemptAudio } from "./call-audio"
import { attemptTranscript, receiveCallEvent } from "./call-transcript"

import { assistanceStates, publicAssistance, coordinateCall, coordinatorCommand } from './assistance'
import { startAssistanceWorker } from './assistance-worker'

const BODY_LIMIT = 1_000_000
loadEnv()
const access = readAccessConfig()
const port = Number(process.env.PORT ?? 8787)
const consolePort = Number(process.env.CONSOLE_PORT ?? 8788)
const actor = "local-operator"
if (process.env.COORDINATOR_SCRIPTED === "1") {
  throw new Error("Generic investigations require real Claude; scripted planning is not supported.")
}
if (process.env.AUTO_COORDINATE === "1" && !process.env.ANTHROPIC_API_KEY?.trim()) {
  throw new Error("ANTHROPIC_API_KEY is required for automatic coordination.")
}
const server = createServer((req, res) => {
  handle(req, res).catch((error: unknown) => {
    const status = error instanceof ServiceError ? error.status : 500
    send(res, status, { error: error instanceof Error ? error.message : "Request failed" })
  })
})
server.listen(port, "127.0.0.1", () => {
  console.log("API/callbacks listening on http://127.0.0.1:" + port)
  startInformationWorker()
  startAssistanceWorker()
})
createLocalConsole({ port: consolePort, apiPort: port, operatorSecret: access.operatorSecret,
  htmlPath: resolve(import.meta.dirname, "ui.html"),
}).listen(consolePort, "127.0.0.1", () => console.log("Local test console: http://127.0.0.1:" + consolePort))

async function state() {
  const [legacy, information, incoming, coordination, inbound, drills] = await Promise.all([getState(false), readInformationState(), incomingRequests(), readInformationPlanning(), readInformationIncomingState(), wildfireDrills()])
  return {
    assistance_sessions: (await assistanceStates()).map(publicAssistance),
    ...legacy, read_model_version: 2, assistance_protocol_version: 2, server_time_ms: Date.now(),
    wildfire_demo: await wildfireDemo(),
    wildfire_drills: drills,
    profiles: (legacy.profiles as ProfileRow[]).map(({phone, ...profile}) => ({...profile, phone_last4: phone.slice(-4)})),
    incidents: [...legacy.incidents as unknown[], ...information.incidents.map(i => ({...i, kind: "information", type: "Information investigation", brief: ""}))],
    cases: [...legacy.cases as unknown[], ...information.cases.map(c => ({...c, kind: "information", goal: c.objective, victim_profile_id: null}))],
    profile_settings: information.settings, information_attempts: information.metadata,
    adaptive_planning_available: process.env.AUTO_COORDINATE === "1",
    information_planning: coordination.planning.map(p => ({ ...p, blocked_reason: information.cases.find(c => c.id === p.support_case_id)?.status === "closed" ? "Closed; no further outreach. Active calls and late reports remain tracked."
      : !p.enabled ? null
      : process.env.AUTO_COORDINATE !== "1" ? "Automatic coordination is disabled on this server."
      : information.cases.find(c => c.id === p.support_case_id)?.policy.paused ? "Paused; organizer action is required."
      : (legacy.attempt_progress as AttemptProgressRow[]).some(a => a.support_case_id === p.support_case_id && a.report_received && !a.report_processed)
        ? "A saved report is awaiting verified binding or interpretation. Inspect the attempt's report status."
        : null })),
    information_decisions: coordination.decisions,
    information_intake_configuration: inbound.configuration,
    information_incoming_resolutions: inbound.resolutions,
    incoming_requests: incoming.map(({from_phone, decision_json, ...row}) => {
      let review_reason = ""
      try { const decision = JSON.parse(decision_json); review_reason = decision.assessment?.reason ?? decision.reason ?? "" } catch { /* No prepared interpretation yet. */ }
      if (!review_reason && row.failure_count >= 3) review_reason = "Automatic interpretation failed; organizer review is needed."
      return {...row, phone_last4: from_phone.slice(-4), identity_status: "unverified", review_reason}
    }),
  }
}
async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  authorizeRequest(req, access)
  const url = new URL(req.url ?? "/", "http://127.0.0.1")
  const path = url.pathname
  if (req.method === "GET") {
    const transcript = /^\/attempts\/(\d+)\/transcript$/.exec(path)
    if (transcript) {
      res.setHeader("Cache-Control", "no-store")
      send(res, 200, await attemptTranscript(asId(transcript[1], "attempt_id"))); return
    }
    const audio = /^\/attempts\/(\d+)\/audio$/.exec(path)
    if (audio) {
      const data = await attemptAudio(asId(audio[1], "attempt_id"))
      if (!data) { send(res, 202, { status: "waiting", message: "Waiting for the completed call recording." }); return }
      res.writeHead(200, { "Content-Type": "audio/wav", "Content-Length": data.length, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" })
      res.end(data); return
    }
    if (path === "/state") { send(res, 200, await state()); return }
    if (path === "/intake-configuration") { send(res, 200, (await readInformationIncomingState()).configuration); return }
    if (path === "/profiles") {
      let filter
      try { filter = contactScope(JSON.parse(url.searchParams.get("filter") ?? "{}")) }
      catch { throw new ServiceError(400, "filter must be a valid contact scope JSON object") }
      send(res, 200, await directory({ ...filter,
        limit: Number(url.searchParams.get("limit") ?? 50), after_id: Number(url.searchParams.get("after_id") ?? 0),
        eligible_only: url.searchParams.get("eligible_only") === "true",
      }, url.searchParams.has("case_id") ? asId(url.searchParams.get("case_id"), "case_id") : undefined))
      return
    }
    send(res, 404, {error: "not found"}); return
  }
  if (req.method !== "POST") { send(res, 404, {error: "not found"}); return }
  const body = await readJson(req)
  if (path === "/profiles") {
    const lat = asNumber(body.lat, "lat"), lng = asNumber(body.lng, "lng")
    if (Math.abs(lat) > 90 || Math.abs(lng) > 180) throw new ServiceError(400, "Invalid profile coordinates")
    if (!Array.isArray(body.contact_profile_ids)) throw new ServiceError(400, "contact_profile_ids must be an array")
    send(res, 200, await registerProfile({ name: asString(body.name, "name"), phone: asString(body.phone, "phone"), lat, lng,
      contact_profile_ids: [...new Set(body.contact_profile_ids.map(value => asId(value, "contact_profile_id")))],
    })); return
  }
  if (path === "/simulation/incoming") {
    if (process.env.INBOUND_REQUESTS !== "1") throw new ServiceError(503, "Inbound receipt is not enabled")
    if (body.profile_id !== undefined) {
      const profile = (await profiles()).find(p => p.id === asId(body.profile_id, "profile_id"))
      if (!profile) throw new ServiceError(404, "Profile not found")
      body.from_phone = profile.phone
    }
    send(res, 200, await receiveInformationRequest(body)); return
  }
  if (path === "/incidents") { send(res, 200, await createInformationCase(body, actor)); return }
  if (path === "/drills/participants") { send(res, 200, await configureDrillParticipants(body, actor)); return }
  if (path === "/drills/wildfire") { send(res, 200, await startWildfireDrill(body, actor)); return }
  if (path === "/intake-configuration") { send(res, 200, await configureInformationIntake(body, actor)); return }
  const review = /^\/incoming-requests\/(\d+)\/review$/.exec(path)
  if (review) { send(res, 200, await reviewInformationIncoming(asId(review[1], "request_id"), body, actor)); return }
  if (path === "/calls/events") { send(res, 200, receiveCallEvent(body)); return }
  if (path === '/calls/coordinate') { send(res,200,await coordinateCall(body)); return }
  const coordinator = /^\/cases\/(\d+)\/coordinator$/.exec(path)
  if(coordinator) { send(res,200,await coordinatorCommand(asId(coordinator[1],'case_id'),body,actor));return }
  if (path === "/calls/report") { send(res, 200, await receiveInformationReport(body)); return }
  if (path === "/requests") {
    if (process.env.INBOUND_REQUESTS !== "1") throw new ServiceError(503, "Inbound receipt is not enabled")
    send(res, 200, await receiveInformationRequest(body)); return
  }
  if (path === "/simulation/report") {
    const attempt = (await attempts()).find(a => a.id === asId(body.attempt_id, "attempt_id"))
    if (!attempt?.call_id?.startsWith("sim_")) throw new ServiceError(409, "A simulated attempt is required")
    const receipt = await receiveInformationReport({...body, provider_call_id: attempt.call_id, direction: "outbound"})
    await callReducer("observeInformationTerminal", [attempt.id, attempt.call_id, "completed", "simulation completed"])
    send(res, 200, receipt); return
  }
  const retry = /^\/attempts\/(\d+)\/retry-interpretation$/.exec(path)
  if (retry) { send(res, 200, await retryInformationReport(asId(retry[1], "attempt_id"), body, actor)); return }
  const cancel = /^\/attempts\/(\d+)\/cancel$/.exec(path)
  if (cancel) { send(res, 200, await cancelInformationAttempt(asId(cancel[1], "attempt_id"), body, actor)); return }
  const route = /^\/cases\/(\d+)\/(configuration|calls|input|close)$/.exec(path)
  if (route) {
    const caseId = asId(route[1], "case_id")
    const result = route[2] === "configuration" ? await configureInformationCase(caseId, body, actor)
      : route[2] === "input" ? await inputInformationCase(caseId, body, actor)
      : route[2] === "close" ? await closeInformationCase(caseId, body, actor)
      : await requestInformationCall(caseId, body, actor)
    send(res, 200, result); return
  }
  send(res, 404, { error: "not found" })
}

function send(res: ServerResponse, status: number, body: unknown): void {
  if (res.headersSent || res.writableEnded) return
  res.writeHead(status, { "Content-Type": "application/json" })
  res.end(JSON.stringify(body))
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const raw = await readBody(req)
  if (raw.length === 0) return {}
  try {
    const value = JSON.parse(raw) as unknown
    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      return value as Record<string, unknown>
    }
  } catch {
    throw new ServiceError(400, "body must be a JSON object")
  }
  throw new ServiceError(400, "body must be a JSON object")
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on("data", (chunk: Buffer) => {
      size += chunk.length
      if (size > BODY_LIMIT) {
        reject(new ServiceError(400, "body is too large"))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")))
    req.on("error", reject)
  })
}
