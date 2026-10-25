import { timingSafeEqual } from "node:crypto"
import type { IncomingMessage } from "node:http"
import { ServiceError } from "./service"

export type AccessConfig = {
  operatorSecret: string
  callbackSecret: string
  simulate: boolean
  operatorOrigins: ReadonlySet<string>
}

const CALLBACK_PATHS = new Set(["/requests", "/calls/report", "/calls/events", "/calls/coordinate", "/check-ins"])

export function isCallbackPath(path: string): boolean {
  return CALLBACK_PATHS.has(path)
}

export function readAccessConfig(env: NodeJS.ProcessEnv = process.env): AccessConfig {
  const operatorSecret = (env.OPERATOR_SECRET ?? "").trim()
  const callbackSecret = (env.CALLBACK_SECRET ?? "").trim()
  const simulate = env.SIMULATE === "1"
  if (!operatorSecret) throw new Error("OPERATOR_SECRET is required")
  if (!simulate && !callbackSecret) throw new Error("CALLBACK_SECRET is required for live calls")
  if (callbackSecret === operatorSecret) throw new Error("OPERATOR_SECRET and CALLBACK_SECRET must be different")
  const port = Number(env.CONSOLE_PORT ?? "8788")
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error("CONSOLE_PORT must be a valid port")
  const operatorOrigins = new Set([
    "http://127.0.0.1:" + port,
    "http://localhost:" + port,
  ])
  for (const raw of (env.OPERATOR_ORIGINS ?? "").split(",").map((value) => value.trim()).filter(Boolean)) {
    let origin: URL
    try { origin = new URL(raw) } catch { throw new Error("OPERATOR_ORIGINS must contain exact HTTP origins") }
    if (!["http:", "https:"].includes(origin.protocol) || origin.origin !== raw) {
      throw new Error("OPERATOR_ORIGINS must contain exact HTTP origins without paths")
    }
    operatorOrigins.add(raw)
  }
  return { operatorSecret, callbackSecret, simulate, operatorOrigins }
}

/** Call before reading bodies or invoking handlers. No Host/forwarded-header auth bypass. */
export function authorizeRequest(req: IncomingMessage, config: AccessConfig): void {
  const path = new URL(req.url ?? "/", "http://127.0.0.1").pathname
  if (isCallbackPath(path)) {
    if (req.method !== "POST") throw new ServiceError(405, "callback requires POST")
    // Simulated reports use explicit operator endpoints, never a credential-free provider route.
    if (!config.callbackSecret) throw new ServiceError(503, "Callback authentication is not configured")
    if (path === "/calls/events") {
      const header = req.headers["x-webhook-secret"]
      requireBearer(typeof header === "string" ? "Bearer " + header : undefined, config.callbackSecret)
    } else requireBearer(req.headers.authorization, config.callbackSecret)
    return
  }
  requireBearer(req.headers.authorization, config.operatorSecret)
  const origin = req.headers.origin
  if (origin !== undefined && !config.operatorOrigins.has(origin)) throw new ServiceError(403, "operator origin is not allowed")
  if (path.startsWith("/simulation/")) assertSimulationEnabled(config)
}

export function assertSimulationEnabled(config: Pick<AccessConfig, "simulate">): void {
  if (!config.simulate) throw new ServiceError(403, "Simulation controls are disabled in live mode")
}

function requireBearer(header: string | undefined, secret: string): void {
  const actual = Buffer.from(header ?? "")
  const expected = Buffer.from("Bearer " + secret)
  if (!secret || actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    throw new ServiceError(401, "unauthorized")
  }
}
