import { id, object, text, type ContactScope, type InformationPolicy } from "./information"
import type { DisclosureFact } from "./information-plan"

export type InformationIntakeConfiguration = {
  revision: number; enabled: boolean; default_scope: ContactScope
  policy: InformationPolicy; coordination_enabled: boolean; disclosure_facts: DisclosureFact[]
}
export type InformationIncomingAssessment = {
  kind: "intake" | "update" | "clarification" | "review"
  case_id: number | null
  description: string
  objective: string
  clarification: string | null
  reason: string
}
export type InformationIncomingProposal = {
  profile_id: number | null
  line_revision: number
  candidate_revisions: { case_id: number; input_revision: number }[]
  assessment: InformationIncomingAssessment
}
export type InformationIncomingResolution = {
  request_id: number; request_revision: number; support_case_id: number | null
  note_id: number | null; reporter_profile_id: number | null
  kind: "intake" | "automatic_update" | "operator_attach" | "operator_reject"
  reason: string; actor: string; created_at: string
}

export function parseInformationIncomingAssessment(value: unknown): InformationIncomingAssessment {
  const v = object(value, "incoming assessment")
  if (!["intake", "update", "clarification", "review"].includes(String(v.kind))) throw new Error("Invalid incoming assessment kind")
  if (typeof v.description !== "string" || v.description.length > 10_000 || typeof v.objective !== "string" || v.objective.length > 10_000) throw new Error("Invalid intake description or objective")
  const result: InformationIncomingAssessment = {
    kind: v.kind as InformationIncomingAssessment["kind"], case_id: v.case_id === null ? null : id(v.case_id, "case_id"),
    description: v.description.trim(), objective: v.objective.trim(),
    clarification: v.clarification === null ? null : text(v.clarification, "clarification", 1000),
    reason: text(v.reason, "reason", 2000),
  }
  if (result.kind === "intake" && (!result.description || !result.objective)) throw new Error("Intake needs an incident account and information objective")
  if (result.kind === "update" && result.case_id === null) throw new Error("Update needs an associated case")
  if (result.kind !== "update" && result.case_id !== null) throw new Error("Only an update may select an existing case")
  if (result.kind === "clarification" && !result.clarification) throw new Error("Clarification needs a question")
  return result
}

/** Membership is a lookup hint, never caller authentication or new consent. */
export function incomingCandidateIds(
  profileId: number,
  cases: { id: number; status: string; scope: ContactScope }[],
  attempts: { profile_id: number; support_case_id: number; dispatched: boolean }[],
  resolutions: Pick<InformationIncomingResolution, "kind" | "reporter_profile_id" | "support_case_id">[],
): number[] {
  return cases.filter(c => c.status === "open" && (
    c.scope.profile_ids?.includes(profileId)
    || attempts.some(a => a.profile_id === profileId && a.support_case_id === c.id && a.dispatched)
    || resolutions.some(r => r.kind === "intake" && r.reporter_profile_id === profileId && r.support_case_id === c.id)
  )).map(c => c.id).sort((a, b) => a - b)
}
