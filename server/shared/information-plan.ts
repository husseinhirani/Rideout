import { id, object, text } from "./information"

/** An organizer approves disclosure; the planner can only select these facts. */
export type DisclosureFact = { id: string; text: string; profile_ids: number[] | null }
export type InformationPlan = {
  summary: string
  open_questions: string[]
  concerns: { explanation: string; evidence_ids: string[] }[]
  evidence_ids: string[]
  queued: { attempt_id: number; disposition: "retain" | "cancel"; reason: string }[]
  calls: { profile_id: number; question: string; evidence_ids: string[]; disclose_fact_ids: string[]; reason: string }[]
  wait_reason: string | null
  organizer_review: string | null
}
export type InformationPlanningRow = {
  support_case_id: number; enabled: boolean; disclosure_facts: DisclosureFact[]
  failure_revision: number; failure_count: number; retry_at_ms: number | null; error: string
  blocked_reason?: string | null
}
export type InformationDecisionRow = {
  id: string; support_case_id: number; based_on_revision: number; created_at: string
  model: string; request_id: string; plan: InformationPlan; attempt_ids: number[]
}

function strings(value: unknown, name: string, max: number, length = 4000): string[] {
  if (!Array.isArray(value) || value.length > max) throw new Error("Invalid " + name)
  return value.map(item => text(item, name, length))
}
export function disclosureFacts(value: unknown): DisclosureFact[] {
  if (!Array.isArray(value) || value.length > 30) throw new Error("Invalid disclosure_facts")
  const seen = new Set<string>()
  return value.map(item => {
    const v = object(item, "disclosure fact"), key = text(v.id, "fact id", 100)
    if (seen.has(key)) throw new Error("Duplicate disclosure fact id")
    seen.add(key)
    if (v.profile_ids !== null && (!Array.isArray(v.profile_ids) || v.profile_ids.length > 1000)) throw new Error("Invalid fact recipients")
    return { id: key, text: text(v.text, "disclosure text", 2000), profile_ids: v.profile_ids === null ? null : [...new Set((v.profile_ids as unknown[]).map(p => id(p, "profile_id")))] }
  })
}
/** Structure only. Reducers validate current evidence, authority and budgets. */
export function parseInformationPlan(value: unknown): InformationPlan {
  const v = object(value, "plan")
  if (!Array.isArray(v.calls) || v.calls.length > 2 || !Array.isArray(v.queued) || v.queued.length > 1000 || !Array.isArray(v.concerns) || v.concerns.length > 10) throw new Error("Invalid plan collections")
  const refs = (value: unknown) => strings(value, "evidence_ids", 20, 200)
  return {
    summary: text(v.summary, "summary", 5000), open_questions: strings(v.open_questions, "open_questions", 10), evidence_ids: refs(v.evidence_ids),
    concerns: v.concerns.map(raw => { const c = object(raw, "concern"); return { explanation: text(c.explanation, "explanation", 2000), evidence_ids: refs(c.evidence_ids) } }),
    queued: v.queued.map(raw => {
      const q = object(raw, "queued decision")
      if (q.disposition !== "retain" && q.disposition !== "cancel") throw new Error("Invalid queued disposition")
      return { attempt_id: id(q.attempt_id, "attempt_id"), disposition: q.disposition, reason: text(q.reason, "reason", 2000) }
    }),
    calls: v.calls.map(raw => {
      const c = object(raw, "call")
      return { profile_id: id(c.profile_id, "profile_id"), question: text(c.question, "question", 4000), evidence_ids: refs(c.evidence_ids), disclose_fact_ids: strings(c.disclose_fact_ids, "disclose_fact_ids", 30, 100), reason: text(c.reason, "reason", 2000) }
    }),
    wait_reason: v.wait_reason === null ? null : text(v.wait_reason, "wait_reason", 2000),
    organizer_review: v.organizer_review === null ? null : text(v.organizer_review, "organizer_review", 2000),
  }
}
