import { isTerminalCallStatus } from "./cartesia"
import { verifiedAttemptCall } from "./call-transcript"
import { ServiceError } from "./service"

/** Operator-only proxy. Provider credentials and full phone numbers never reach the UI. */
export async function attemptAudio(attemptId: number): Promise<Buffer | null> {
  const verified = await verifiedAttemptCall(attemptId)
  if (!verified || !isTerminalCallStatus(verified.call.status)) return null
  const callId = verified.callId
  const response = await fetch(`https://api.cartesia.ai/agents/calls/${encodeURIComponent(callId)}/audio`, {
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
