import { attempts, profiles } from "./db"
import { getCall, CartesiaServiceError } from "./cartesia"
import { verifyOutboundCallBinding } from "./provider-binding"
import { ServiceError } from "./service"

/** Operator-only proxy. Provider credentials and full phone numbers never reach the UI. */
export async function attemptAudio(attemptId: number): Promise<Buffer | null> {
  const attempt = (await attempts()).find(a => a.id === attemptId)
  if (!attempt) throw new ServiceError(404, "Call attempt not found")
  if (!attempt.call_id) return null
  if (attempt.call_id.startsWith("sim_")) throw new ServiceError(409, "Simulated calls have no phone audio")
  const person = (await profiles()).find(p => p.id === attempt.profile_id)
  let call
  try { call = await getCall(attempt.call_id) }
  catch (error) { if (error instanceof CartesiaServiceError && error.status === 404) return null; throw error }
  if (!person) throw new ServiceError(404, "Call participant not found")
  const binding = verifyOutboundCallBinding(call, {
    providerCallId: attempt.call_id, agentId: process.env.CARTESIA_AGENT_ID ?? "",
    toNumber: person.phone, attemptId: String(attempt.id),
  })
  if (binding.status === "pending") return null
  if (binding.status !== "matched") throw new ServiceError(409, "Call identity is not verified for audio playback")
  const response = await fetch(`https://api.cartesia.ai/agents/calls/${encodeURIComponent(attempt.call_id)}/audio`, {
    headers: { "X-API-Key": process.env.CARTESIA_API_KEY ?? "", "Cartesia-Version": "2026-08-14" },
    signal: AbortSignal.timeout(15000), redirect: "error",
  })
  if (!response.ok) {
    if ([404, 409, 425].includes(response.status)) return null
    throw new ServiceError(response.status === 404 ? 404 : 502, response.status === 404
      ? "The provider has not made this recording available yet. Try again shortly."
      : "The phone provider could not supply call audio.")
  }
  if (!response.headers.get("content-type")?.toLowerCase().startsWith("audio/")) throw new ServiceError(502, "The provider returned no playable audio")
  const chunks: Buffer[] = []; let size = 0
  if (!response.body) return null
  const reader = response.body.getReader()
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > 25 * 1024 * 1024) throw new ServiceError(413, "This recording is too large for the demo player")
      chunks.push(Buffer.from(value))
    }
  } finally { await reader.cancel().catch(() => undefined) }
  return size ? Buffer.concat(chunks) : null
}
