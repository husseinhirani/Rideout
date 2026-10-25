import { SenderError, t, type ReducerCtx } from "spacetimedb/server"
import spacetimedb from "../models"
import { nextCaseId, nextIncidentId } from "../ids"
import { canonicalJson, commandId, contactEligibility, contactScope, informationPolicy, matchesScope, normalizePhone, object, profilePreferences, revision, text, id, areaFilter, type ContactScope, type InformationPolicy, type ProfileSettingsRow } from "../../../shared/information"
import { disclosureFacts, parseInformationPlan, type DisclosureFact } from "../../../shared/information-plan"
import { incomingCandidateIds, parseInformationIncomingAssessment, type InformationIncomingProposal, type InformationIncomingResolution } from "../../../shared/information-incoming"
import { EVACUATION_DRILL, SIMULATED_NEIGHBORS, DRILL_STARTING_LOCATIONS } from '../../../mock/evacuation'
import { addTask, emptyFacts, taskInstruction, type AssistanceState } from '../../../shared/assistance'
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
function cancelQueued(ctx: Ctx, attemptId: bigint, reason: string) {
  const { attempt, progress } = getAttempt(ctx, attemptId)
  if (progress.transport !== "queued" || progress.claim_token || attempt.call_id || progress.report_received) fail("Only definitely unsent queued work can be cancelled")
  ctx.db.attemptProgress.attempt_id.update({ ...progress, transport: "cancelled", dispatch_error: reason })
  ctx.db.attempt.id.update({ ...attempt, outcome: "superseded" })
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
  const session = ctx.db.assistanceSession.case_id.find(caseId)
  const simulated = session && (JSON.parse(session.state_json) as AssistanceState).people.some(person => person.profile_id === Number(profileId) && person.mode === 'simulated')
  const reasons = contactEligibility(p, pref).filter(reason => !(simulated && reason === 'No dialable phone number')); if (reasons.length) fail(reasons.join("; "))
  return p
}
function resetPlanningFailure(ctx: Ctx, caseId: bigint, inputRevision: bigint) {
  const p = ctx.db.informationPlanning.support_case_id.find(caseId)
  if (p) ctx.db.informationPlanning.support_case_id.update({ ...p, failure_revision: inputRevision, failure_count: 0, retry_at_ms: undefined, error: "" })
}
function dirty(ctx: Ctx, caseId: bigint) {
  const c = getCase(ctx, caseId), input_revision = c.input_revision + 1n
  ctx.db.informationCase.id.update({ ...c, input_revision }); resetPlanningFailure(ctx, caseId, input_revision)
}
function configurePlanning(ctx: Ctx, caseId: bigint, input: Record<string, unknown>, inputRevision: bigint) {
  const old = ctx.db.informationPlanning.support_case_id.find(caseId)
  if (input.coordination_enabled !== undefined && typeof input.coordination_enabled !== "boolean") fail("coordination_enabled must be boolean")
  const facts = disclosureFacts(input.disclosure_facts ?? (old ? JSON.parse(old.disclosure_json) : []))
  for (const fact of facts) for (const profileId of fact.profile_ids ?? []) if (!ctx.db.profile.id.find(BigInt(profileId))) fail("Disclosure recipient not found")
  const row = { support_case_id: caseId, enabled: input.coordination_enabled === undefined ? old?.enabled ?? false : input.coordination_enabled as boolean, disclosure_json: canonicalJson(facts), failure_revision: inputRevision, failure_count: 0, retry_at_ms: undefined, error: "" }
  if (old) ctx.db.informationPlanning.support_case_id.update(row); else ctx.db.informationPlanning.insert(row)
  if (!row.enabled) for (const progress of ctx.db.attemptProgress.support_case_id.filter(caseId)) {
    const metadata = ctx.db.informationAttempt.attempt_id.find(progress.attempt_id)
    if (progress.transport === "queued" && !progress.claim_token && metadata?.decision_command_id.startsWith("plan:")) {
      ctx.db.attemptProgress.attempt_id.update({ ...progress, transport: "cancelled", dispatch_error: "Automatic coordination disabled by organizer" })
      const attempt = ctx.db.attempt.id.find(progress.attempt_id)!
      ctx.db.attempt.id.update({ ...attempt, outcome: "superseded" })
    }
  }
}
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
const incomingSavedReply = "I've saved your report for the coordinator."
function incomingProfile(ctx: Ctx, phone: string) {
  const matches = [...ctx.db.profile.iter()].filter(p => normalizePhone(p.phone) === normalizePhone(phone))
  return matches.length === 1 ? matches[0] : undefined
}
function incomingCandidates(ctx: Ctx, profileId: bigint | undefined) {
  if (profileId === undefined) return []
  const cases = [...ctx.db.informationCase.iter()]
  const candidates = incomingCandidateIds(Number(profileId), cases.map(c => ({ id: Number(c.id), status: c.status, scope: JSON.parse(c.scope_json) as ContactScope })),
    [...ctx.db.attempt.iter()].map(a => ({ profile_id: Number(a.profile_id), support_case_id: Number(a.support_case_id), dispatched: !!a.call_id || !!ctx.db.attemptProgress.attempt_id.find(a.id)?.claim_token })),
    [...ctx.db.informationIncomingResolution.iter()].map(r => ({ kind: r.kind as InformationIncomingResolution["kind"], reporter_profile_id: r.reporter_profile_id === undefined ? null : Number(r.reporter_profile_id), support_case_id: r.support_case_id === undefined ? null : Number(r.support_case_id) })))
  return candidates.map(case_id => ({ case_id, input_revision: Number(getCase(ctx, BigInt(case_id)).input_revision) }))
}
function incomingNote(ctx: Ctx, caseId: bigint, request: { id: bigint; text: string }, source: string, profile: { name: string } | undefined) {
  const attribution = profile ? `${profile.name} (phone association only; identity unverified)` : "Unverified caller"
  return ctx.db.note.insert({ id: 0n, support_case_id: caseId, attempt_id: 0n, source, text: `${attribution}, incoming request ${request.id}: ${request.text}`, lat: undefined, lng: undefined, radius_m: undefined, at: ctx.timestamp })
}
export const configureInformationIntake = spacetimedb.reducer({ command_id: t.string(), payload_json: t.string(), actor: t.string() }, (ctx, { command_id, payload_json, actor }) => {
  const input = parse(payload_json)
  if (replay(ctx, command_id, "configure_information_intake", input)) return
  const old = ctx.db.informationIntakeConfiguration.id.find(1), line = ctx.db.informationLine.id.find(1)
  if (BigInt(revision(input.expected_revision)) !== (old?.revision ?? 0n)) fail("Stale intake configuration revision; refresh")
  for (const key of ["enabled", "coordination_enabled"]) if (input[key] !== undefined && typeof input[key] !== "boolean") fail(key + " must be boolean")
  const scope = contactScope(input.default_scope ?? (line ? JSON.parse(line.default_scope_json) : { profile_ids: [] }))
  const policy = informationPolicy(input.policy ?? {}, old ? JSON.parse(old.policy_json) : undefined)
  const facts = disclosureFacts(input.disclosure_facts ?? (old ? JSON.parse(old.disclosure_json) : []))
  for (const profileId of [...(scope.profile_ids ?? []), ...(scope.related_to_profile_id ? [scope.related_to_profile_id] : []), ...facts.flatMap(f => f.profile_ids ?? [])]) if (!ctx.db.profile.id.find(BigInt(profileId))) fail("Configured profile not found")
  preferences(ctx, input.preferences)
  const row = { id: 1, revision: (old?.revision ?? 0n) + 1n, enabled: input.enabled === undefined ? old?.enabled ?? false : input.enabled as boolean, policy_json: canonicalJson(policy), coordination_enabled: input.coordination_enabled === undefined ? old?.coordination_enabled ?? false : input.coordination_enabled as boolean, disclosure_json: canonicalJson(facts) }
  if (old) ctx.db.informationIntakeConfiguration.id.update(row); else ctx.db.informationIntakeConfiguration.insert(row)
  const scopeRow = { id: 1, default_scope_json: canonicalJson(scope) }
  if (line) ctx.db.informationLine.id.update(scopeRow); else ctx.db.informationLine.insert(scopeRow)
  save(ctx, command_id, "configure_information_intake", input, { revision: Number(row.revision), status: "configured" }, actor)
})
export const reviewInformationIncoming = spacetimedb.reducer({ request_id: t.u64(), command_id: t.string(), payload_json: t.string(), actor: t.string() }, (ctx, { request_id, command_id, payload_json, actor }) => {
  const input = parse(payload_json), payload = { ...input, request_id: Number(request_id) }
  if (replay(ctx, command_id, "review_information_incoming", payload)) return
  const request = ctx.db.incomingRequest.id.find(request_id)
  if (!request || request.revision !== BigInt(revision(input.expected_revision)) || request.status !== "needs_review" || ctx.db.informationIncomingResolution.request_id.find(request_id)) return fail("Stale incoming request revision or already reviewed; refresh")
  if (input.decision !== "attach" && input.decision !== "reject") fail("Review decision must be attach or reject")
  if (input.decision === "reject" && input.support_case_id !== undefined) fail("Rejected reports cannot select a case")
  const reason = text(input.reason, "reason", 2000), operator = text(actor, "operator", 200), profile = incomingProfile(ctx, request.from_phone)
  let caseId: bigint | undefined, noteId: bigint | undefined, inputRevision: number | undefined
  if (input.decision === "attach") {
    caseId = BigInt(id(input.support_case_id, "support_case_id"))
    const c = getCase(ctx, caseId); if (c.status !== "open") fail("Cannot attach a report to a closed case")
    noteId = incomingNote(ctx, caseId, request, "external_unverified", profile).id
    dirty(ctx, caseId); inputRevision = Number(c.input_revision + 1n)
  }
  const status = input.decision === "attach" ? "attached" : "rejected"
  ctx.db.informationIncomingResolution.insert({ request_id, request_revision: request.revision, support_case_id: caseId, note_id: noteId, reporter_profile_id: profile?.id, kind: input.decision === "attach" ? "operator_attach" : "operator_reject", reason, actor: operator, created_at: ctx.timestamp })
  ctx.db.incomingRequest.id.update({ ...request, status, support_case_id: caseId, reply: incomingSavedReply, retry_at_ms: 0n })
  save(ctx, command_id, "review_information_incoming", payload, { request_id: Number(request_id), status, support_case_id: caseId === undefined ? undefined : Number(caseId), note_id: noteId === undefined ? undefined : Number(noteId), input_revision: inputRevision }, operator)
})
export const prepareInformationIncoming = spacetimedb.reducer({ request_id: t.u64(), expected_revision: t.u64(), proposal_json: t.string() }, (ctx, { request_id, expected_revision, proposal_json }) => {
  const request = ctx.db.incomingRequest.id.find(request_id)
  if (!request || request.revision !== expected_revision || request.status !== "pending" || ctx.db.informationIncomingResolution.request_id.find(request_id)) return fail("Incoming request revision changed or decision already saved")
  if (proposal_json.length > 40_000) fail("Incoming proposal is too long")
  const input = parse(proposal_json), assessment = parseInformationIncomingAssessment(input.assessment)
  const profileId = input.profile_id === null ? null : id(input.profile_id, "profile_id"), profile = incomingProfile(ctx, request.from_phone)
  if (profileId !== (profile ? Number(profile.id) : null)) fail("Stale incoming context: caller association changed; refresh")
  const config = ctx.db.informationIntakeConfiguration.id.find(1)
  if (BigInt(revision(input.line_revision)) !== (config?.revision ?? 0n)) fail("Stale incoming context: intake configuration changed; refresh")
  if (!Array.isArray(input.candidate_revisions)) return fail("Invalid incoming candidate revisions")
  const candidateRevisions = input.candidate_revisions.map(value => { const c = object(value, "candidate"); return { case_id: id(c.case_id, "case_id"), input_revision: revision(c.input_revision) } })
  const candidates = incomingCandidates(ctx, profile?.id)
  if (canonicalJson(candidateRevisions) !== canonicalJson(candidates)) fail("Stale incoming context: candidate cases changed; refresh")
  if (!profile && assessment.kind !== "review") fail("Unknown or ambiguous callers require organizer review")
  const mayIntake = !!config?.enabled && !!profile && !!ctx.db.profileSettings.profile_id.find(profile.id)?.intake_allowed
  if ((assessment.kind === "intake" || assessment.kind === "clarification") && !mayIntake) fail("Caller is not permitted to create an investigation")
  const proposal: InformationIncomingProposal = { profile_id: profileId, line_revision: Number(config?.revision ?? 0n), candidate_revisions: candidateRevisions, assessment }
  let caseId: bigint | undefined, noteId: bigint | undefined
  if (assessment.kind === "update") {
    if (!candidates.some(c => c.case_id === assessment.case_id)) fail("Incoming update is outside the caller's associated cases")
    caseId = BigInt(assessment.case_id!)
    noteId = incomingNote(ctx, caseId, request, "incoming_unverified", profile).id
    dirty(ctx, caseId)
  } else if (assessment.kind === "intake") {
    const line = ctx.db.informationLine.id.find(1)
    if (!line || !config) return fail("Intake configuration is missing")
    const incidentId = nextIncidentId(ctx); caseId = nextCaseId(ctx)
    ctx.db.informationIncident.insert({ id: incidentId, description: assessment.description, area: undefined, status: "active", created_at: ctx.timestamp })
    ctx.db.informationCase.insert({ id: caseId, incident_id: incidentId, objective: assessment.objective, scope_json: canonicalJson(contactScope(JSON.parse(line.default_scope_json))), policy_json: canonicalJson(informationPolicy(JSON.parse(config.policy_json))), input_revision: 1n, evaluated_revision: 0n, status: "open", brief: "" })
    configurePlanning(ctx, caseId, { coordination_enabled: config.coordination_enabled, disclosure_facts: JSON.parse(config.disclosure_json) }, 1n)
    noteId = incomingNote(ctx, caseId, request, "incoming_unverified", profile).id
  }
  if (caseId !== undefined) ctx.db.informationIncomingResolution.insert({ request_id, request_revision: request.revision, support_case_id: caseId, note_id: noteId, reporter_profile_id: profile?.id, kind: assessment.kind === "intake" ? "intake" : "automatic_update", reason: assessment.reason, actor: "incoming coordinator", created_at: ctx.timestamp })
  ctx.db.incomingRequest.id.update({ ...request, status: caseId !== undefined ? "recorded" : assessment.kind === "clarification" ? "needs_clarification" : "needs_review", decision_json: canonicalJson(proposal), support_case_id: caseId, reply: assessment.kind === "clarification" ? assessment.clarification! : incomingSavedReply, retry_at_ms: 0n })
})
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
function renderedContext(ctx: Ctx, caseId: bigint, profileId: bigint, references: string[]): string {
  const planning = ctx.db.informationPlanning.support_case_id.find(caseId)
  const facts: DisclosureFact[] = planning ? JSON.parse(planning.disclosure_json) : []
  if (new Set(references).size !== references.length) fail("Duplicate disclosure reference")
  const context = references.map(reference => {
    const fact = facts.find(f => f.id === reference)
    if (!fact || (fact.profile_ids !== null && !fact.profile_ids.includes(Number(profileId)))) return fail("Disclosure fact is not permitted for this recipient")
    return fact.text
  }).join("\n")
  if (context.length > 10_000) fail("Selected disclosure context is too long")
  return context
}
function validateCommittedIntent(ctx: Ctx, row: ReturnType<typeof getAttempt>) {
  if (!row.metadata.decision_command_id.startsWith("plan:")) return
  const caseId = row.attempt.support_case_id
  if (!ctx.db.informationPlanning.support_case_id.find(caseId)?.enabled) fail("Automatic coordination is not enabled")
  const decision = ctx.db.informationDecision.id.find(row.metadata.decision_command_id.slice(5))
  const index = decision?.attempt_ids.findIndex(value => value === row.attempt.id) ?? -1
  if (!decision || decision.support_case_id !== caseId || index < 0) return fail("Committed call intent is missing")
  const call = parseInformationPlan(JSON.parse(decision.plan_json)).calls[index]
  if (!call || call.profile_id !== Number(row.attempt.profile_id) || call.question !== row.attempt.ask
    || renderedContext(ctx, caseId, row.attempt.profile_id, call.disclose_fact_ids) !== row.progress.context) fail("Committed call intent no longer matches current permissions")
}
function authorized(ctx: Ctx, attemptId: bigint) {
  const row = getAttempt(ctx, attemptId), c = getCase(ctx, row.attempt.support_case_id), policy = JSON.parse(c.policy_json) as InformationPolicy
  if (c.status !== "open" || policy.paused || c.input_revision !== c.evaluated_revision || row.metadata.authorized_revision !== c.input_revision) fail("Attempt is not currently authorized")
  const session=ctx.db.assistanceSession.case_id.find(c.id)
  if(session){
    const state=JSON.parse(session.state_json) as AssistanceState
    const task=state.tasks.find(t=>t.attempt_id===Number(attemptId)&&['pending','delivered'].includes(t.status))
    if(state.paused||!task||!state.people.find(p=>p.profile_id===Number(row.attempt.profile_id))?.consent)fail('Coordinator task is no longer authorized')
    taskInstruction(state,task!)
    if(task!.arrangement_id){
      const arrangement=state.arrangements.find(a=>a.id===task!.arrangement_id)!
      eligible(ctx,c.id,BigInt(arrangement.recipient_id)); eligible(ctx,c.id,BigInt(arrangement.helper_id))
    }
  }
  validateCommittedIntent(ctx, row)
  eligible(ctx, c.id, row.attempt.profile_id); budget(ctx, c.id, row.attempt.profile_id, attemptId)
  if ([...ctx.db.attemptProgress.support_case_id.filter(c.id)].some(p => p.report_received && !p.report_processed)) fail("Received reports must be processed first")
  return row
}
type CommandArgs = { command_id: string; payload_json: string; actor: string }
function createCase(ctx: Ctx, { command_id, payload_json, actor }: CommandArgs) {
  const input = parse(payload_json); if (replay(ctx, command_id, "create_information", input)) return
  const description = text(input.text, "text"), objective = text(input.objective, "objective"), scope = contactScope(input.scope ?? { profile_ids: [] }), policy = informationPolicy(input.policy ?? {})
  preferences(ctx, input.preferences)
  const incident_id = nextIncidentId(ctx), case_id = nextCaseId(ctx)
  ctx.db.informationIncident.insert({ id: incident_id, description, area: input.area === undefined ? undefined : areaFilter(input.area), status: "active", created_at: ctx.timestamp })
  ctx.db.informationCase.insert({ id: case_id, incident_id, objective, scope_json: canonicalJson(scope), policy_json: canonicalJson(policy), input_revision: 1n, evaluated_revision: 0n, status: "open", brief: "" })
  configurePlanning(ctx, case_id, input, 1n)
  save(ctx, command_id, "create_information", input, { incident_id: Number(incident_id), support_case_id: Number(case_id), input_revision: 1, status: "open" }, actor)
}
export const createInformationCase = spacetimedb.reducer({ command_id: t.string(), payload_json: t.string(), actor: t.string() }, createCase)
export const configureInformationCase = spacetimedb.reducer({ case_id: t.u64(), command_id: t.string(), payload_json: t.string(), actor: t.string() }, (ctx, { case_id, command_id, payload_json, actor }) => {
  const input = parse(payload_json), payload = { ...input, case_id: Number(case_id) }; if (replay(ctx, command_id, "configure_information", payload)) return
  const c = getCase(ctx, case_id); if (c.status === "closed" || c.input_revision !== BigInt(revision(input.expected_input_revision))) fail("Stale revision or closed case; refresh")
  if(ctx.db.assistanceSession.case_id.find(case_id) && input.coordination_enabled===true)fail('This case uses the assistance coordinator; the information planner cannot run alongside it')
  preferences(ctx, input.preferences, case_id)
  const updated = { ...c, objective: input.objective === undefined ? c.objective : text(input.objective, "objective"), scope_json: input.scope === undefined ? c.scope_json : canonicalJson(contactScope(input.scope)), policy_json: input.policy === undefined ? c.policy_json : canonicalJson(informationPolicy(input.policy, JSON.parse(c.policy_json))), input_revision: c.input_revision + 1n }
  ctx.db.informationCase.id.update(updated)
  configurePlanning(ctx, case_id, input, updated.input_revision)
  save(ctx, command_id, "configure_information", payload, { support_case_id: Number(case_id), input_revision: Number(updated.input_revision), status: updated.status }, actor)
})
export const closeInformationCase = spacetimedb.reducer({ case_id: t.u64(), command_id: t.string(), payload_json: t.string(), actor: t.string() }, (ctx, { case_id, command_id, payload_json, actor }) => {
  const input = parse(payload_json), payload = { ...input, case_id: Number(case_id) }
  if (replay(ctx, command_id, "close_information", payload)) return
  const c = getCase(ctx, case_id)
  if (c.status !== "open" || c.input_revision !== BigInt(revision(input.expected_input_revision))) fail("Stale revision or closed case; refresh")
  const reason = text(input.reason, "reason", 2000), operator = text(actor, "operator", 200)
  for (const progress of ctx.db.attemptProgress.support_case_id.filter(case_id)) {
    const attempt = ctx.db.attempt.id.find(progress.attempt_id)
    if (attempt && progress.transport === "queued" && !progress.claim_token && !attempt.call_id && !progress.report_received) cancelQueued(ctx, attempt.id, "Case closed: " + reason)
  }
  const note = ctx.db.note.insert({ id: 0n, support_case_id: case_id, attempt_id: 0n, source: "organizer", text: `${operator} closed the case: ${reason}`, lat: undefined, lng: undefined, radius_m: undefined, at: ctx.timestamp })
  const input_revision = c.input_revision + 1n
  ctx.db.informationCase.id.update({ ...c, status: "closed", input_revision })
  save(ctx, command_id, "close_information", payload, { support_case_id: Number(case_id), input_revision: Number(input_revision), note_id: Number(note.id), status: "closed" }, operator)
})
export const cancelInformationAttempt = spacetimedb.reducer({ attempt_id: t.u64(), command_id: t.string(), payload_json: t.string(), actor: t.string() }, (ctx, { attempt_id, command_id, payload_json, actor }) => {
  const input = parse(payload_json), payload = { ...input, attempt_id: Number(attempt_id) }
  if (replay(ctx, command_id, "cancel_information_attempt", payload)) return
  const { attempt } = getAttempt(ctx, attempt_id), c = getCase(ctx, attempt.support_case_id)
  if (c.status !== "open" || c.input_revision !== BigInt(revision(input.expected_input_revision))) fail("Stale revision or closed case; refresh")
  const reason = text(input.reason, "reason", 2000), operator = text(actor, "operator", 200)
  cancelQueued(ctx, attempt_id, reason)
  const note = ctx.db.note.insert({ id: 0n, support_case_id: c.id, attempt_id: 0n, source: "organizer", text: `${operator} cancelled queued attempt ${attempt_id}: ${reason}`, lat: undefined, lng: undefined, radius_m: undefined, at: ctx.timestamp })
  dirty(ctx, c.id)
  save(ctx, command_id, "cancel_information_attempt", payload, { support_case_id: Number(c.id), attempt_id: Number(attempt_id), input_revision: Number(c.input_revision + 1n), note_id: Number(note.id), status: "cancelled" }, operator)
})
function requestCall(ctx: Ctx, { case_id, command_id, payload_json, actor }: CommandArgs & { case_id: bigint }) {
  const input = parse(payload_json), payload = { ...input, case_id: Number(case_id) }; if (replay(ctx, command_id, "information_call", payload)) return
  if (ctx.db.informationPlanning.support_case_id.find(case_id)?.enabled) fail("Disable automatic coordination before choosing a manual call")
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
    if (d.disposition === "cancel") cancelQueued(ctx, p.attempt_id, "Cancelled by operator decision")
    else { eligible(ctx, case_id, a.profile_id); ctx.db.informationAttempt.attempt_id.update({ ...m, authorized_revision: c.input_revision }) }
  }
  const profile_id = BigInt(id(input.profile_id, "profile_id")); eligible(ctx, case_id, profile_id); budget(ctx, case_id, profile_id)
  const ask = text(input.question, "question", 4000), context = typeof input.context === "string" && input.context.length <= 10_000 ? input.context : fail("Invalid context")
  const a = ctx.db.attempt.insert({ id: 0n, support_case_id: case_id, profile_id, ask, call_id: undefined, outcome: undefined, answer: "", concern: "", created_at: ctx.timestamp })
  ctx.db.attemptProgress.insert({ attempt_id: a.id, support_case_id: case_id, context, transport: "queued", claim_token: "", dispatch_error: "", claimed_at_ms: undefined, report_received: false, report_processed: false, raw_concern: "", report_received_at_ms: undefined, accepted_at_ms: undefined, review_consumed: false })
  ctx.db.informationAttempt.insert(newMetadata(a.id, command_id, c.input_revision)); ctx.db.informationCase.id.update({ ...c, evaluated_revision: c.input_revision })
  save(ctx, command_id, "information_call", payload, { support_case_id: Number(case_id), input_revision: Number(c.input_revision), attempt_id: Number(a.id), status: "queued" }, actor)
}
export const requestInformationCall = spacetimedb.reducer({ case_id: t.u64(), command_id: t.string(), payload_json: t.string(), actor: t.string() }, requestCall)

/** Private roster configuration and call dispatch are separate operator commands. */
function drillProfiles(ctx: Ctx, input: Record<string, unknown>) {
  const recipients = input.participants ?? [{ name: input.name, phone: input.phone }]
  if (!Array.isArray(recipients) || recipients.length < 1 || recipients.length > 10) return fail("Choose between 1 and 10 drill participants")
  const destinations = new Set<string>()
  return recipients.map(raw => {
    const recipient = object(raw, "participant"), name = text(recipient.name, "name", 200), phone = normalizePhone(text(recipient.phone, "phone", 30))
    if (!/^\+[1-9]\d{7,14}$/.test(phone) || phone.startsWith("+1555555")) return fail("A real test phone is required")
    if (destinations.has(phone)) return fail("Each drill participant must have a different phone")
    destinations.add(phone)
    if(recipient.location_id!==undefined && !EVACUATION_DRILL.locations.some(l=>l.id===recipient.location_id))return fail('Choose a supplied drill location')
    const matches = [...ctx.db.profile.iter()].filter(p => normalizePhone(p.phone) === phone)
    if (matches.length > 1) return fail("Multiple profiles use a participant phone; resolve them before starting")
    let profile = matches[0]
    if (profile && preference(ctx, profile.id)?.call_consent === false) return fail("Calls to this participant are disabled; record renewed consent before starting")
    if (!profile) profile = ctx.db.profile.insert({ id: 0n, name, phone, lat: 37.8462, lng: -122.2499, contact_profile_ids: [] })
    else if (profile.name !== name) { profile = { ...profile, name }; ctx.db.profile.id.update(profile) }
    return profile
  })
}

export const configureDrillParticipants = spacetimedb.reducer({ command_id: t.string(), payload_json: t.string(), actor: t.string() }, (ctx, args) => {
  const input = parse(args.payload_json)
  if (replay(ctx, args.command_id, "configure_drill_participants", input)) return
  const people = drillProfiles(ctx, input)
  for (const person of people) if (!preference(ctx, person.id)) {
    ctx.db.profileSettings.insert({ profile_id: person.id, call_consent: true, availability: "unknown", tags_json: "[]",
      location_source: "Fictional drill location; not the participant's real location", intake_allowed: false })
  }
  save(ctx, args.command_id, "configure_drill_participants", input, { profile_ids: people.map(p => Number(p.id)), status: "configured" }, args.actor)
})

/** All recipients are queued atomically; the worker starts calls without waiting for others to end. */
export const startWildfireDrill = spacetimedb.reducer({ command_id: t.string(), payload_json: t.string(), actor: t.string() }, (ctx, args) => {
  const input = parse(args.payload_json)
  if (replay(ctx, args.command_id, "wildfire_drill", input)) return
  const realPeople = drillProfiles(ctx, input)
  const simulated = SIMULATED_NEIGHBORS.map((p,index) => {
    const phone = 'simulation:neighbor:' + index
    const existing = [...ctx.db.profile.iter()].find(row => row.phone === phone)
    return existing ?? ctx.db.profile.insert({ id:0n,name:p.name,phone,lat:0,lng:0,contact_profile_ids:[] })
  })
  const people = [...realPeople,...simulated]
  const area = { lat: 37.8462, lng: -122.2499, radius_m: 400 }
  const context = "This is a consented RideOut wildfire evacuation drill, not a real emergency. The Rockridge incident and location are fictional. Coordination is enabled: fetch the current mission using coordinate_call after identity confirmation and the drill explanation, and share important discoveries during the conversation. Use the latest mission response to decide the next useful question or completion; do not add a redundant final check. Introduce yourself as Tom, an AI agent from RideOut, and confirm the person's name before discussing the situation. Then clearly say this is a drill. Listen naturally to the participant's imagined evacuation situation and save their account using report_call. Do not use record_check_in. Only an authorized arrangement task permits its specified proposal disclosures; do not promise a ride or instruct real-world action."
  const creation = {
    text: "Wildfire evacuation drill in Rockridge. Fictional incident; consenting participants receive real phone calls.",
    objective: "Coordinate assistance in this fictional evacuation drill: discover needs and available help, propose suitable arrangements for human approval, and confirm acceptance, pickup and arrival separately.",
    area, scope: { profile_ids: people.map(p => Number(p.id)) },
    policy: { max_concurrent_calls: Math.min(10,people.length), max_calls_total: people.length * 8, max_calls_per_destination: 8, paused: false },
    coordination_enabled: false,
    preferences: people.filter(p => !preference(ctx, p.id)).map(p => ({ profile_id: Number(p.id), call_consent: true, location_source: "Fictional Rockridge drill location; not the participant's real location" })),
  }
  createCase(ctx, { command_id: args.command_id + ":case", payload_json: canonicalJson(creation), actor: args.actor })
  const created = JSON.parse(ctx.db.operatorCommand.command_id.find(args.command_id + ":case")!.result_json)
  const state: AssistanceState = { case_id:created.support_case_id,revision:1,planned_revision:0,paused:false,
    scenario:EVACUATION_DRILL,people:people.map((p,index)=>({profile_id:Number(p.id),name:p.name,mode:index < realPeople.length ? 'real' : 'simulated',...(index < realPeople.length ? {start_location_id: ((input.participants as {location_id?:string}[]|undefined)?.[index]?.location_id ?? DRILL_STARTING_LOCATIONS[index].id)} : {}),facts:emptyFacts(),sources:{},consent:true,unreachable:false,...(index < realPeople.length ? {} : {simulation:SIMULATED_NEIGHBORS[index-realPeople.length].facts})})),
    findings:[],tasks:[],arrangements:[],messages:[{id:'started:'+created.support_case_id,from:'facilitator',text:'I’m checking who needs assistance and who may be able to help. Proposed arrangements will need your approval. This is a fictional drill.',at:now(ctx),kind:'update'}],review:null,failure_count:0,retry_at:0,error:'',processed_reports:[] }
  ctx.db.assistanceSession.insert({case_id:BigInt(created.support_case_id),revision:1n,state_json:JSON.stringify(state)})
  const attemptIds: number[] = []
  for (const [index, person] of people.entries()) {
    const callCommand = args.command_id + ":call:" + index
    requestCall(ctx, {
      case_id: BigInt(created.support_case_id), command_id: callCommand, actor: args.actor,
      payload_json: canonicalJson({ expected_input_revision: 1, profile_id: Number(person.id),
        queued: attemptIds.map(attempt_id => ({ attempt_id, disposition: "retain" })), context,
        question: "For this wildfire drill, imagine you need to leave your neighborhood. Could you leave on your own, or what assistance would you need?" }),
    })
    const attemptId=JSON.parse(ctx.db.operatorCommand.command_id.find(callCommand)!.result_json).attempt_id
    attemptIds.push(attemptId)
    const task=addTask(state,Number(person.id),'assess',now(ctx),'Discover current needs and ability to help')!
    task.attempt_id=attemptId
  }
  ctx.db.assistanceSession.case_id.update({case_id:BigInt(created.support_case_id),revision:1n,state_json:JSON.stringify(state)})
  save(ctx, args.command_id, "wildfire_drill", input, { ...created, attempt_id: attemptIds[0], attempt_ids: attemptIds,
    profile_id: Number(people[0].id), profile_ids: people.map(p => Number(p.id)), status: "queued" }, args.actor)
})
export const inputInformationCase = spacetimedb.reducer({ case_id: t.u64(), command_id: t.string(), payload_json: t.string(), actor: t.string() }, (ctx, { case_id, command_id, payload_json, actor }) => {
  const input = parse(payload_json), payload = { ...input, case_id: Number(case_id) }
  if (replay(ctx, command_id, "information_input", payload)) return
  const c = getCase(ctx, case_id)
  if (c.status !== "open" || c.input_revision !== BigInt(revision(input.expected_input_revision))) fail("Stale revision or closed case; refresh")
  const note = ctx.db.note.insert({ id: 0n, support_case_id: case_id, attempt_id: 0n, source: "organizer", text: text(input.text, "text"), lat: undefined, lng: undefined, radius_m: undefined, at: ctx.timestamp })
  dirty(ctx, case_id)
  save(ctx, command_id, "information_input", payload, { support_case_id: Number(case_id), input_revision: Number(c.input_revision + 1n), note_id: Number(note.id), status: "recorded" }, actor)
})
export const recordInformationPlanFailure = spacetimedb.reducer({ case_id: t.u64(), expected_input_revision: t.u64(), message: t.string() }, (ctx, { case_id, expected_input_revision, message }) => {
  const c = getCase(ctx, case_id), p = ctx.db.informationPlanning.support_case_id.find(case_id)
  if (!p?.enabled || c.status !== "open" || c.input_revision !== expected_input_revision || c.evaluated_revision === expected_input_revision) return
  const previous = p.failure_revision === expected_input_revision ? p.failure_count : 0
  if (previous >= 3 || (p.failure_revision === expected_input_revision && (p.retry_at_ms ?? 0) > now(ctx))) return
  const failure_count = previous + 1
  ctx.db.informationPlanning.support_case_id.update({ ...p, failure_revision: expected_input_revision, failure_count, retry_at_ms: failure_count < 3 ? now(ctx) + (failure_count === 1 ? 5000 : 15000) : undefined, error: message.slice(0, 2000) })
})
export const commitInformationPlan = spacetimedb.reducer({ case_id: t.u64(), expected_input_revision: t.u64(), plan_json: t.string(), model: t.string(), request_id: t.string() }, (ctx, { case_id, expected_input_revision, plan_json, model, request_id }) => {
  const c = getCase(ctx, case_id), planning = ctx.db.informationPlanning.support_case_id.find(case_id), policy = JSON.parse(c.policy_json) as InformationPolicy
  if (!planning?.enabled || c.status !== "open" || policy.paused || c.input_revision !== expected_input_revision || c.evaluated_revision === expected_input_revision) fail("Stale revision or unavailable case; refresh")
  const decisionId = `${case_id}:${expected_input_revision}`
  if (ctx.db.informationDecision.id.find(decisionId)) fail("This revision already has an accepted decision")
  const plan = parseInformationPlan(JSON.parse(plan_json)), history = [...ctx.db.attemptProgress.support_case_id.filter(case_id)]
  if (history.some(p => p.report_received && !p.report_processed)) fail("Received reports must be processed first")
  const evidence = new Set([`incident:${c.incident_id}`, `objective:${c.input_revision}`])
  for (const n of ctx.db.note.support_case_id.filter(case_id)) evidence.add(`note:${n.id}`)
  for (const p of history) if (p.report_received && p.report_processed && ctx.db.informationAttempt.attempt_id.find(p.attempt_id)?.binding_status === "matched") evidence.add(`report:${p.attempt_id}`)
  const requireEvidence = (references: string[]) => {
    if (new Set(references).size !== references.length || references.some(ref => !evidence.has(ref))) fail("Plan evidence must belong to this case")
  }
  requireEvidence(plan.evidence_ids)
  for (const concern of plan.concerns) requireEvidence(concern.evidence_ids)
  for (const call of plan.calls) { if (!call.evidence_ids.length) fail("A call needs supporting evidence"); requireEvidence(call.evidence_ids) }
  const queued = history.filter(p => p.transport === "queued")
  if (queued.length !== plan.queued.length || new Set(plan.queued.map(q => q.attempt_id)).size !== queued.length
    || plan.queued.some(q => !queued.some(p => p.attempt_id === BigInt(q.attempt_id)))) fail("Every queued attempt needs an explicit retain/cancel decision")
  const retained = plan.queued.filter(q => q.disposition === "retain")
  if (plan.organizer_review && (plan.calls.length || retained.length)) fail("Organizer review cannot authorize more calls")
  if (!plan.calls.length && !retained.length && !plan.wait_reason && !plan.organizer_review) fail("An empty plan needs a waiting or organizer review reason")
  for (const q of plan.queued.filter(q => q.disposition === "cancel")) cancelQueued(ctx, BigInt(q.attempt_id), q.reason)
  for (const q of retained) {
    const row = getAttempt(ctx, BigInt(q.attempt_id))
    eligible(ctx, case_id, row.attempt.profile_id); budget(ctx, case_id, row.attempt.profile_id, row.attempt.id)
    validateCommittedIntent(ctx, row)
    ctx.db.informationAttempt.attempt_id.update({ ...row.metadata, authorized_revision: c.input_revision })
  }
  const attempt_ids: bigint[] = []
  for (const call of plan.calls) {
    const profile_id = BigInt(call.profile_id)
    eligible(ctx, case_id, profile_id)
    budget(ctx, case_id, profile_id)
    const context = renderedContext(ctx, case_id, profile_id, call.disclose_fact_ids)
    const a = ctx.db.attempt.insert({ id: 0n, support_case_id: case_id, profile_id, ask: call.question, call_id: undefined, outcome: undefined, answer: "", concern: "", created_at: ctx.timestamp })
    ctx.db.attemptProgress.insert({ attempt_id: a.id, support_case_id: case_id, context, transport: "queued", claim_token: "", dispatch_error: "", claimed_at_ms: undefined, report_received: false, report_processed: false, raw_concern: "", report_received_at_ms: undefined, accepted_at_ms: undefined, review_consumed: false })
    ctx.db.informationAttempt.insert(newMetadata(a.id, "plan:" + decisionId, c.input_revision)); attempt_ids.push(a.id)
  }
  if (request_id.length > 300) fail("Invalid model request ID")
  ctx.db.informationDecision.insert({ id: decisionId, support_case_id: case_id, based_on_revision: c.input_revision, created_at: ctx.timestamp, model: text(model, "model", 200), request_id, plan_json: canonicalJson(plan), attempt_ids })
  ctx.db.informationCase.id.update({ ...c, evaluated_revision: c.input_revision, brief: plan.summary, policy_json: plan.organizer_review ? canonicalJson({ ...policy, paused: true }) : c.policy_json })
  resetPlanningFailure(ctx, case_id, c.input_revision)
})
export const claimInformationAttempt = spacetimedb.reducer({ attempt_id: t.u64(), claim_token: t.string() }, (ctx, { attempt_id, claim_token }) => {
  text(claim_token, "claim_token", 200); const { attempt, progress } = authorized(ctx, attempt_id), policy = JSON.parse(getCase(ctx, attempt.support_case_id).policy_json) as InformationPolicy
  if (progress.transport !== "queued") fail("Attempt is not queued")
  const occupied = [...ctx.db.attempt.iter()].filter(a => {
    if (ctx.db.informationAttempt.attempt_id.find(a.id)?.provider_terminal_status) return false
    const p = ctx.db.attemptProgress.attempt_id.find(a.id)
    return p ? ["dispatching", "active", "unknown"].includes(p.transport) : true
  }).length
  if (occupied >= policy.max_concurrent_calls) fail("Concurrent call limit reached")
  ctx.db.attemptProgress.attempt_id.update({ ...progress, transport: "dispatching", claim_token, claimed_at_ms: now(ctx) })
})
export const validateInformationClaim = spacetimedb.reducer({ attempt_id: t.u64(), claim_token: t.string() }, (ctx, { attempt_id, claim_token }) => { const { progress } = authorized(ctx, attempt_id); if (progress.transport !== "dispatching" || !claim_token || progress.claim_token !== claim_token) fail("Claim token mismatch") })
export const releaseInformationClaim = spacetimedb.reducer({ attempt_id: t.u64(), claim_token: t.string(), reason: t.string() }, (ctx, { attempt_id, claim_token, reason }) => {
  const { attempt, progress, metadata } = getAttempt(ctx, attempt_id)
  if (progress.transport !== "dispatching" || !claim_token || progress.claim_token !== claim_token || attempt.call_id || progress.report_received) fail("Cannot release this claim")
  const cancel = getCase(ctx, attempt.support_case_id).status === "closed" || (metadata.decision_command_id.startsWith("plan:") && !ctx.db.informationPlanning.support_case_id.find(attempt.support_case_id)?.enabled)
  ctx.db.attemptProgress.attempt_id.update({ ...progress, transport: cancel ? "cancelled" : "queued", claim_token: "", claimed_at_ms: undefined, dispatch_error: reason.slice(0, 2000) })
  if (cancel) ctx.db.attempt.id.update({ ...attempt, outcome: "superseded" })
  // A newer plan may have seen this work as dispatching and omitted it from its
  // queued partition. Releasing a definitely-unsent claim must then wake planning.
  const current = getCase(ctx, attempt.support_case_id)
  if (!cancel && current.input_revision === current.evaluated_revision) dirty(ctx, current.id)
})
export const recordInformationDispatch = spacetimedb.reducer({ attempt_id: t.u64(), claim_token: t.string(), call_id: t.string(), error: t.string() }, (ctx, { attempt_id, claim_token, call_id, error }) => {
  const { attempt, progress, metadata } = getAttempt(ctx, attempt_id)
  if (!claim_token || progress.claim_token !== claim_token || !["dispatching", "unknown", "active", "ended"].includes(progress.transport)) fail("Dispatch claim token mismatch")
  if (attempt.call_id && call_id && attempt.call_id !== call_id) fail("Provider call ID cannot change")
  const providerId = call_id || attempt.call_id, binding = metadata.report_provider_call_id && providerId ? metadata.report_provider_call_id === providerId ? "matched" : "conflict" : metadata.binding_status
  ctx.db.attempt.id.update({ ...attempt, call_id: providerId }); ctx.db.attemptProgress.attempt_id.update({ ...progress, transport: metadata.provider_terminal_status ? "ended" : !providerId || error ? "unknown" : "active", dispatch_error: error.slice(0, 2000) }); ctx.db.informationAttempt.attempt_id.update({ ...metadata, binding_status: binding })
})
export const receiveInformationReport = spacetimedb.reducer({ attempt_id: t.u64(), provider_call_id: t.string(), direction: t.string(), answer: t.string(), concern: t.string() }, (ctx, { attempt_id, provider_call_id, direction, answer, concern }) => {
  const { attempt, progress, metadata } = getAttempt(ctx, attempt_id); text(provider_call_id, "provider_call_id", 300); if (/\s|[{}]/.test(provider_call_id)) fail("Invalid provider call ID"); text(answer, "answer", 30_000)
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
  const session=ctx.db.assistanceSession.case_id.find(attempt.support_case_id)
  if(session && do_not_call){
    const s=JSON.parse(session.state_json) as AssistanceState
    const person=s.people.find(p=>p.profile_id===Number(attempt.profile_id))
    if(person)person.consent=false
    s.revision++;s.failure_count=0;s.retry_at=0
    ctx.db.assistanceSession.case_id.update({...session,revision:BigInt(s.revision),state_json:JSON.stringify(s)})
  }
  if (do_not_call) {
    const phone = normalizePhone(ctx.db.profile.id.find(attempt.profile_id)!.phone)
    preferences(ctx, [...ctx.db.profile.iter()].filter(p => normalizePhone(p.phone) === phone)
      .map(p => ({ profile_id: Number(p.id), call_consent: false })), attempt.support_case_id)
  }
  dirty(ctx, attempt.support_case_id)
})
export const failInformationReport = spacetimedb.reducer({ attempt_id: t.u64(), message: t.string() }, (ctx, { attempt_id, message }) => {
  const { progress, metadata } = getAttempt(ctx, attempt_id)
  if (progress.report_processed || metadata.interpretation_failure_count >= 3 || (metadata.interpretation_retry_at_ms ?? 0) > now(ctx)) return
  const count = metadata.interpretation_failure_count + 1
  ctx.db.informationAttempt.attempt_id.update({ ...metadata, interpretation_failure_count: count, interpretation_retry_at_ms: count < 3 ? now(ctx) + count * 2000 : undefined, interpretation_error: message.slice(0, 2000) })
})
export const retryInformationReport = spacetimedb.reducer({ attempt_id: t.u64(), command_id: t.string(), payload_json: t.string(), actor: t.string() }, (ctx, { attempt_id, command_id, payload_json, actor }) => {
  const input = parse(payload_json), payload = { ...input, attempt_id: Number(attempt_id) }
  if (replay(ctx, command_id, "retry_information_report", payload)) return
  if (Object.keys(input).length) fail("Report retry accepts only command_id")
  const { attempt, progress, metadata } = getAttempt(ctx, attempt_id)
  if (!progress.report_received || metadata.binding_status !== "matched") fail("A saved matched report is required")
  if (progress.report_processed || metadata.interpretation_failure_count < 3) fail("Interpretation is already processed or still eligible for automatic retry")
  // Retry the same immutable receipt: never redial, replace its answer/binding,
  // or reopen a closed case. Normal processing will wake planning if still open.
  ctx.db.informationAttempt.attempt_id.update({ ...metadata, interpretation_failure_count: 0, interpretation_retry_at_ms: undefined, interpretation_error: "" })
  save(ctx, command_id, "retry_information_report", payload, { support_case_id: Number(attempt.support_case_id), attempt_id: Number(attempt_id), status: "retry_queued" }, actor)
})
export const recoverInformationClaims = spacetimedb.reducer({}, ctx => { for (const m of ctx.db.informationAttempt.iter()) { if (!m.decision_command_id) continue; const p = ctx.db.attemptProgress.attempt_id.find(m.attempt_id); if (p?.transport === "dispatching" && p.claimed_at_ms !== undefined && p.claimed_at_ms + 60_000 <= now(ctx)) ctx.db.attemptProgress.attempt_id.update({ ...p, transport: "unknown", dispatch_error: "Dispatch claim expired; reconcile provider outcome before another call" }) } })

/** A task and its follow-up call are authorized in one transaction. */
export const queueAssistanceTask = spacetimedb.reducer({case_id:t.u64(),task_id:t.string()},(ctx,args)=>{
  const row=ctx.db.assistanceSession.case_id.find(args.case_id)
  if(!row)fail('Coordinator case not found')
  const s=JSON.parse(row!.state_json) as AssistanceState,task=s.tasks.find(t=>t.id===args.task_id)
  if(!task || task.status!=='pending' || task.attempt_id!==null || task.due_at>now(ctx) || s.paused)fail('Task is not ready')
  const ready=task!
  if(ready.call_count>=2)fail('Task callback budget exhausted')
  const current=getCase(ctx,args.case_id)
  const command_id='assistance:'+ready.id+':'+ready.call_count
  const instruction=taskInstruction(s,ready)
  if(ready.arrangement_id){
    const arrangement=s.arrangements.find(a=>a.id===ready.arrangement_id)!
    eligible(ctx,args.case_id,BigInt(arrangement.recipient_id)); eligible(ctx,args.case_id,BigInt(arrangement.helper_id))
  }
  const context=s.scenario.context+' Coordination is enabled; fetch the current mission after identity confirmation and any drill explanation, then share discoveries through coordinate_call. The current authorized mission guides this conversation within its boundaries; use its latest response without a redundant final check. '
  requestCall(ctx,{case_id:args.case_id,command_id,actor:'incident coordinator',payload_json:canonicalJson({expected_input_revision:Number(current.input_revision),profile_id:ready.profile_id,question:instruction,context,queued:[...ctx.db.attemptProgress.support_case_id.filter(args.case_id)].filter(p=>p.transport==='queued').map(p=>({attempt_id:Number(p.attempt_id),disposition:'retain'}))})})
  ready.attempt_id=JSON.parse(ctx.db.operatorCommand.command_id.find(command_id)!.result_json).attempt_id
  ready.call_count++
  ctx.db.assistanceSession.case_id.update({...row!,state_json:JSON.stringify(s)})
})
