import * as db from "./db"
import { assessDemoIntake, type IntakeAssessment } from "./intake"

// Metadata must come from the internal caller / future trusted adapter, never
// from model-produced tool arguments. Complete intake does not verify identity.
export type CaseInputMetadata = { eventKey: string; reporterProfileId: number; caseId?: number }
export type IntakeMetadata = { eventKey: string; reporterProfileId: number; helperProfileIds: number[] }
type Recorded = { status: "recorded"; support_case_id: number }
type Clarification = Extract<IntakeAssessment, { status: "needs_clarification" }>
export type CaseInputPorts = Pick<typeof db, "callReducer" | "caseInputs" | "caseIntakes" | "supportCases" | "caseProgress">

function positiveId(value: unknown): asserts value is number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) throw new Error("Profile and case IDs must be positive safe integers")
}
function metadata(value: CaseInputMetadata | IntakeMetadata): void {
  if (!value || typeof value.eventKey !== "string" || !value.eventKey.trim()) throw new Error("A nonblank event key is required")
  positiveId(value.reporterProfileId)
  if ("caseId" in value && value.caseId !== undefined) positiveId(value.caseId)
}

export function resolveCaseForReporter(input: {
  reporterProfileId: number
  caseId?: number
  cases: db.SupportCaseRow[]
  intakes: db.CaseIntakeRow[]
  coordination: db.CaseProgressRow[]
}): db.SupportCaseRow {
  positiveId(input.reporterProfileId)
  if (input.caseId !== undefined) positiveId(input.caseId)
  const candidates = input.cases.filter(candidate => {
    if (input.caseId !== undefined ? candidate.id !== input.caseId : candidate.status !== "open") return false
    const intake = input.intakes.find(row => row.support_case_id === candidate.id)
    if (!intake) return false
    return intake.reporter_profile_id === input.reporterProfileId || input.coordination.some(row =>
      row.support_case_id === candidate.id && row.helper_profile_ids.includes(input.reporterProfileId))
  })
  if (candidates.length !== 1) throw new Error(candidates.length ? "Ambiguous case: supply an explicit case ID" : "No matching case for this reporter")
  return candidates[0]
}

export function createCaseInputService(ports: CaseInputPorts) {
  async function resolve(meta: CaseInputMetadata) {
    metadata(meta)
    // A receipt binds retries to their original case even after closure. The
    // reducer still checks event kind and content; this is only association.
    const receipt = meta.caseId === undefined
      ? (await ports.caseInputs()).find(row => row.event_key === meta.eventKey)
      : undefined
    if (receipt && receipt.reporter_profile_id !== meta.reporterProfileId) throw new Error("Event key belongs to a different reporter")
    const [cases, intakes, coordination] = await Promise.all([ports.supportCases(), ports.caseIntakes(), ports.caseProgress()])
    return { supportCase: resolveCaseForReporter({ ...meta, caseId: meta.caseId ?? receipt?.support_case_id, cases, intakes, coordination }), intakes }
  }
  async function createCaseFromIntake(draft: unknown, meta: IntakeMetadata): Promise<Recorded | Clarification> {
    metadata(meta)
    if (!Array.isArray(meta.helperProfileIds) || meta.helperProfileIds.length !== 2) throw new Error("Exactly two helper profile IDs are required")
    meta.helperProfileIds.forEach(positiveId)
    if (new Set(meta.helperProfileIds).size !== 2 || meta.helperProfileIds.includes(meta.reporterProfileId)) throw new Error("Helpers must be distinct from each other and the reporter")
    const assessment = assessDemoIntake(draft)
    if (assessment.status === "needs_clarification") return assessment
    await ports.callReducer("recordCaseIntake", [meta.eventKey, meta.reporterProfileId, meta.helperProfileIds, JSON.stringify(assessment.intake)])
    const receipt = (await ports.caseInputs()).find(row => row.event_key === meta.eventKey)
    if (!receipt || receipt.kind !== "intake" || receipt.reporter_profile_id !== meta.reporterProfileId) throw new Error("Intake receipt was not found after recording")
    return { status: "recorded", support_case_id: receipt.support_case_id }
  }
  async function addCaseUpdate(meta: CaseInputMetadata, text: string): Promise<Recorded> {
    metadata(meta)
    if (typeof text !== "string" || !text.trim()) throw new Error("Update text is required")
    const { supportCase } = await resolve(meta)
    await ports.callReducer("recordCaseUpdate", [meta.eventKey, supportCase.id, meta.reporterProfileId, text])
    return { status: "recorded", support_case_id: supportCase.id }
  }
  async function confirmCaseReunion(meta: CaseInputMetadata, confirmation: { childIdentityConfirmed: boolean; reunited: boolean; text: string }): Promise<Recorded> {
    metadata(meta)
    if (!confirmation || typeof confirmation.childIdentityConfirmed !== "boolean" || typeof confirmation.reunited !== "boolean" || typeof confirmation.text !== "string") throw new Error("Explicit reunion confirmation fields are required")
    const { supportCase, intakes } = await resolve(meta)
    if (intakes.find(row => row.support_case_id === supportCase.id)?.reporter_profile_id !== meta.reporterProfileId) throw new Error("Only the original intake reporter can confirm reunion")
    await ports.callReducer("recordReunionConfirmation", [meta.eventKey, supportCase.id, meta.reporterProfileId, confirmation.childIdentityConfirmed, confirmation.reunited, confirmation.text])
    return { status: "recorded", support_case_id: supportCase.id }
  }
  return { createCaseFromIntake, addCaseUpdate, confirmCaseReunion }
}

export const { createCaseFromIntake, addCaseUpdate, confirmCaseReunion } = createCaseInputService(db)
