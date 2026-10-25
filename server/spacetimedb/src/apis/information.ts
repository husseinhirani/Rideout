import { SenderError, t, type ReducerCtx } from "spacetimedb/server"
import spacetimedb from "../models"
import { nextCaseId, nextIncidentId } from "../ids"
import { canonicalJson, commandId, contactEligibility, contactScope, informationPolicy, matchesScope, normalizePhone, object, profilePreferences, revision, text, id, areaFilter, type ContactScope, type InformationPolicy, type ProfileSettingsRow } from "../../../shared/information"
type Ctx = ReducerCtx<typeof spacetimedb.schemaType>
const now = (ctx: Ctx) => Number(ctx.timestamp.microsSinceUnixEpoch) / 1000
const fail = (message: string): never => { throw new SenderError(message) }
const parse = (v: string) => object(JSON.parse(v), "payload")
const getCase = (ctx: Ctx, caseId: bigint) => ctx.db.informationCase.id.find(caseId) ?? fail("Information case not found")
function getAttempt(ctx: Ctx, attemptId: bigint) {
  const attempt = ctx.db.attempt.id.find(attemptId), progress = ctx.db.attemptProgress.attempt_id.find(attemptId), metadata = ctx.db.informationAttempt.attempt_id.find(attemptId)
  if (!attempt || !progress || !metadata?.decision_command_id) return fail("Information attempt not found")
  return { attempt, progress, metadata }
}
function preference(ctx: Ctx, profileId: bigint): ProfileSettingsRow | undefined {
  const p = ctx.db.profileSettings.profile_id.find(profileId)
  return p ? { ...p, profile_id: Number(profileId), tags: JSON.parse(p.tags_json), availability: p.availability as ProfileSettingsRow["availability"] } : undefined
}
function eligible(ctx: Ctx, caseId: bigint, profileId: bigint) {
  const c = getCase(ctx, caseId), all = [...ctx.db.profile.iter()].map(p => ({ ...p, id: Number(p.id), contact_profile_ids: p.contact_profile_ids.map(Number) }))
  const p = all.find(p => p.id === Number(profileId)), pref = preference(ctx, profileId)
  if (!p) return fail("Profile not found")
  if (!matchesScope(p, JSON.parse(c.scope_json) as ContactScope, all, pref)) fail("Profile is outside authorized scope")
  const reasons = contactEligibility(p, pref); if (reasons.length) fail(reasons.join("; "))
  return p
}
function dirty(ctx: Ctx, caseId: bigint) { const c = getCase(ctx, caseId); ctx.db.informationCase.id.update({ ...c, input_revision: c.input_revision + 1n }) }
function preferences(ctx: Ctx, value: unknown, excludeCase?: bigint) {
  const changes = profilePreferences(value)
  for (const p of changes) {
    const profile_id = BigInt(p.profile_id); if (!ctx.db.profile.id.find(profile_id)) fail("Profile not found")
    const old = ctx.db.profileSettings.profile_id.find(profile_id)
    const row = { profile_id, call_consent: p.call_consent ?? old?.call_consent ?? false, availability: p.availability ?? old?.availability ?? "unknown", tags_json: canonicalJson(p.tags ?? (old ? JSON.parse(old.tags_json) : [])), location_source: p.location_source ?? old?.location_source ?? "Directory coordinate; current whereabouts unverified", intake_allowed: p.intake_allowed ?? old?.intake_allowed ?? false }
    if (old) ctx.db.profileSettings.profile_id.update(row); else ctx.db.profileSettings.insert(row)
  }
  if (changes.length) for (const c of ctx.db.informationCase.iter()) if (c.id !== excludeCase && c.status !== "closed") dirty(ctx, c.id)
}
function replay(ctx: Ctx, command: string, operation: string, payload: unknown): boolean {
  commandId(command); const old = ctx.db.operatorCommand.command_id.find(command)
  if (!old) return false
  if (old.operation !== operation || old.payload_json !== canonicalJson(payload)) fail("Command ID conflicts with another input")
  return true
}
function save(ctx: Ctx, command_id: string, operation: string, payload: unknown, result: unknown, actor: string) { ctx.db.operatorCommand.insert({ command_id, operation, payload_json: canonicalJson(payload), result_json: canonicalJson(result), actor: text(actor, "operator", 200), created_at: ctx.timestamp }) }
function newMetadata(attempt_id: bigint, decision_command_id = "", authorized_revision = 0n) { return { attempt_id, decision_command_id, authorized_revision, report_provider_call_id: "", report_direction: "", binding_status: "unbound", terminal_observed_at_ms: undefined as number | undefined, provider_terminal_status: "", provider_end_reason: "", interpretation_failure_count: 0, interpretation_retry_at_ms: undefined as number | undefined, interpretation_error: "" } }
function budget(ctx: Ctx, caseId: bigint, profileId: bigint, excluding?: bigint) {
  const policy = JSON.parse(getCase(ctx, caseId).policy_json) as InformationPolicy, phone = normalizePhone(ctx.db.profile.id.find(profileId)?.phone ?? "")
  const history = [...ctx.db.attempt.support_case_id.filter(caseId)].filter(a => a.id !== excluding && !(ctx.db.attemptProgress.attempt_id.find(a.id)?.transport === "cancelled" && !ctx.db.attemptProgress.attempt_id.find(a.id)?.claim_token))
  const same = history.filter(a => normalizePhone(ctx.db.profile.id.find(a.profile_id)?.phone ?? "") === phone)
  if (history.length >= policy.max_calls_total || same.length >= policy.max_calls_per_destination) fail("Call budget exhausted")
  for (const other of ctx.db.attempt.iter()) {
    if (other.id === excluding || normalizePhone(ctx.db.profile.id.find(other.profile_id)?.phone ?? "") !== phone) continue
    if (ctx.db.attemptProgress.attempt_id.find(other.id)?.transport === "cancelled" || ctx.db.informationAttempt.attempt_id.find(other.id)?.provider_terminal_status) continue
    fail("Destination has pending or unresolved work")
  }
  const last = same.reduce((v,a) => Math.max(v, ctx.db.informationAttempt.attempt_id.find(a.id)?.terminal_observed_at_ms ?? 0), 0)
  if (last && last + policy.min_repeat_ms > now(ctx)) fail("Repeat call cooldown has not elapsed")
}
function authorized(ctx: Ctx, attemptId: bigint) {
  const row = getAttempt(ctx, attemptId), c = getCase(ctx, row.attempt.support_case_id), policy = JSON.parse(c.policy_json) as InformationPolicy
  if (c.status !== "open" || policy.paused || c.input_revision !== c.evaluated_revision || row.metadata.authorized_revision !== c.input_revision) fail("Attempt is not currently authorized")
  eligible(ctx, c.id, row.attempt.profile_id); budget(ctx, c.id, row.attempt.profile_id, attemptId)
  if ([...ctx.db.attemptProgress.support_case_id.filter(c.id)].some(p => p.report_received && !p.report_processed)) fail("Received reports must be processed first")
  return row
}
export const createInformationCase = spacetimedb.reducer({ command_id: t.string(), payload_json: t.string(), actor: t.string() }, (ctx, { command_id, payload_json, actor }) => {
  const input = parse(payload_json); if (replay(ctx, command_id, "create_information", input)) return
  const description = text(input.text, "text"), objective = text(input.objective, "objective"), scope = contactScope(input.scope ?? { profile_ids: [] }), policy = informationPolicy(input.policy ?? {})
  preferences(ctx, input.preferences)
  const incident_id = nextIncidentId(ctx), case_id = nextCaseId(ctx)
  ctx.db.informationIncident.insert({ id: incident_id, description, area: input.area === undefined ? undefined : areaFilter(input.area), status: "active", created_at: ctx.timestamp })
  ctx.db.informationCase.insert({ id: case_id, incident_id, objective, scope_json: canonicalJson(scope), policy_json: canonicalJson(policy), input_revision: 1n, evaluated_revision: 0n, status: "open", brief: "" })
  save(ctx, command_id, "create_information", input, { incident_id: Number(incident_id), support_case_id: Number(case_id), input_revision: 1, status: "open" }, actor)
})
export const configureInformationCase = spacetimedb.reducer({ case_id: t.u64(), command_id: t.string(), payload_json: t.string(), actor: t.string() }, (ctx, { case_id, command_id, payload_json, actor }) => {
  const input = parse(payload_json), payload = { case_id: Number(case_id), ...input }; if (replay(ctx, command_id, "configure_information", payload)) return
  const c = getCase(ctx, case_id); if (c.status === "closed" || c.input_revision !== BigInt(revision(input.expected_input_revision))) fail("Stale revision or closed case; refresh")
  preferences(ctx, input.preferences, case_id)
  const updated = { ...c, objective: input.objective === undefined ? c.objective : text(input.objective, "objective"), scope_json: input.scope === undefined ? c.scope_json : canonicalJson(contactScope(input.scope)), policy_json: input.policy === undefined ? c.policy_json : canonicalJson(informationPolicy(input.policy, JSON.parse(c.policy_json))), input_revision: c.input_revision + 1n }
  ctx.db.informationCase.id.update(updated)
  save(ctx, command_id, "configure_information", payload, { support_case_id: Number(case_id), input_revision: Number(updated.input_revision), status: updated.status }, actor)
})
export const requestInformationCall = spacetimedb.reducer({ case_id: t.u64(), command_id: t.string(), payload_json: t.string(), actor: t.string() }, (ctx, { case_id, command_id, payload_json, actor }) => {
  const input = parse(payload_json), payload = { case_id: Number(case_id), ...input }; if (replay(ctx, command_id, "information_call", payload)) return
  const c = getCase(ctx, case_id), policy = JSON.parse(c.policy_json) as InformationPolicy
  if (c.status !== "open" || policy.paused || c.input_revision !== BigInt(revision(input.expected_input_revision))) fail("Stale revision or unavailable case; refresh")
  const history = [...ctx.db.attemptProgress.support_case_id.filter(case_id)]
  if (history.some(p => p.report_received && !p.report_processed)) fail("Received reports must be processed first")
  const queued = history.filter(p => p.transport === "queued"), decisions = input.queued ?? []
  if (!Array.isArray(decisions) || decisions.length !== queued.length) return fail("Every queued attempt needs an explicit retain/cancel decision")
  const seen = new Set<number>()
  for (const raw of decisions) {
    const d = object(raw, "queued decision"), attemptId = id(d.attempt_id, "attempt_id")
    if (seen.has(attemptId) || !queued.some(p => p.attempt_id === BigInt(attemptId)) || !["retain", "cancel"].includes(String(d.disposition))) fail("Invalid queued decision")
    seen.add(attemptId); const p = ctx.db.attemptProgress.attempt_id.find(BigInt(attemptId))!, m = ctx.db.informationAttempt.attempt_id.find(BigInt(attemptId))!, a = ctx.db.attempt.id.find(p.attempt_id)!
    if (d.disposition === "cancel") { ctx.db.attemptProgress.attempt_id.update({ ...p, transport: "cancelled", dispatch_error: "Cancelled by operator decision" }); ctx.db.attempt.id.update({ ...a, outcome: "superseded" }) }
    else { eligible(ctx, case_id, a.profile_id); ctx.db.informationAttempt.attempt_id.update({ ...m, authorized_revision: c.input_revision }) }
  }
  const profile_id = BigInt(id(input.profile_id, "profile_id")); eligible(ctx, case_id, profile_id); budget(ctx, case_id, profile_id)
  const ask = text(input.question, "question", 4000), context = typeof input.context === "string" && input.context.length <= 10_000 ? input.context : fail("Invalid context")
  const a = ctx.db.attempt.insert({ id: 0n, support_case_id: case_id, profile_id, ask, call_id: undefined, outcome: undefined, answer: "", concern: "", created_at: ctx.timestamp })
  ctx.db.attemptProgress.insert({ attempt_id: a.id, support_case_id: case_id, context, transport: "queued", claim_token: "", dispatch_error: "", claimed_at_ms: undefined, report_received: false, report_processed: false, raw_concern: "", report_received_at_ms: undefined, accepted_at_ms: undefined, review_consumed: false })
  ctx.db.informationAttempt.insert(newMetadata(a.id, command_id, c.input_revision)); ctx.db.informationCase.id.update({ ...c, evaluated_revision: c.input_revision })
  save(ctx, command_id, "information_call", payload, { support_case_id: Number(case_id), input_revision: Number(c.input_revision), attempt_id: Number(a.id), status: "queued" }, actor)
})
export const claimInformationAttempt = spacetimedb.reducer({ attempt_id: t.u64(), claim_token: t.string() }, (ctx, { attempt_id, claim_token }) => {
  text(claim_token, "claim_token", 200); const { attempt, progress } = authorized(ctx, attempt_id), policy = JSON.parse(getCase(ctx, attempt.support_case_id).policy_json) as InformationPolicy
  if (progress.transport !== "queued") fail("Attempt is not queued")
  if ([...ctx.db.attemptProgress.iter()].filter(p => ["dispatching", "active", "unknown"].includes(p.transport)).length >= policy.max_concurrent_calls) fail("Concurrent call limit reached")
  ctx.db.attemptProgress.attempt_id.update({ ...progress, transport: "dispatching", claim_token, claimed_at_ms: now(ctx) })
})
export const validateInformationClaim = spacetimedb.reducer({ attempt_id: t.u64(), claim_token: t.string() }, (ctx, { attempt_id, claim_token }) => { const { progress } = authorized(ctx, attempt_id); if (progress.transport !== "dispatching" || !claim_token || progress.claim_token !== claim_token) fail("Claim token mismatch") })
export const releaseInformationClaim = spacetimedb.reducer({ attempt_id: t.u64(), claim_token: t.string(), reason: t.string() }, (ctx, { attempt_id, claim_token, reason }) => {
  const { attempt, progress } = getAttempt(ctx, attempt_id)
  if (progress.transport !== "dispatching" || !claim_token || progress.claim_token !== claim_token || attempt.call_id || progress.report_received) fail("Cannot release this claim")
  ctx.db.attemptProgress.attempt_id.update({ ...progress, transport: getCase(ctx, attempt.support_case_id).status === "closed" ? "cancelled" : "queued", claim_token: "", claimed_at_ms: undefined, dispatch_error: reason.slice(0, 2000) })
})
export const recordInformationDispatch = spacetimedb.reducer({ attempt_id: t.u64(), claim_token: t.string(), call_id: t.string(), error: t.string() }, (ctx, { attempt_id, claim_token, call_id, error }) => {
  const { attempt, progress, metadata } = getAttempt(ctx, attempt_id)
  if (!claim_token || progress.claim_token !== claim_token || !["dispatching", "unknown", "active", "ended"].includes(progress.transport)) fail("Dispatch claim token mismatch")
  if (attempt.call_id && call_id && attempt.call_id !== call_id) fail("Provider call ID cannot change")
  const providerId = call_id || attempt.call_id, binding = metadata.report_provider_call_id && providerId ? metadata.report_provider_call_id === providerId ? "matched" : "conflict" : metadata.binding_status
  ctx.db.attempt.id.update({ ...attempt, call_id: providerId }); ctx.db.attemptProgress.attempt_id.update({ ...progress, transport: metadata.provider_terminal_status ? "ended" : !providerId || error ? "unknown" : "active", dispatch_error: error.slice(0, 2000) }); ctx.db.informationAttempt.attempt_id.update({ ...metadata, binding_status: binding })
})
export const receiveInformationReport = spacetimedb.reducer({ attempt_id: t.u64(), provider_call_id: t.string(), direction: t.string(), answer: t.string(), concern: t.string() }, (ctx, { attempt_id, provider_call_id, direction, answer, concern }) => {
  const { attempt, progress, metadata } = getAttempt(ctx, attempt_id); text(provider_call_id, "provider_call_id", 300); text(answer, "answer", 30_000)
  if (direction !== "outbound") fail("Report direction must be outbound"); if (concern.length > 10_000) fail("Concern is too long")
  if (attempt.call_id && attempt.call_id !== provider_call_id) fail("Report provider call ID mismatch")
  if (progress.report_received) { if (attempt.answer === answer && progress.raw_concern === concern && metadata.report_provider_call_id === provider_call_id && metadata.report_direction === direction) return; fail("Different final report already exists") }
  if (["queued", "cancelled"].includes(progress.transport)) fail("Attempt has not been dispatched")
  ctx.db.attempt.id.update({ ...attempt, answer, concern }); ctx.db.attemptProgress.attempt_id.update({ ...progress, report_received: true, report_received_at_ms: now(ctx), raw_concern: concern }); ctx.db.informationAttempt.attempt_id.update({ ...metadata, report_provider_call_id: provider_call_id, report_direction: direction, binding_status: attempt.call_id ? "matched" : "pending" }); dirty(ctx, attempt.support_case_id)
})
export const observeInformationTerminal = spacetimedb.reducer({ attempt_id: t.u64(), call_id: t.string(), status: t.string(), end_reason: t.string() }, (ctx, { attempt_id, call_id, status, end_reason }) => {
  const attempt = ctx.db.attempt.id.find(attempt_id)
  if (!attempt || !call_id || attempt.call_id !== call_id || !["completed", "failed"].includes(status)) return fail("Invalid terminal provider observation")
  const old = ctx.db.informationAttempt.attempt_id.find(attempt_id); if (old?.provider_terminal_status) return
  const row = { ...(old ?? newMetadata(attempt_id)), terminal_observed_at_ms: now(ctx), provider_terminal_status: status, provider_end_reason: end_reason.slice(0, 2000) }
  if (old) ctx.db.informationAttempt.attempt_id.update(row); else ctx.db.informationAttempt.insert(row)
  const p = ctx.db.attemptProgress.attempt_id.find(attempt_id); if (p) ctx.db.attemptProgress.attempt_id.update({ ...p, transport: "ended" })
  if (ctx.db.informationCase.id.find(attempt.support_case_id)) dirty(ctx, attempt.support_case_id)
})
export const finishInformationReport = spacetimedb.reducer({ attempt_id: t.u64(), reached: t.bool(), notes_json: t.string(), concern: t.string(), do_not_call: t.bool() }, (ctx, { attempt_id, reached, notes_json, concern, do_not_call }) => {
  const { attempt, progress, metadata } = getAttempt(ctx, attempt_id); if (progress.report_processed) return
  if (!progress.report_received || metadata.binding_status !== "matched") fail("Matched raw report required")
  const notes: unknown = JSON.parse(notes_json); if (!Array.isArray(notes) || notes.length > 30 || notes.some(n => typeof n !== "string" || !n.trim() || n.length > 5000)) return fail("Invalid interpreted notes")
  if (concern.length > 10_000) fail("Concern is too long")
  const name = ctx.db.profile.id.find(attempt.profile_id)!.name
  const insert = (value: string, source: string) => ctx.db.note.insert({ id: 0n, support_case_id: attempt.support_case_id, attempt_id, source, text: `${name}: ${value}`, lat: undefined, lng: undefined, radius_m: undefined, at: ctx.timestamp })
  for (const note of notes) insert(note, "call_unverified")
  const combined = [...new Set([progress.raw_concern, concern].filter(s => s.trim()))].join("; "); if (combined) insert(combined, "concern")
  ctx.db.attempt.id.update({ ...attempt, outcome: reached ? "answered" : "not_reached", concern: combined }); ctx.db.attemptProgress.attempt_id.update({ ...progress, report_processed: true }); ctx.db.informationAttempt.attempt_id.update({ ...metadata, interpretation_error: "", interpretation_retry_at_ms: undefined })
  if (do_not_call) preferences(ctx, [{ profile_id: Number(attempt.profile_id), call_consent: false }], attempt.support_case_id)
  dirty(ctx, attempt.support_case_id)
})
export const failInformationReport = spacetimedb.reducer({ attempt_id: t.u64(), message: t.string() }, (ctx, { attempt_id, message }) => {
  const { progress, metadata } = getAttempt(ctx, attempt_id)
  if (progress.report_processed || metadata.interpretation_failure_count >= 3 || (metadata.interpretation_retry_at_ms ?? 0) > now(ctx)) return
  const count = metadata.interpretation_failure_count + 1
  ctx.db.informationAttempt.attempt_id.update({ ...metadata, interpretation_failure_count: count, interpretation_retry_at_ms: count < 3 ? now(ctx) + count * 2000 : undefined, interpretation_error: message.slice(0, 2000) })
})
export const recoverInformationClaims = spacetimedb.reducer({}, ctx => { for (const m of ctx.db.informationAttempt.iter()) { if (!m.decision_command_id) continue; const p = ctx.db.attemptProgress.attempt_id.find(m.attempt_id); if (p?.transport === "dispatching" && p.claimed_at_ms !== undefined && p.claimed_at_ms + 60_000 <= now(ctx)) ctx.db.attemptProgress.attempt_id.update({ ...p, transport: "unknown", dispatch_error: "Dispatch claim expired; reconcile provider outcome before another call" }) } })
