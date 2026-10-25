import { nextIncidentId, nextCaseId } from "../ids"
import { SenderError, t, type ReducerCtx } from "spacetimedb/server"
import spacetimedb, { ACTIVE, CALL, CLOSED, OPEN } from "../models"
import { assessDemoIntake } from "../../../shared/intake"
import { coordinationInput } from "./coordination"
type Ctx = ReducerCtx<typeof spacetimedb.schemaType>
// IDs require a future trusted server binding. These public reducers do not
// authenticate callers or verify identity; they enforce case association only.
function replay(ctx: Ctx, key: string, kind: string, payload: string, caseId?: bigint) {
  if (!key.trim()) throw new SenderError("Event key is required")
  const previous = ctx.db.caseInput.event_key.find(key)
  if (!previous) return false
  if (previous.kind !== kind || previous.payload !== payload || (caseId !== undefined && previous.support_case_id !== caseId)) throw new SenderError("Event key already contains different input")
  return true
}
function participant(ctx: Ctx, caseId: bigint, reporterId: bigint) {
  const current = ctx.db.supportCase.id.find(caseId), intake = ctx.db.caseIntake.support_case_id.find(caseId)
  const progress = ctx.db.caseProgress.support_case_id.find(caseId), reporter = ctx.db.profile.id.find(reporterId)
  if (!current || !intake || !progress) throw new SenderError("Intake case not found")
  if (!reporter || (reporterId !== intake.reporter_profile_id && !progress.helper_profile_ids.includes(reporterId))) throw new SenderError("Reporter is not a case participant")
  return { current, intake, reporter }
}
function note(ctx: Ctx, id: bigint, text: string) {
  ctx.db.note.insert({ id: 0n, support_case_id: id, attempt_id: undefined, source: CALL, text, lat: undefined, lng: undefined, radius_m: undefined, at: ctx.timestamp })
}
function receipt(ctx: Ctx, key: string, id: bigint, reporterId: bigint, kind: string, payload: string) {
  ctx.db.caseInput.insert({ event_key: key, support_case_id: id, reporter_profile_id: reporterId, kind, payload, received_at: ctx.timestamp })
}
export const recordCaseIntake = spacetimedb.reducer(
  { event_key: t.string(), reporter_profile_id: t.u64(), helper_profile_ids: t.array(t.u64()), intake_json: t.string() },
  (ctx, { event_key, reporter_profile_id, helper_profile_ids, intake_json }) => {
    const assessment = assessDemoIntake(JSON.parse(intake_json))
    if (assessment.status !== "complete") throw new SenderError("Intake needs clarification")
    const intake = assessment.intake
    const payload = JSON.stringify({ reporter_profile_id: String(reporter_profile_id), helper_profile_ids: helper_profile_ids.map(String), intake })
    if (replay(ctx, event_key, "intake", payload)) return
    for (const existing of ctx.db.caseIntake.iter()) {
      if (existing.reporter_profile_id === reporter_profile_id && ctx.db.supportCase.id.find(existing.support_case_id)?.status !== CLOSED) {
        throw new SenderError("Reporter already has an open case")
      }
    }
    if (helper_profile_ids.length !== 2 || new Set(helper_profile_ids).size !== 2 || helper_profile_ids.includes(reporter_profile_id)) throw new SenderError("Parent and two distinct helpers required")
    const profiles = [reporter_profile_id, ...helper_profile_ids].map(id => ctx.db.profile.id.find(id))
    if (profiles.some(profile => !profile || !/^\+[1-9]\d{7,14}$/.test(profile.phone))) throw new SenderError("Participants must have known dialable profiles")
    if (new Set(profiles.map(profile => profile!.phone)).size !== 3) throw new SenderError("Participants must have distinct destinations")
    // Demo area center, not a precise sighting coordinate.
    const lat = 34.19, lng = -118.13
    const child = ctx.db.profile.insert({ id: 0n, name: intake.child.name, phone: "", lat, lng, contact_profile_ids: [reporter_profile_id, ...helper_profile_ids] })
    const description = `${intake.child.name} reported missing. Description: ${intake.child.description}. Last seen: ${intake.child.last_seen_location_id}, ${intake.child.last_seen_time}. Reporter: ${intake.reporter.name} (${intake.reporter.relationship}; self-reported).`
    const incident = ctx.db.incident.insert({ id: nextIncidentId(ctx), type: "point", description, area: { lat, lng, radius_m: 0 }, brief: "", status: ACTIVE, created_at: ctx.timestamp, ended_at: undefined })
    const current = ctx.db.supportCase.insert({ id: nextCaseId(ctx), incident_id: incident.id, victim_profile_id: child.id, goal: `Locate ${intake.child.name} and obtain parent confirmation of reunion`, brief: "", status: OPEN })
    ctx.db.caseIntake.insert({ support_case_id: current.id, reporter_profile_id, child_description: intake.child.description, last_seen_location_id: intake.child.last_seen_location_id, last_seen_time: intake.child.last_seen_time, reporter_name: intake.reporter.name, reporter_relationship: intake.reporter.relationship, reunion_confirmed: false, confirmed_at: undefined })
    ctx.db.caseProgress.insert({ support_case_id: current.id, helper_profile_ids, input_revision: 0n, evaluated_revision: 0n, failure_count: 0, retry_at_ms: undefined, blocked_reason: "" })
    note(ctx, current.id, `${profiles[0]!.name} (profile ${reporter_profile_id}; unverified intake): ${description}`)
    receipt(ctx, event_key, current.id, reporter_profile_id, "intake", payload)
    coordinationInput(ctx, current.id)
  },
)
export const recordCaseUpdate = spacetimedb.reducer(
  { event_key: t.string(), support_case_id: t.u64(), reporter_profile_id: t.u64(), text: t.string() },
  (ctx, { event_key, support_case_id, reporter_profile_id, text }) => {
    if (!text.trim()) throw new SenderError("Update text is required")
    const payload = JSON.stringify({ support_case_id: String(support_case_id), reporter_profile_id: String(reporter_profile_id), text })
    if (replay(ctx, event_key, "update", payload, support_case_id)) return
    const { reporter } = participant(ctx, support_case_id, reporter_profile_id)
    note(ctx, support_case_id, `${reporter.name} (profile ${reporter_profile_id}; unverified update): ${text}`)
    receipt(ctx, event_key, support_case_id, reporter_profile_id, "update", payload)
    coordinationInput(ctx, support_case_id)
  },
)
export const recordReunionConfirmation = spacetimedb.reducer(
  { event_key: t.string(), support_case_id: t.u64(), reporter_profile_id: t.u64(), child_identity_confirmed: t.bool(), reunited: t.bool(), text: t.string() },
  (ctx, { event_key, support_case_id, reporter_profile_id, child_identity_confirmed, reunited, text }) => {
    const payload = JSON.stringify({ support_case_id: String(support_case_id), reporter_profile_id: String(reporter_profile_id), child_identity_confirmed, reunited, text })
    if (replay(ctx, event_key, "reunion_confirmation", payload, support_case_id)) return
    const { current, intake, reporter } = participant(ctx, support_case_id, reporter_profile_id)
    if (intake.reporter_profile_id !== reporter_profile_id) throw new SenderError("Only the original reporter may confirm reunion")
    note(ctx, support_case_id, `${reporter.name} (profile ${reporter_profile_id}; self-reported confirmation): child identity confirmed=${child_identity_confirmed}, reunited=${reunited}. ${text}`)
    if (child_identity_confirmed && reunited) {
      ctx.db.supportCase.id.update({ ...current, status: CLOSED })
      if (!intake.reunion_confirmed) ctx.db.caseIntake.support_case_id.update({ ...intake, reunion_confirmed: true, confirmed_at: ctx.timestamp })
    }
    receipt(ctx, event_key, support_case_id, reporter_profile_id, "reunion_confirmation", payload)
    coordinationInput(ctx, support_case_id)
  },
)
