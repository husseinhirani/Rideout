import { SenderError, t } from "spacetimedb/server"
import type { ReducerCtx } from "spacetimedb/server"
import spacetimedb, { ANSWERED, CALL, CANCELLED, CLOSED, CONCERN, OPEN, SUPERSEDED, VICTIM } from "../models"

type Ctx = ReducerCtx<typeof spacetimedb.schemaType>
const nowMs = (ctx: Ctx) => Number(ctx.timestamp.microsSinceUnixEpoch) / 1000
const progressFor = (ctx: Ctx, id: bigint) => {
  const progress = ctx.db.caseProgress.support_case_id.find(id)
  if (!progress) throw new SenderError("Coordination is not enabled")
  return progress
}
const attemptFor = (ctx: Ctx, id: bigint) => {
  const attempt = ctx.db.attempt.id.find(id)
  const progress = ctx.db.attemptProgress.attempt_id.find(id)
  if (!attempt || !progress) throw new SenderError("Coordination attempt not found")
  return { attempt, progress }
}

// Keep the existing dashboard JSON current without a second, fallible model call.
function refreshCoordinationBrief(ctx: Ctx, caseId: bigint) {
  const current = ctx.db.supportCase.id.find(caseId)
  const progress = ctx.db.caseProgress.support_case_id.find(caseId)
  if (!current || !progress) return
  const attempts = [...ctx.db.attemptProgress.support_case_id.filter(caseId)]
  const waiting = attempts.filter(row => !["ended", "cancelled"].includes(row.transport)).length
  const notes = [...ctx.db.note.support_case_id.filter(caseId)]
    .sort((a, b) => a.id < b.id ? -1 : 1).slice(-6).map(note => note.text)
  for (const state of attempts.filter(row => row.report_received && !row.report_processed)) {
    const attempt = ctx.db.attempt.id.find(state.attempt_id)!
    const profile = ctx.db.profile.id.find(attempt.profile_id)!
    notes.push(`${profile.name}: ${attempt.answer} (interpretation pending)`)
  }
  const status = current.status === CLOSED ? "Case closed." : progress.blocked_reason
    ? `Coordination blocked: ${progress.blocked_reason}.`
    : waiting ? `Waiting on ${waiting} call(s) to finish.` : "No calls awaiting completion."
  const summary = `${current.goal}. ${status} Latest reports (not verified): ${notes.length ? notes.join("; ") : "None yet."}`
  ctx.db.supportCase.id.update({ ...current, brief: JSON.stringify({ summary, suggestions: [] }) })
  const incident = ctx.db.incident.id.find(current.incident_id)
  if (!incident) return
  const summaries = [...ctx.db.supportCase.incident_id.filter(current.incident_id)].map(row => {
    try { return JSON.parse(row.brief).summary || row.goal } catch { return row.goal }
  })
  ctx.db.incident.id.update({ ...incident, brief: JSON.stringify({ summary: summaries.join("\n"), suggestions: [] }) })
}

// Every meaningful input supersedes work which has not crossed the claim boundary.
export function coordinationInput(ctx: Ctx, id: bigint) {
  const current = ctx.db.caseProgress.support_case_id.find(id)
  if (!current) return
  for (const progress of ctx.db.attemptProgress.support_case_id.filter(id)) {
    if (progress.transport !== "queued") continue
    const attempt = ctx.db.attempt.id.find(progress.attempt_id)!
    ctx.db.attemptProgress.attempt_id.update({ ...progress, transport: "cancelled" })
    ctx.db.attempt.id.update({ ...attempt, outcome: SUPERSEDED })
  }
  ctx.db.caseProgress.support_case_id.update({ ...current, input_revision: current.input_revision + 1n, failure_count: 0, retry_at_ms: undefined, blocked_reason: "" })
  refreshCoordinationBrief(ctx, id)
}

function eligibleHelper(ctx: Ctx, caseId: bigint, profileId: bigint) {
  const current = ctx.db.supportCase.id.find(caseId)
  if (!current) throw new SenderError("Support case not found")
  const profile = ctx.db.profile.id.find(profileId)
  const victim = ctx.db.profile.id.find(current.victim_profile_id)
  if (!profile || profileId === current.victim_profile_id || !/^\+[1-9]\d{7,14}$/.test(profile.phone) || profile.phone === victim?.phone) throw new SenderError("Helper must have a distinct E164 destination")
  if ([...ctx.db.incidentPerson.incident_id.filter(current.incident_id)].some(row => row.profile_id === profileId && row.status === VICTIM)) throw new SenderError("Victims cannot be called as helpers")
  return profile
}

export const enableCoordination = spacetimedb.reducer(
  { support_case_id: t.u64(), helper_profile_ids: t.array(t.u64()) },
  (ctx, { support_case_id, helper_profile_ids }) => {
    const existing = ctx.db.caseProgress.support_case_id.find(support_case_id)
    if (existing) {
      if (helper_profile_ids.length === 2 && new Set(helper_profile_ids).size === 2 && helper_profile_ids.every(id => existing.helper_profile_ids.includes(id))) return
      throw new SenderError("Coordination helper configuration cannot change")
    }
    const current = ctx.db.supportCase.id.find(support_case_id)
    if (!current || current.status !== OPEN) throw new SenderError("Support case must be open")
    if ([...ctx.db.attempt.support_case_id.filter(support_case_id)].length) throw new SenderError("Cannot enable coordination with existing attempts")
    if (helper_profile_ids.length !== 2 || new Set(helper_profile_ids).size !== 2) throw new SenderError("Exactly two distinct helpers required")
    const helpers = helper_profile_ids.map(id => eligibleHelper(ctx, support_case_id, id))
    if (helpers[0].phone === helpers[1].phone) throw new SenderError("Helpers must have distinct destinations")
    ctx.db.caseProgress.insert({ support_case_id, helper_profile_ids, input_revision: 1n, evaluated_revision: 0n, failure_count: 0, retry_at_ms: undefined, blocked_reason: "" })
  },
)

export const receiveCoordinationReport = spacetimedb.reducer(
  { attempt_id: t.u64(), answer: t.string(), concern: t.string() },
  (ctx, { attempt_id, answer, concern }) => {
    if (!answer.trim()) throw new SenderError("Report answer is required")
    const { attempt, progress } = attemptFor(ctx, attempt_id)
    if (progress.report_received) {
      if (attempt.answer === answer && progress.raw_concern === concern) return
      throw new SenderError("A different final report already exists")
    }
    if (progress.transport === "queued" || progress.transport === "cancelled") throw new SenderError("Attempt was never dispatched")
    ctx.db.attempt.id.update({ ...attempt, answer, concern })
    ctx.db.attemptProgress.attempt_id.update({ ...progress, report_received: true, raw_concern: concern, report_received_at_ms: nowMs(ctx) })
    coordinationInput(ctx, attempt.support_case_id)
  },
)

type ReportNote = { text: string; has_place: boolean; lat?: number; lng?: number; radius_m?: number }
function parseNotes(json: string): ReportNote[] {
  const notes: unknown = JSON.parse(json)
  if (!Array.isArray(notes) || notes.length > 100) throw new SenderError("Invalid report notes")
  for (const note of notes) {
    if (!note || typeof note.text !== "string" || !note.text.trim() || note.text.length > 10_000 || typeof note.has_place !== "boolean") throw new SenderError("Invalid report note")
    if (note.has_place && (!Number.isFinite(note.lat) || Math.abs(note.lat) > 90 || !Number.isFinite(note.lng) || Math.abs(note.lng) > 180 || !Number.isFinite(note.radius_m) || note.radius_m < 0)) throw new SenderError("Invalid note coordinates")
  }
  return notes
}
export const finishCoordinationReport = spacetimedb.reducer(
  { attempt_id: t.u64(), reached: t.bool(), accepted: t.bool(), notes_json: t.string(), concern: t.string() },
  (ctx, { attempt_id, reached, accepted, notes_json, concern }) => {
    const { attempt, progress } = attemptFor(ctx, attempt_id)
    if (progress.report_processed) return
    if (!progress.report_received) throw new SenderError("Raw report must be received first")
    const notes = parseNotes(notes_json)
    const profile = ctx.db.profile.id.find(attempt.profile_id)!
    const insertNote = (note: ReportNote, source: string) => ctx.db.note.insert({ id: 0n, support_case_id: attempt.support_case_id, attempt_id, source, text: `${profile.name}: ${note.text}`, lat: note.has_place ? note.lat : undefined, lng: note.has_place ? note.lng : undefined, radius_m: note.has_place ? note.radius_m : undefined, at: ctx.timestamp })
    for (const note of notes) insertNote(note, CALL)
    const combinedConcern = [progress.raw_concern, concern].filter((value, index, all) => value.trim() && all.indexOf(value) === index).join("; ")
    if (combinedConcern) insertNote({ text: combinedConcern, has_place: false }, CONCERN)
    ctx.db.attempt.id.update({ ...attempt, outcome: reached ? ANSWERED : "not_reached", concern: combinedConcern })
    ctx.db.attemptProgress.attempt_id.update({ ...progress, report_processed: true, accepted_at_ms: reached && accepted ? progress.report_received_at_ms : undefined, transport: attempt.call_id?.startsWith("sim_") ? "ended" : progress.transport })
    coordinationInput(ctx, attempt.support_case_id)
  },
)

export const commitCoordinationPlan = spacetimedb.reducer(
  { support_case_id: t.u64(), expected_revision: t.u64(), calls_json: t.string() },
  (ctx, { support_case_id, expected_revision, calls_json }) => {
    const current = ctx.db.supportCase.id.find(support_case_id)
    const progress = progressFor(ctx, support_case_id)
    if (current?.status !== OPEN || progress.input_revision !== expected_revision || progress.evaluated_revision === expected_revision) throw new SenderError("Stale or closed coordination plan")
    const history = [...ctx.db.attemptProgress.support_case_id.filter(support_case_id)]
    if (history.some(row => row.report_received && !row.report_processed)) throw new SenderError("Reports must be processed before planning")
    const calls: unknown = JSON.parse(calls_json)
    if (!Array.isArray(calls) || calls.length > 2) throw new SenderError("Invalid call set")
    const ids = new Set<bigint>(); const phones = new Set<string>()
    for (const call of calls) {
      if (!call || !Number.isSafeInteger(call.profile_id) || call.profile_id <= 0 || typeof call.ask !== "string" || !call.ask.trim() || typeof call.context !== "string" || !call.context.trim()) throw new SenderError("Invalid call")
      const id = BigInt(call.profile_id)
      if (!progress.helper_profile_ids.includes(id) || ids.has(id)) throw new SenderError("Call must select distinct configured helpers")
      const profile = eligibleHelper(ctx, support_case_id, id)
      if (phones.has(profile.phone)) throw new SenderError("Duplicate destination")
      ids.add(id); phones.add(profile.phone)
      const previous = history.filter(row => row.transport !== "cancelled" && ctx.db.attempt.id.find(row.attempt_id)?.profile_id === id)
      if (previous.length >= 2) throw new SenderError("Helper call budget exhausted")
      if (previous.some(row => row.transport !== "ended" || row.accepted_at_ms === undefined || row.accepted_at_ms + 10_000 > nowMs(ctx))) throw new SenderError("Helper follow-up is not due or transport remains unresolved")
    }
    for (const call of calls) {
      const attempt = ctx.db.attempt.insert({ id: 0n, support_case_id, profile_id: BigInt(call.profile_id), ask: call.ask, call_id: undefined, outcome: undefined, answer: "", concern: "", created_at: ctx.timestamp })
      ctx.db.attemptProgress.insert({ attempt_id: attempt.id, support_case_id, context: call.context, transport: "queued", claim_token: "", dispatch_error: "", claimed_at_ms: undefined, report_received: false, report_processed: false, raw_concern: "", report_received_at_ms: undefined, accepted_at_ms: undefined, review_consumed: false })
    }
    ctx.db.caseProgress.support_case_id.update({ ...progress, evaluated_revision: expected_revision, failure_count: 0, retry_at_ms: undefined, blocked_reason: "" })
    refreshCoordinationBrief(ctx, support_case_id)
  },
)

export const claimCoordinationAttempt = spacetimedb.reducer(
  { attempt_id: t.u64(), claim_token: t.string() },
  (ctx, { attempt_id, claim_token }) => {
    const { attempt, progress } = attemptFor(ctx, attempt_id)
    const current = ctx.db.supportCase.id.find(attempt.support_case_id)
    const state = progressFor(ctx, attempt.support_case_id)
    if (!claim_token.trim() || progress.transport !== "queued" || current?.status !== OPEN || state.evaluated_revision !== state.input_revision) throw new SenderError("Attempt cannot be claimed")
    const profile = eligibleHelper(ctx, attempt.support_case_id, attempt.profile_id)
    for (const other of ctx.db.attempt.iter()) {
      if (other.id === attempt_id || ctx.db.profile.id.find(other.profile_id)?.phone !== profile.phone) continue
      const transport = ctx.db.attemptProgress.attempt_id.find(other.id)?.transport
      // Legacy outcomes describe reports, not transport. Use fresh destinations
      // or a dedicated demo database; preserve legacy work rather than deleting it.
      if (!transport || !["queued", "ended", "cancelled"].includes(transport)) throw new SenderError("Destination already has an unresolved call")
    }
    ctx.db.attemptProgress.attempt_id.update({ ...progress, transport: "dispatching", claim_token, claimed_at_ms: nowMs(ctx) })
  },
)

export const recordCoordinationDispatch = spacetimedb.reducer(
  { attempt_id: t.u64(), claim_token: t.string(), call_id: t.string(), error: t.string() },
  (ctx, { attempt_id, claim_token, call_id, error }) => {
    const { attempt, progress } = attemptFor(ctx, attempt_id)
    if (!claim_token || progress.claim_token !== claim_token) throw new SenderError("Dispatch claim token does not match")
    if (attempt.call_id && call_id && attempt.call_id !== call_id) throw new SenderError("Dispatch call id cannot change")
    const ended = progress.transport === "ended" || (call_id.startsWith("sim_") && progress.report_processed)
    const transport = ended ? "ended" : error || !call_id ? "unknown" : "active"
    ctx.db.attempt.id.update({ ...attempt, call_id: call_id || attempt.call_id })
    ctx.db.attemptProgress.attempt_id.update({ ...progress, transport, dispatch_error: error || (!call_id ? "Dispatch returned no call id" : progress.dispatch_error) })
    if (ended && progress.transport !== "ended") coordinationInput(ctx, attempt.support_case_id)
  },
)

export const markCoordinationEnded = spacetimedb.reducer(
  { attempt_id: t.u64(), end_reason: t.string() },
  (ctx, { attempt_id }) => {
    const { attempt, progress } = attemptFor(ctx, attempt_id)
    if (progress.transport === "ended" || progress.transport === "cancelled") return
    if (progress.transport === "queued") throw new SenderError("Attempt has not been dispatched")
    ctx.db.attemptProgress.attempt_id.update({ ...progress, transport: "ended" })
    coordinationInput(ctx, attempt.support_case_id)
  },
)

export const tickCoordination = spacetimedb.reducer(
  { support_case_id: t.u64() },
  (ctx, { support_case_id }) => {
    progressFor(ctx, support_case_id)
    let changed = false
    for (const progress of ctx.db.attemptProgress.support_case_id.filter(support_case_id)) {
      const review = !progress.review_consumed && progress.accepted_at_ms !== undefined && progress.accepted_at_ms + 10_000 <= nowMs(ctx)
      const abandoned = progress.transport === "dispatching" && progress.claimed_at_ms !== undefined && progress.claimed_at_ms + 60_000 <= nowMs(ctx)
      if (!review && !abandoned) continue
      ctx.db.attemptProgress.attempt_id.update({ ...progress, review_consumed: progress.review_consumed || review, transport: abandoned ? "unknown" : progress.transport })
      changed = true
    }
    if (changed) coordinationInput(ctx, support_case_id)
  },
)

export const recordCoordinationFailure = spacetimedb.reducer(
  { support_case_id: t.u64(), expected_revision: t.u64(), message: t.string() },
  (ctx, { support_case_id, expected_revision, message }) => {
    const progress = progressFor(ctx, support_case_id)
    if (progress.input_revision !== expected_revision || progress.evaluated_revision === expected_revision || progress.failure_count >= 3 || (progress.retry_at_ms !== undefined && progress.retry_at_ms > nowMs(ctx))) return
    const failure_count = progress.failure_count + 1
    ctx.db.caseProgress.support_case_id.update({ ...progress, failure_count, retry_at_ms: failure_count < 3 ? nowMs(ctx) + 2_000 * failure_count : undefined, blocked_reason: failure_count === 3 ? message || "Coordination failed" : "" })
    refreshCoordinationBrief(ctx, support_case_id)
  },
)

// The dispatcher stops a call that has not started, or a simulated one. A real
// call that may be ringing stays as it is: RideOut has no way to hang it up.
export const cancelAttempt = spacetimedb.reducer(
  { attempt_id: t.u64() },
  (ctx, { attempt_id }) => {
    const attempt = ctx.db.attempt.id.find(attempt_id)
    if (!attempt) throw new SenderError("Attempt not found")
    const simulated = attempt.call_id?.startsWith("sim_") === true
    const progress = ctx.db.attemptProgress.attempt_id.find(attempt_id)
    if (!progress) {
      if (attempt.outcome !== undefined) throw new SenderError("Call already has an outcome")
      if (attempt.call_id && !simulated) throw new SenderError("A live call cannot be ended from RideOut")
      ctx.db.attempt.id.update({ ...attempt, outcome: CANCELLED })
      return
    }
    if (progress.transport === "queued") {
      // Not an input: cancelling must not make the planner propose the same call again.
      ctx.db.attemptProgress.attempt_id.update({ ...progress, transport: "cancelled" })
      ctx.db.attempt.id.update({ ...attempt, outcome: CANCELLED })
      refreshCoordinationBrief(ctx, attempt.support_case_id)
      return
    }
    if (progress.transport === "active" && simulated) {
      ctx.db.attemptProgress.attempt_id.update({ ...progress, transport: "ended" })
      coordinationInput(ctx, attempt.support_case_id)
      return
    }
    if (progress.transport === "ended" || progress.transport === "cancelled") throw new SenderError("Call already finished")
    if (progress.transport === "dispatching") throw new SenderError("The call is being placed and cannot be cancelled safely")
    throw new SenderError("A live or unresolved call cannot be ended from RideOut")
  },
)
