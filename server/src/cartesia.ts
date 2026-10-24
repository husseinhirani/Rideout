const CARTESIA_VERSION = "2026-08-14"
const CARTESIA_BASE_URL = "https://api.cartesia.ai"
const HTTP_TIMEOUT_MS = 30_000
const PHASE_CHECKIN = "checkin"

const E164 = /^\+[1-9]\d{1,14}$/

export type DynamicValue = string | number | boolean

export type CallRecord = {
  status: string
  endReason: string | null
  summary: string | null
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

export function placeCall(to: string, variables: Record<string, DynamicValue>): Promise<string> {
  if (E164.test(to) === false) {
    return Promise.reject(new Error("phone number must be E.164, for example +14155550123"))
  }
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
  return placeCall(to, { ...variables, phase: PHASE_CHECKIN })
}

export function placeHelperCall(to: string, variables: Record<string, DynamicValue>): Promise<string> {
  return placeCall(to, { ...variables, phase: "helper" })
}

export function placeBatch(
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
  return cartesiaJson("GET", "/agents/calls/" + encodeURIComponent(callId)).then((payload) => ({
    status: typeof payload.status === "string" ? payload.status : "",
    endReason: typeof payload.end_reason === "string" ? payload.end_reason : null,
    summary: typeof payload.summary === "string" ? payload.summary : null,
  }))
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
