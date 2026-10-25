import { proposeInformationPlan } from "./agent"
import type { AttemptProgressRow, AttemptRow, NoteRow, ProfileRow } from "./db"
import type { readInformationState } from "./information"
import { contactEligibility, matchesScope, normalizePhone } from "../shared/information"
import type { InformationDecisionRow, InformationPlanningRow } from "../shared/information-plan"

type SnapshotInput = {
  information: Awaited<ReturnType<typeof readInformationState>>
  planning: InformationPlanningRow
  decisions: InformationDecisionRow[]
  profiles: ProfileRow[]
  attempts: AttemptRow[]
  progress: AttemptProgressRow[]
  notes: NoteRow[]
  caseId: number
  nowMs: number
}

/** A detached view for one model request. Phone numbers never enter the snapshot. */
export function buildInformationSnapshot(input: SnapshotInput) {
  const { information, planning, profiles, progress, nowMs } = input
  const current = information.cases.find(c => c.id === input.caseId)
  if (!current || planning.support_case_id !== current.id) throw new Error("Information case planning state is missing")
  const incident = information.incidents.find(i => i.id === current.incident_id)
  if (!incident) throw new Error("Information incident is missing")
  const work = new Map(progress.map(p => [p.attempt_id, p]))
  const metadata = new Map(information.metadata.map(m => [m.attempt_id, m]))
  const people = new Map(profiles.map(p => [p.id, p]))
  const phone = (profileId: number) => normalizePhone(people.get(profileId)?.phone ?? "")
  const caseAttempts = input.attempts.filter(a => a.support_case_id === current.id)
  const spent = caseAttempts.filter(a => !(work.get(a.id)?.transport === "cancelled" && !work.get(a.id)?.claim_token))
  const occupied = input.attempts.filter(a => !metadata.get(a.id)?.provider_terminal_status
    && (!work.has(a.id) || ["dispatching", "active", "unknown"].includes(work.get(a.id)!.transport))).length
  const directory = profiles.filter(p => matchesScope(p, current.scope, profiles, information.settings.find(s => s.profile_id === p.id)))
  const destinationKeys = new Map<string, string>()
  const contacts = directory.map(p => {
    const settings = information.settings.find(s => s.profile_id === p.id)
    const destination = phone(p.id)
    if (!destinationKeys.has(destination)) destinationKeys.set(destination, "destination:" + (destinationKeys.size + 1))
    const baseReasons = contactEligibility(p, settings)
    const same = spent.filter(a => phone(a.profile_id) === destination)
    const terminalAt = same.reduce((last, a) => Math.max(last, metadata.get(a.id)?.terminal_observed_at_ms ?? 0), 0)
    const repeatEligibleAt = terminalAt ? terminalAt + current.policy.min_repeat_ms : null
    const pending = input.attempts.filter(a => phone(a.profile_id) === destination
      && work.get(a.id)?.transport !== "cancelled" && !metadata.get(a.id)?.provider_terminal_status)
    const reasons = [...baseReasons]
    if (current.status !== "open") reasons.push("Case is not open")
    if (current.policy.paused) reasons.push("Case is paused")
    if (!planning.enabled) reasons.push("Automatic coordination is disabled")
    if (spent.length >= current.policy.max_calls_total) reasons.push("Case call budget is exhausted")
    if (same.length >= current.policy.max_calls_per_destination) reasons.push("Destination call budget is exhausted")
    if (pending.length) reasons.push("Destination has queued, active or unresolved work")
    if (repeatEligibleAt !== null && repeatEligibleAt > nowMs) reasons.push("Repeat-call cooldown has not elapsed")
    return {
      profile_id: p.id, name: p.name, destination_key: destinationKeys.get(destination)!,
      directory_location: { lat: p.lat, lng: p.lng, source: settings?.location_source ?? "Stored directory coordinate; current whereabouts unverified" },
      related_profile_ids: p.contact_profile_ids.filter(id => directory.some(other => other.id === id)),
      tags: [...(settings?.tags ?? [])], availability: settings?.availability ?? "unknown", call_consent: settings?.call_consent ?? false,
      eligible_for_new_call: reasons.length === 0, eligibility_reasons: reasons,
      eligible_to_retain_queued: baseReasons.length === 0 && current.status === "open" && !current.policy.paused && planning.enabled,
      destination_budget_used_including_queued: same.length,
      repeat_eligible_at_ms: repeatEligibleAt,
      pending_case_attempt_ids: pending.filter(a => a.support_case_id === current.id).map(a => a.id),
      has_work_in_another_case: pending.some(a => a.support_case_id !== current.id),
      allowed_disclosure_facts: planning.disclosure_facts.filter(f => f.profile_ids === null || f.profile_ids.includes(p.id)).map(f => ({ id: f.id, text: f.text })),
    }
  })
  const evidence: { id: string; source: string; text: string; speaker: string; attempt_id: number | null; at: string | number | null }[] = [
    { id: "incident:" + incident.id, source: "organizer_incident", text: incident.description, speaker: "Organizer", attempt_id: null, at: incident.created_at },
    { id: "objective:" + current.input_revision, source: "organizer_objective", text: current.objective, speaker: "Organizer", attempt_id: null, at: null },
  ]
  for (const note of input.notes.filter(n => n.support_case_id === current.id)) {
    const sourceAttempt = caseAttempts.find(a => a.id === note.attempt_id)
    evidence.push({ id: "note:" + note.id, source: note.source, text: note.text,
      speaker: note.source === "organizer" ? "Organizer" : sourceAttempt ? people.get(sourceAttempt.profile_id)?.name ?? "Caller" : "Unverified source",
      attempt_id: note.attempt_id || null, at: note.at })
  }
  for (const attempt of caseAttempts) {
    const p = work.get(attempt.id), meta = metadata.get(attempt.id)
    if (meta?.binding_status !== "matched" || !p?.report_received || !p.report_processed) continue
    evidence.push({ id: "report:" + attempt.id, source: "caller_account_unverified", text: attempt.answer,
      speaker: people.get(attempt.profile_id)?.name ?? "Caller", attempt_id: attempt.id, at: p.report_received_at_ms })
  }
  const attempts = caseAttempts.map(a => {
    const p = work.get(a.id), meta = metadata.get(a.id)
    return {
      attempt_id: a.id, profile_id: a.profile_id, question: a.ask, authorized_context: p?.context ?? "",
      transport: p?.transport ?? "unknown", outcome: a.outcome,
      report_received: p?.report_received ?? false, report_processed: p?.report_processed ?? false,
      binding_status: meta?.binding_status ?? "unbound", interpretation_error: meta?.interpretation_error ?? "",
      provider_terminal_status: meta?.provider_terminal_status ?? "", provider_end_reason: meta?.provider_end_reason ?? "",
      terminal_observed_at_ms: meta?.terminal_observed_at_ms ?? null,
      created_at: a.created_at,
    }
  })
  const lastDecision = input.decisions.filter(d => d.support_case_id === current.id).sort((a, b) => b.based_on_revision - a.based_on_revision)[0]
  return {
    case_id: current.id, input_revision: current.input_revision, server_time_ms: nowMs,
    objective: current.objective, incident_description: incident.description, status: current.status,
    closure_rule: "Only an explicit organizer closure can close the case",
    policy: { ...current.policy }, max_new_calls: 2, future_reviews_supported: false,
    previous_planning_error: planning.failure_revision === current.input_revision ? planning.error || null : null,
    call_budget_used_including_queued: spent.length,
    global_occupied_calls: occupied,
    contacts, evidence, attempts,
    queued_attempt_ids: attempts.filter(a => a.transport === "queued").map(a => a.attempt_id),
    last_accepted_decision: lastDecision ? { based_on_revision: lastDecision.based_on_revision, ...structuredClone(lastDecision.plan) } : null,
  }
}

export async function planInformationSnapshot(snapshot: ReturnType<typeof buildInformationSnapshot>) {
  return proposeInformationPlan(snapshot)
}
