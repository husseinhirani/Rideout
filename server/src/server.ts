import { readFileSync } from "node:fs"
import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import { resolve } from "node:path"
import { loadEnv } from "./env"
import {
  closeCase,
  getState,
  onCheckIn,
  onDispatcherInput,
  onReport,
  openCaseForVictim,
  openIncidentFromText,
  openIncidentStructured,
} from "./loop"
import { asId, asNumber, asString, optionalId, optionalString, ServiceError } from "./service"

const PORT = 8787
const BODY_LIMIT = 1_000_000
const UI = resolve(import.meta.dirname, "ui.html")

loadEnv()

const server = createServer((req, res) => {
  handle(req, res).catch((error: unknown) => {
    const status = error instanceof ServiceError ? error.status : 500
    send(res, status, { error: error instanceof Error ? error.message : "Request failed" })
  })
})

server.listen(Number(process.env.PORT ?? PORT), "127.0.0.1", () => {
  console.log("listening on http://127.0.0.1:" + String(process.env.PORT ?? PORT))
})

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const path = new URL(req.url ?? "/", "http://127.0.0.1").pathname
  if (req.method === "GET") {
    if (path === "/") {
      sendHtml(res, readFileSync(UI, "utf8"))
      return
    }
    if (path === "/state") {
      send(res, 200, await getState())
      return
    }
    send(res, 404, { error: "not found" })
    return
  }
  if (req.method !== "POST") {
    send(res, 404, { error: "not found" })
    return
  }
  const body = await readJson(req)

  // Only the two routes Cartesia calls. The dispatcher UI is served over
  // localhost and never carries the secret.
  if (path === "/calls/report" || path === "/check-ins") requireCallbackSecret(req)

  if (path === "/incidents") {
    // The dispatcher types a sentence. The structured body stays accepted so
    // seeding and tests can open an incident without Claude.
    if (typeof body.text === "string") {
      send(res, 200, await openIncidentFromText(body.text))
      return
    }
    send(res, 200, await openIncidentStructured({
      type: asString(body.type, "type"),
      lat: asNumber(body.lat, "lat"),
      lng: asNumber(body.lng, "lng"),
      radius_m: asNumber(body.radius_m, "radius_m"),
    }))
    return
  }
  if (path === "/check-ins") {
    send(res, 200, await onCheckIn({
      incident_id: asId(body.incident_id, "incident_id"),
      profile_id: asId(body.profile_id, "profile_id"),
      result: asString(body.result, "result"),
    }))
    return
  }
  if (path === "/calls/report") {
    send(res, 200, await onReport({
      attempt_id: optionalId(body.attempt_id, "attempt_id"),
      from_phone: optionalString(body.from_phone, "from_phone"),
      answer: asString(body.answer, "answer"),
      concern: optionalString(body.concern, "concern"),
    }))
    return
  }
  if (path === "/cases") {
    send(res, 200, await openCaseForVictim({
      incident_id: asId(body.incident_id, "incident_id"),
      victim_profile_id: asId(body.victim_profile_id, "victim_profile_id"),
      goal: asString(body.goal, "goal"),
    }))
    return
  }
  const caseInput = /^\/cases\/(\d+)\/input$/.exec(path)
  if (caseInput) {
    send(res, 200, await onDispatcherInput(Number(caseInput[1]), asString(body.text, "text")))
    return
  }
  const caseClose = /^\/cases\/(\d+)\/close$/.exec(path)
  if (caseClose) {
    send(res, 200, await closeCase(Number(caseClose[1])))
    return
  }
  send(res, 404, { error: "not found" })
}

// The ngrok URL is the only thing between the public internet and these
// routes, and anyone who learns it could inject notes into a live case.
// Unset means off, so a teammate without the variable still runs the loop.
function requireCallbackSecret(req: IncomingMessage): void {
  const secret = (process.env.CALLBACK_SECRET ?? "").trim()
  if (secret.length === 0) return
  if (req.headers.authorization !== "Bearer " + secret) {
    throw new ServiceError(401, "unauthorized")
  }
}

function send(res: ServerResponse, status: number, body: unknown): void {
  if (res.headersSent || res.writableEnded) return
  res.writeHead(status, { "Content-Type": "application/json" })
  res.end(JSON.stringify(body))
}

function sendHtml(res: ServerResponse, body: string): void {
  if (res.headersSent || res.writableEnded) return
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" })
  res.end(body)
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
