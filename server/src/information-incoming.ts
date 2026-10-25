import { callReducer, incomingRequests, profiles, attempts, attemptProgress, type IncomingRequestRow } from "./db"
import { ServiceError } from "./service"
import { readInformationState, readInformationIncomingState } from "./information"
import { interpretInformationIncoming } from "./agent"
import { canonicalJson, normalizePhone } from "../shared/information"
import { incomingCandidateIds, type InformationIncomingAssessment } from "../shared/information-incoming"

const inFlight = new Map<number, Promise<void>>()
const RECEIPT_WAIT_MS = 18_000

function receipt(row: IncomingRequestRow) {
  const status: string = row.status
  if (status === "needs_clarification") return { request_id: row.id, status, reply: row.reply }
  return {
    request_id: row.id,
    status: status === "attached" || status === "rejected" ? "recorded" : status,
    reply: status === "pending" || status === "prepared"
      ? "I've saved your report. It is still being processed."
      : "I've saved your report for the organizer.",
  }
}

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
  if (row.status !== "pending") return receipt(row)

  // Give a clarification a chance to reach this conversation. A slow model does
  // not prevent acknowledgment of the already durable receipt.
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([processRequest(row.id), new Promise<void>(resolve => {
      timer = setTimeout(resolve, RECEIPT_WAIT_MS)
    })])
  } finally { if (timer) clearTimeout(timer) }
  return receipt((await incomingRequests()).find(r => r.id === row.id) ?? row)
}

function processRequest(id: number): Promise<void> {
  const existing = inFlight.get(id)
  if (existing) return existing
  const pending = processOne(id).catch(error => {
    // Failures to persist retry state must remain visible without rejecting the
    // authenticated receipt or leaving an unhandled background rejection.
    console.error(`incoming request ${id}: ${error instanceof Error ? error.message : "processing failed"}`)
  }).finally(() => { inFlight.delete(id) })
  inFlight.set(id, pending)
  return pending
}

function review(reason: string): InformationIncomingAssessment {
  return { kind: "review", case_id: null, description: "", objective: "", clarification: null, reason }
}

async function processOne(id: number): Promise<void> {
  const row = (await incomingRequests()).find(r => r.id === id)
  if (!row || row.status !== "pending" || row.retry_at_ms > Date.now()) return
  try {
    const [before, incomingBefore] = await Promise.all([readInformationState(), readInformationIncomingState()])
    const [directory, calls, progress] = await Promise.all([profiles(), attempts(), attemptProgress()])
    const [state, incoming] = await Promise.all([readInformationState(), readInformationIncomingState()])
    // SQL reads are separate requests. Do not feed Claude an account assembled
    // across a material case/configuration change. The reducer checks again.
    const snapshotKey = (s: typeof state, i: typeof incoming) => canonicalJson({
      cases: s.cases.map(c => ({ id: c.id, revision: c.input_revision, status: c.status, scope: c.scope })).sort((a, b) => a.id - b.id),
      settings: s.settings.map(p => ({ id: p.profile_id, intake_allowed: p.intake_allowed })).sort((a, b) => a.id - b.id),
      configuration: i.configuration, resolutions: [...i.resolutions].sort((a, b) => a.request_id - b.request_id),
    })
    if (snapshotKey(before, incomingBefore) !== snapshotKey(state, incoming)) return

    const matches = directory.filter(p => normalizePhone(p.phone) === normalizePhone(row.from_phone))
    const profile = matches.length === 1 ? matches[0] : null
    const candidateIds = profile ? incomingCandidateIds(profile.id, state.cases,
      calls.map(a => ({ ...a, dispatched: Boolean(a.call_id || progress.find(p => p.attempt_id === a.id)?.claim_token) })),
      incoming.resolutions) : []
    const candidates = candidateIds.map(id => state.cases.find(c => c.id === id)!)
    const intakeAllowed = Boolean(profile && incoming.configuration.enabled
      && state.settings.find(p => p.profile_id === profile.id)?.intake_allowed)

    let assessment: InformationIncomingAssessment
    if (!profile) assessment = review(matches.length ? "Caller number matches multiple profiles; organizer association is required." : "Caller is not associated with a unique directory profile; organizer association is required.")
    else if (!candidates.length && !intakeAllowed) assessment = review("No eligible case association or permission to open an investigation; organizer review is required.")
    else assessment = await interpretInformationIncoming({
      account: row.text, intake_allowed: intakeAllowed,
      candidates: candidates.map(c => ({ case_id: c.id, objective: c.objective,
        description: state.incidents.find(i => i.id === c.incident_id)?.description ?? "" })),
    })
    if (assessment.kind === "update" && !candidateIds.includes(assessment.case_id!)) throw new Error("Incoming assessment selected an unavailable case")
    if ((assessment.kind === "intake" || assessment.kind === "clarification") && !intakeAllowed) throw new Error("Incoming assessment exceeded intake permission")
    await callReducer("prepareInformationIncoming", [row.id, row.revision, JSON.stringify({
      profile_id: profile?.id ?? null, line_revision: incoming.configuration.revision,
      candidate_revisions: candidates.map(c => ({ case_id: c.id, input_revision: c.input_revision })), assessment,
    })])
  } catch (error) {
    if (error instanceof Error && /stale|context changed/i.test(error.message)) return
    const current = (await incomingRequests()).find(r => r.id === row.id)
    if (current?.status === "pending" && current.revision === row.revision) {
      await callReducer("failIncomingRequest", [row.id, row.revision])
    }
  }
}

export async function collectPendingInformationRequests(): Promise<void> {
  for (const row of await incomingRequests()) {
    if (row.status === "pending" && row.retry_at_ms <= Date.now()) void processRequest(row.id)
  }
}
