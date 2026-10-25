import { callReducer, incomingRequests } from "./db"
import { ServiceError } from "./service"

// Stage 1 receives accounts without choosing a case or treating a phone number
// as identity. Generic association and organizer review are the next live slice.
export async function receiveInformationRequest(body: Record<string, unknown>) {
  const { provider_call_id, from_phone, direction, text } = body
  if (typeof provider_call_id !== "string" || !provider_call_id || provider_call_id.length > 200
    || /[{}\s]/.test(provider_call_id) || typeof from_phone !== "string"
    || !/^\+[1-9]\d{7,14}$/.test(from_phone) || direction !== "inbound"
    || typeof text !== "string" || !text.trim() || text.length > 20_000) {
    throw new ServiceError(400, "Bound inbound call metadata and a complete account are required")
  }
  try { await callReducer("receiveIncomingRequest", [provider_call_id, from_phone, direction, text]) }
  catch (error) {
    if (error instanceof Error && /conflict/i.test(error.message)) throw new ServiceError(409, "A different final account is already saved for this call")
    throw error
  }
  const row = (await incomingRequests()).find(r => r.provider_call_id === provider_call_id)
  if (!row) throw new Error("Durable incoming receipt could not be read")
  // The durable raw receipt is enough to acknowledge saving, even if marking it
  // for association is interrupted. The startup scan also finds pending rows.
  let status: string = row.status
  if (row.status === "pending") {
    try {
      await callReducer("prepareIncomingRequest", [row.id, row.revision,
        JSON.stringify({ reason: "Case association requires organizer review", identity_status: "unverified" }),
        "needs_review", "I've saved your report for the organizer."])
      status = "needs_review"
    } catch { /* A concurrent request or next scan can complete this classification. */ }
  }
  return { request_id: row.id, status, reply: "I've saved your report for the organizer." }
}

export async function collectPendingInformationRequests(): Promise<void> {
  for (const row of await incomingRequests()) {
    if (row.status !== "pending") continue
    await receiveInformationRequest(row)
  }
}
