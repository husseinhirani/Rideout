import { query, asId, asString, asArea, asTimestamp, asOption, optionalNumber, callReducer, profiles, attempts } from "./db"
import { ServiceError } from "./service"
import { canonicalJson, commandId, contactScope, matchesScope, contactEligibility, object, id, type InformationIncidentRow, type InformationCaseRow, type ProfileSettingsRow, type InformationAttemptRow, type InformationCommandResult, type DirectoryQuery } from "../shared/information"
import type { InformationPlanningRow, InformationDecisionRow } from "../shared/information-plan"

export async function readInformationPlanning(): Promise<{ planning: InformationPlanningRow[]; decisions: InformationDecisionRow[] }> {
  const [planning, decisions] = await Promise.all([query("SELECT * FROM information_planning"), query("SELECT * FROM information_decision")])
  return {
    planning: planning.map(r => ({ support_case_id: asId(r.support_case_id), enabled: r.enabled === true,
      disclosure_facts: JSON.parse(asString(r.disclosure_json)), failure_revision: asId(r.failure_revision),
      failure_count: asId(r.failure_count), retry_at_ms: optionalNumber(r.retry_at_ms), error: asString(r.error) })),
    decisions: decisions.map(r => ({ id: asString(r.id), support_case_id: asId(r.support_case_id),
      based_on_revision: asId(r.based_on_revision), created_at: asTimestamp(r.created_at),
      model: asString(r.model), request_id: asString(r.request_id), plan: JSON.parse(asString(r.plan_json)),
      attempt_ids: (r.attempt_ids as unknown[]).map(asId) })),
  }
}

export async function readInformationState(): Promise<{ incidents: InformationIncidentRow[]; cases: InformationCaseRow[]; settings: ProfileSettingsRow[]; metadata: InformationAttemptRow[]; line: { default_scope: ReturnType<typeof contactScope> } | null }> {
  const [incidents, cases, settings, metadata, line] = await Promise.all([query("SELECT * FROM information_incident"), query("SELECT * FROM information_case"), query("SELECT * FROM profile_settings"), query("SELECT * FROM information_attempt"), query("SELECT * FROM information_line")])
  return {
    incidents: incidents.map(r => ({ id: asId(r.id), description: asString(r.description), area: asOption(r.area) == null ? null : asArea(asOption(r.area)), status: asString(r.status), created_at: asTimestamp(r.created_at) })),
    cases: cases.map(r => ({ id: asId(r.id), incident_id: asId(r.incident_id), objective: asString(r.objective), scope: JSON.parse(asString(r.scope_json)), policy: JSON.parse(asString(r.policy_json)), input_revision: asId(r.input_revision), evaluated_revision: asId(r.evaluated_revision), status: asString(r.status), brief: asString(r.brief) })),
    settings: settings.map(r => ({ profile_id: asId(r.profile_id), call_consent: r.call_consent === true, availability: asString(r.availability) as ProfileSettingsRow["availability"], tags: JSON.parse(asString(r.tags_json)), location_source: asString(r.location_source), intake_allowed: r.intake_allowed === true })),
    metadata: metadata.map(r => ({ attempt_id: asId(r.attempt_id), decision_command_id: asString(r.decision_command_id), authorized_revision: asId(r.authorized_revision), report_provider_call_id: asString(r.report_provider_call_id), report_direction: asString(r.report_direction), binding_status: asString(r.binding_status) as InformationAttemptRow["binding_status"], terminal_observed_at_ms: optionalNumber(r.terminal_observed_at_ms), provider_terminal_status: asString(r.provider_terminal_status), provider_end_reason: asString(r.provider_end_reason), interpretation_failure_count: asId(r.interpretation_failure_count), interpretation_retry_at_ms: optionalNumber(r.interpretation_retry_at_ms), interpretation_error: asString(r.interpretation_error) })),
    line: line.length ? { default_scope: JSON.parse(asString(line[0].default_scope_json)) } : null,
  }
}
export async function directory(input: DirectoryQuery, caseId?: number) {
  const { limit = 50, after_id = 0, eligible_only = false, ...filter } = input
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100 || !Number.isSafeInteger(after_id) || after_id < 0 || typeof eligible_only !== "boolean") throw new ServiceError(400, "Invalid directory pagination")
  let scope: ReturnType<typeof contactScope>
  try { scope = contactScope(filter) } catch (error) { throw new ServiceError(400, (error as Error).message) }
  const [all, state] = await Promise.all([profiles(), readInformationState()])
  const current = caseId === undefined ? undefined : state.cases.find(c => c.id === caseId)
  if (caseId !== undefined && !current) throw new ServiceError(404, "Information case not found")
  const result = all.sort((a,b) => a.id-b.id).flatMap(profile => {
    if (profile.id <= after_id) return []
    const preference = state.settings.find(s => s.profile_id === profile.id)
    if (!matchesScope(profile, scope, all, preference) || (current && !matchesScope(profile, current.scope, all, preference))) return []
    const reasons = contactEligibility(profile, preference)
    if (eligible_only && reasons.length) return []
    const { phone, ...publicProfile } = profile
    return [{ ...publicProfile, phone_last4: phone.slice(-4), eligible: reasons.length === 0, eligibility_reasons: reasons, call_consent: preference?.call_consent ?? false, availability: preference?.availability ?? "unknown", tags: preference?.tags ?? [], location_source: preference?.location_source ?? "Directory coordinate; current whereabouts unverified" }]
  })
  return { profiles: result.slice(0, limit), next_after_id: result.length > limit ? result[limit-1].id : null }
}
function reducerError(error: unknown): never {
  const message = error instanceof Error ? error.message : "Operation failed"
  const conflict = /conflict|stale|already|unresolved|budget|cooldown|processed first|queued attempt|not currently authorized|mismatch/i.test(message)
  throw new ServiceError(conflict ? 409 : /not found/i.test(message) ? 404 : 400, message)
}
async function command(reducer: string, body: unknown, actor: string, caseId?: number): Promise<InformationCommandResult> {
  let input: Record<string, unknown>, command_id: string
  try { input = { ...object(body, "request") }; command_id = commandId(input.command_id); delete input.command_id; if (caseId !== undefined) id(caseId, "case_id") } catch (error) { throw new ServiceError(400, (error as Error).message) }
  try { await callReducer(reducer, [...(caseId === undefined ? [] : [caseId]), command_id, canonicalJson(input), actor]) } catch (error) { reducerError(error) }
  // The reducer stores the exact result, so concurrent creates cannot confuse IDs.
  const row = (await query("SELECT * FROM operator_command")).find(r => r.command_id === command_id)
  if (!row) throw new ServiceError(500, "Command result is missing")
  return JSON.parse(asString(row.result_json)) as InformationCommandResult
}
export const createInformationCase = (body: unknown, actor: string) => command("createInformationCase", body, actor)
export const configureInformationCase = (caseId: number, body: unknown, actor: string) => command("configureInformationCase", body, actor, caseId)
export const requestInformationCall = (caseId: number, body: unknown, actor: string) => command("requestInformationCall", body, actor, caseId)
export const inputInformationCase = (caseId: number, body: unknown, actor: string) => command("inputInformationCase", body, actor, caseId)
export const retryInformationReport = (attemptId: number, body: unknown, actor: string) => command("retryInformationReport", body, actor, attemptId)
export async function receiveInformationReport(body: unknown) {
  let input: Record<string, unknown>, attemptId: number
  try { input = object(body, "report"); attemptId = id(typeof input.attempt_id === "string" && /^\d+$/.test(input.attempt_id) ? Number(input.attempt_id) : input.attempt_id, "attempt_id") } catch (error) { throw new ServiceError(400, (error as Error).message) }
  for (const key of ["provider_call_id", "direction", "answer"] as const) if (typeof input[key] !== "string") throw new ServiceError(400, key + " must be a string")
  if (input.concern !== undefined && typeof input.concern !== "string") throw new ServiceError(400, "concern must be a string")
  try { await callReducer("receiveInformationReport", [attemptId, input.provider_call_id, input.direction, input.answer, input.concern ?? ""]) } catch (error) { reducerError(error) }
  const attempt = (await attempts()).find(a => a.id === attemptId)
  if (!attempt) throw new ServiceError(500, "Saved report attempt is missing")
  return { support_case_id: attempt.support_case_id, status: "received", reply: "I've saved what you told me for the coordinator." }
}
