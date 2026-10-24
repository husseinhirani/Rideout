import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import { loadEnv } from "./env"
import { recordCheckInResult, recordHelperAnswer, ServiceError, openIncident } from "./service"

const PORT = 8787
const BODY_LIMIT = 1_000_000

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
  if (req.method !== "POST") {
    send(res, 404, { error: "not found" })
    return
  }
  const body = await readJson(req)
  if (path === "/incidents") {
    send(res, 200, await openIncident({
      type: asString(body.type, "type"),
      lat: asNumber(body.lat, "lat"),
      lng: asNumber(body.lng, "lng"),
      radius_m: asNumber(body.radius_m, "radius_m"),
    }))
    return
  }
  if (path === "/check-ins") {
    send(res, 200, await recordCheckInResult({
      incident_id: asId(body.incident_id, "incident_id"),
      profile_id: asId(body.profile_id, "profile_id"),
      result: asString(body.result, "result"),
    }))
    return
  }
  if (path === "/find-helper") {
    send(res, 200, await recordHelperAnswer({
      support_case_id: asId(body.support_case_id, "support_case_id"),
      profile_id: asId(body.profile_id, "profile_id"),
      outcome: asString(body.outcome, "outcome"),
    }))
    return
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

function asString(value: unknown, name: string): string {
  if (typeof value === "string") return value
  throw new ServiceError(400, name + " must be a string")
}

function asNumber(value: unknown, name: string): number {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string" && value.trim().length > 0 && Number.isFinite(Number(value))) {
    return Number(value)
  }
  throw new ServiceError(400, name + " must be a number")
}

function asId(value: unknown, name: string): number {
  const id = asNumber(value, name)
  if (!Number.isSafeInteger(id) || id < 0) throw new ServiceError(400, name + " must be an integer")
  return id
}
