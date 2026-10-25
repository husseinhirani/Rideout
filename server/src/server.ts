import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import { resolve } from "node:path"
import { loadEnv } from "./env"
import { authorizeRequest, readAccessConfig } from "./operator-auth"
import { createLocalConsole } from "./local-console"
import { getState } from "./loop"
import { attempts, callReducer, incomingRequests, type ProfileRow } from "./db"
import { configureInformationCase, createInformationCase, directory, readInformationState, receiveInformationReport, requestInformationCall } from "./information"
import { receiveInformationRequest } from "./information-incoming"
import { startInformationWorker } from "./information-worker"
import { asId, ServiceError } from "./service"
import { contactScope } from "../shared/information"

const BODY_LIMIT = 1_000_000
loadEnv()
const access = readAccessConfig()
const port = Number(process.env.PORT ?? 8787)
const consolePort = Number(process.env.CONSOLE_PORT ?? 8788)
const actor = "local-operator"
if (process.env.AUTO_COORDINATE === "1" || process.env.COORDINATOR_SCRIPTED === "1") {
  throw new Error("Stage 1 uses explicit organizer calls. Disable AUTO_COORDINATE and COORDINATOR_SCRIPTED; adaptive planning follows its live checkpoint.")
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
})
createLocalConsole({ port: consolePort, apiPort: port, operatorSecret: access.operatorSecret,
  htmlPath: resolve(import.meta.dirname, "ui.html"),
}).listen(consolePort, "127.0.0.1", () => console.log("Local test console: http://127.0.0.1:" + consolePort))

async function state() {
  const [legacy, information, incoming] = await Promise.all([getState(), readInformationState(), incomingRequests()])
  return {
    ...legacy, read_model_version: 2, server_time_ms: Date.now(),
    profiles: (legacy.profiles as ProfileRow[]).map(({phone, ...profile}) => ({...profile, phone_last4: phone.slice(-4)})),
    incidents: [...legacy.incidents as unknown[], ...information.incidents.map(i => ({...i, kind: "information", type: "Information investigation", brief: ""}))],
    cases: [...legacy.cases as unknown[], ...information.cases.map(c => ({...c, kind: "information", goal: c.objective, victim_profile_id: null}))],
    profile_settings: information.settings, information_attempts: information.metadata,
    incoming_requests: incoming.map(({from_phone, decision_json, ...row}) => ({...row, phone_last4: from_phone.slice(-4), identity_status: "unverified"})),
  }
}
async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  authorizeRequest(req, access)
  const url = new URL(req.url ?? "/", "http://127.0.0.1")
  const path = url.pathname
  if (req.method === "GET") {
    if (path === "/state") { send(res, 200, await state()); return }
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
  if (path === "/incidents") { send(res, 200, await createInformationCase(body, actor)); return }
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
  const route = /^\/cases\/(\d+)\/(configuration|calls)$/.exec(path)
  if (route) {
    const result = route[2] === "configuration" ? await configureInformationCase(Number(route[1]), body, actor)
      : await requestInformationCall(Number(route[1]), body, actor)
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
