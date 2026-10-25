import type { CallRecord } from "./cartesia"

export type OutboundCallBinding = {
  providerCallId: string
  agentId: string
  toNumber: string
  attemptId: string
}

export type BindingResult = {
  status: "matched" | "conflict" | "pending"
  reason: string
}

// For recovering a call after an uncertain dispatch. A saved provider response
// can bind its call ID directly; this stricter check is for a candidate call ID
// whose association has not yet been established. Do not use the caller number
// on outbound: it is RideOut's line, not the recipient.
export function verifyOutboundCallBinding(call: CallRecord, expected: OutboundCallBinding): BindingResult {
  const checks: [string, string | null | undefined, string][] = [
    ["call ID", call.id, expected.providerCallId],
    ["agent", call.agentId, expected.agentId],
    ["direction", call.direction, "outbound"],
    ["destination", normalizedPhone(call.toNumber), normalizedPhone(expected.toNumber) ?? ""],
    ["attempt", call.attemptId, expected.attemptId],
  ]
  let missing = ""
  for (const [field, actual, wanted] of checks) {
    if (!wanted) return { status: "pending", reason: "Expected " + field + " is missing" }
    if (!actual) {
      missing ||= field
    } else if (actual !== wanted) {
      return { status: "conflict", reason: "Provider " + field + " does not match this attempt" }
    }
  }
  if (missing) return { status: "pending", reason: "Provider " + missing + " is unavailable" }
  return { status: "matched", reason: "Provider call matches the configured agent, destination and attempt" }
}

function normalizedPhone(value: string | null | undefined): string | null {
  const phone = (value ?? "").replace(/[\s().-]/g, "")
  return /^\+[1-9]\d{1,14}$/.test(phone) ? phone : null
}
