import { attempts, profiles } from "./db"
import { CartesiaServiceError, decodeCallTurns, getCall, isTerminalCallStatus, type CallTurn } from "./cartesia"
import { verifyOutboundCallBinding } from "./provider-binding"
import { ServiceError } from "./service"

// Live delivery is a bounded, transient cache. Saved transcripts are fetched from
// Cartesia after restart. These turns are display data, never invented reports.
const live = new Map<string, { updated: number; turns: Map<string, CallTurn> }>()

export function receiveCallEvent(body: unknown) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new ServiceError(400, "Invalid call event")
  const event = body as Record<string, unknown>
  if (event.agent_id !== process.env.CARTESIA_AGENT_ID) throw new ServiceError(403, "Unexpected call agent")
  if (typeof event.call_id !== "string" || !event.call_id) throw new ServiceError(400, "Missing call ID")
  const now = Date.now()
  for (const [id, entry] of live) if (now - entry.updated > 2 * 60 * 60 * 1000) live.delete(id)
  const call = event.call && typeof event.call === "object" ? event.call as Record<string, unknown> : {}
  const turns = decodeCallTurns(event.type === "call_turn" ? [event.turn ?? event.body] : call.transcript)
  if (turns.length) {
    const entry = live.get(event.call_id) ?? { updated: now, turns: new Map<string, CallTurn>() }
    entry.updated = now
    for (const turn of turns) entry.turns.set(turn.id, turn)
    while (entry.turns.size > 2000) entry.turns.delete(entry.turns.keys().next().value!)
    live.set(event.call_id, entry)
    while (live.size > 100) live.delete(live.keys().next().value!)
  }
  return { status: "received" }
}

/** The same binding gate protects transcript and audio, before either reaches an operator. */
export async function verifiedAttemptCall(attemptId: number) {
  const attempt = (await attempts()).find(a => a.id === attemptId)
  if (!attempt) throw new ServiceError(404, "Call attempt not found")
  if (!attempt.call_id) return null
  if (attempt.call_id.startsWith("sim_")) throw new ServiceError(409, "Simulated calls have no provider conversation")
  const person = (await profiles()).find(p => p.id === attempt.profile_id)
  if (!person) throw new ServiceError(404, "Call participant not found")
  let call
  try { call = await getCall(attempt.call_id) }
  catch (error) {
    if (error instanceof CartesiaServiceError && error.status === 404) return null
    throw new ServiceError(502, "The phone provider could not supply the conversation. Retrying shortly.")
  }
  const binding = verifyOutboundCallBinding(call, {
    providerCallId: attempt.call_id, agentId: process.env.CARTESIA_AGENT_ID ?? "",
    toNumber: person.phone, attemptId: String(attempt.id),
  })
  if (binding.status === "pending") return null
  if (binding.status !== "matched") throw new ServiceError(409, "Call identity is not verified")
  return { call, callId: attempt.call_id }
}

export async function attemptTranscript(attemptId: number) {
  const verified = await verifiedAttemptCall(attemptId)
  if (!verified) return { turns: [], ended: false, saved: false }
  const { call, callId } = verified
  const ended = isTerminalCallStatus(call.status)
  const turns = new Map<string, CallTurn>()
  for (const turn of live.get(callId)?.turns.values() ?? []) turns.set(turn.id, turn)
  for (const turn of call.transcript ?? []) turns.set(turn.id, turn)
  return { turns: [...turns.values()].sort((a, b) => a.start - b.start), ended,
    saved: ended && Boolean(call.transcript?.length) }
}
