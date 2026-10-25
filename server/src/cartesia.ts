import { ensureCallEvents } from "./call-events-setup"
import { checkLocalCallbackRuntime } from "./callback-health"

const CARTESIA_VERSION = "2026-08-14"
const CARTESIA_BASE_URL = "https://api.cartesia.ai"
const HTTP_TIMEOUT_MS = 30_000
const CHECKIN_ASK = "Are you safe right now, and can you get out on your own?"

const E164 = /^\+[1-9]\d{1,14}$/

export type DynamicValue = string | number | boolean

export type CallTurn = {
  id: string
  role: "assistant" | "user"
  text: string
  start: number
  interrupted: boolean
}

export function decodeCallTurns(value: unknown): CallTurn[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((raw): CallTurn[] => {
    const turn = objectOrEmpty(raw)
    if ((turn.role !== "assistant" && turn.role !== "user") || typeof turn.text !== "string" || !turn.text.trim()) return []
    const start = typeof turn.start_timestamp === "number" && Number.isFinite(turn.start_timestamp) ? Math.max(0, turn.start_timestamp) : 0
    return [{ id: String(turn.id ?? `${turn.role}:${start}`), role: turn.role, text: turn.text,
      start, interrupted: turn.was_interrupted === true }]
  }).sort((a, b) => a.start - b.start)
}

export type CallRecord = {
  status: string
  endReason: string | null
  summary: string | null
  // Optional for legacy consumers and test adapters. getCall returns these
  // fields explicitly; missing provider metadata stays null, never inferred.
  id?: string | null
  agentId?: string | null
  agentVersionId?: string | null
  direction?: string | null
  fromNumber?: string | null
  toNumber?: string | null
  attemptId?: string | null
  transcript?: CallTurn[]
}

export class CartesiaServiceError extends Error {
  status?: number
  errorCode?: string
  title?: string
  requestId?: string

  constructor(
    message: string,
    fields: { status?: number; errorCode?: string; title?: string; requestId?: string } = {},
  ) {
    super(message)
    this.name = "CartesiaServiceError"
    this.status = fields.status
    this.errorCode = fields.errorCode
    this.title = fields.title
    this.requestId = fields.requestId
  }
}

export async function placeCall(to: string, variables: Record<string, DynamicValue>): Promise<string> {
  if (E164.test(to) === false) {
    return Promise.reject(new Error("phone number must be E.164, for example +14155550123"))
  }
  // SIMULATE=1 runs the whole loop without spending call minutes. The answer is
  // posted back to /calls/report by hand from the test UI.
  if (process.env.SIMULATE === "1") {
    const simulated = "sim_" + Math.random().toString(36).slice(2, 12)
    console.log("simulate dial for attempt " + String(variables.attempt_id ?? "unbound") + " to number ending " + to.slice(-4))
    return Promise.resolve(simulated)
  }
  await verifyCallDestination()
  await ensureCallEvents(cartesiaJson)
  return postJson("/agents/calls", {
    from_number_id: requireEnv("CARTESIA_FROM_NUMBER_ID"),
    agent_id: requireEnv("CARTESIA_AGENT_ID"),
    outbound_calls: [{ to_number: to, dynamic_variables: variables }],
  }).then((payload) => {
    const call = firstCall(payload)
    const failure = callError(call)
    if (failure) throw new CartesiaServiceError(failure)
    const agentCallId = call.agent_call_id
    if (typeof agentCallId !== "string" || agentCallId.length === 0) {
      throw new CartesiaServiceError("Cartesia returned no agent_call_id")
    }
    return agentCallId
  })
}

export function placeCheckInCall(
  to: string,
  variables: Record<string, DynamicValue> = {},
): Promise<string> {
  return placeCall(to, { ask: CHECKIN_ASK, context: "", person_name: "", ...variables })
}

export async function placeBatch(
  recipients: { to: string; variables: Record<string, DynamicValue> }[],
): Promise<string> {
  if (recipients.length === 0) {
    return Promise.reject(new Error("recipients is empty"))
  }
  for (const recipient of recipients) {
    if (E164.test(recipient.to) === false) {
      return Promise.reject(new Error("phone number must be E.164, for example +14155550123"))
    }
  }
  await verifyCallDestination()
  await ensureCallEvents(cartesiaJson)
  return postJson("/agents/calls/batches", {
    from_number_id: requireEnv("CARTESIA_FROM_NUMBER_ID"),
    agent_id: requireEnv("CARTESIA_AGENT_ID"),
    recipients: recipients.map((recipient) => ({
      to_number: recipient.to,
      dynamic_variables: recipient.variables,
    })),
  }).then((payload) => {
    if (typeof payload.id !== "string" || payload.id.length === 0) {
      throw new CartesiaServiceError("Cartesia returned no batch id")
    }
    return payload.id
  })
}

export function getCall(callId: string): Promise<CallRecord> {
  return cartesiaJson("GET", "/agents/calls/" + encodeURIComponent(callId)).then(decodeCallRecord)
}

export function decodeCallRecord(payload: JsonObject): CallRecord {
  const telephony = objectOrEmpty(payload.telephony_params)
  const variables = objectOrEmpty(payload.dynamic_variables)
  return {
    status: textOrNull(payload.status) ?? "",
    endReason: textOrNull(payload.end_reason),
    summary: textOrNull(payload.summary),
    id: textOrNull(payload.id),
    agentId: textOrNull(payload.agent_id),
    agentVersionId: textOrNull(payload.agent_version_id),
    direction: textOrNull(telephony.direction),
    fromNumber: textOrNull(telephony.from),
    toNumber: textOrNull(telephony.to),
    attemptId: textOrNull(variables.attempt_id),
    transcript: decodeCallTurns(payload.transcript),
  }
}

export function isTerminalCallStatus(status: string): boolean {
  return status === "completed" || status === "failed"
}

function textOrNull(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null
}

function objectOrEmpty(value: unknown): JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as JsonObject
    : {}
}

function postJson(path: string, body: unknown): Promise<JsonObject> {
  return cartesiaJson("POST", path, body)
}

export async function cartesiaJson(
  method: "GET" | "POST" | "PATCH",
  path: string,
  body?: unknown,
): Promise<JsonObject> {
  let response: Response
  try {
    response = await fetch(CARTESIA_BASE_URL + path, {
      method,
      headers: {
        "X-API-Key": requireEnv("CARTESIA_API_KEY"),
        "Cartesia-Version": CARTESIA_VERSION,
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    })
  } catch (error) {
    const reason = error instanceof Error ? error.message : "request failed"
    throw new CartesiaServiceError("Cartesia could not be reached: " + reason)
  }
  const payload = await readJson(response)
  if (!response.ok) {
    throw errorFromPayload(response.status, payload)
  }
  return payload
}

export type JsonObject = Record<string, unknown>

async function readJson(response: Response): Promise<JsonObject> {
  const raw = await response.text()
  if (raw.length === 0) return {}
  try {
    const value = JSON.parse(raw) as unknown
    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      return value as JsonObject
    }
  } catch {
    return { message: raw }
  }
  return {}
}

function firstCall(payload: JsonObject): JsonObject {
  const calls = payload.calls
  if (!Array.isArray(calls) || calls.length === 0) {
    throw new CartesiaServiceError("Cartesia returned no call")
  }
  const call = calls[0]
  if (typeof call !== "object" || call === null || Array.isArray(call)) {
    throw new CartesiaServiceError("Cartesia returned no call")
  }
  return call as JsonObject
}

function callError(call: JsonObject): string {
  const error = call.error
  if (typeof error === "string" && error.length > 0) return error
  if (typeof error === "object" && error !== null && !Array.isArray(error)) {
    const body = error as JsonObject
    if (typeof body.message === "string" && body.message.length > 0) return body.message
    if (Object.keys(body).length > 0) return JSON.stringify(body)
  }
  return ""
}

function errorFromPayload(status: number, payload: JsonObject): CartesiaServiceError {
  const message = typeof payload.message === "string" && payload.message.length > 0
    ? payload.message
    : "Cartesia rejected the call (" + String(status) + ")"
  return new CartesiaServiceError(message, {
    status,
    errorCode: typeof payload.error_code === "string" ? payload.error_code : undefined,
    title: typeof payload.title === "string" ? payload.title : undefined,
    requestId: typeof payload.request_id === "string" ? payload.request_id : undefined,
  })
}

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(name + " is not set")
  return value
}

/** Check every dispatch: a shared agent or tunnel can be reassigned after API startup. */
async function verifyCallDestination(): Promise<void> {
  if (process.env.SIMULATE === "1") return
  const base = new URL(requireEnv("NGROK_URL"))
  if (base.protocol !== "https:" || base.username || base.password || base.search || base.hash || base.pathname !== "/")
    throw new Error("NGROK_URL must be an HTTPS origin")
  await checkLocalCallbackRuntime(base.origin, requireEnv("CALLBACK_SECRET"))
  const query = new URLSearchParams({ type: "webhook", limit: "100", agent_id: requireEnv("CARTESIA_AGENT_ID") })
  const payload = await cartesiaJson("GET", "/v1/agents/tools?" + query)
  const attached = Array.isArray(payload.data) ? payload.data.map(objectOrEmpty) : []
  for (const [name, path] of [["report_call", "/calls/report"], ["coordinate_call", "/calls/coordinate"]]) {
    const matches = attached.filter(tool => tool.name === name)
    if (matches.length !== 1 || objectOrEmpty(matches[0].api_schema).url !== base.origin + path)
      throw new Error("The hosted " + name + " tool does not point to this API. Run npm --prefix server run setup-agent with this machine's NGROK_URL before placing calls.")
  }
}
