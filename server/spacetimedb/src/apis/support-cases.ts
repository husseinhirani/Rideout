import { t } from "spacetimedb/server"
import spacetimedb, {
  ANSWERED,
  CALL,
  CLOSED,
  CONCERN,
  DISPATCHER,
  NEEDS_DISPATCHER,
  NO_ANSWER,
  OPEN,
  SUPERSEDED,
} from "../models"

const CASE_STATUS = [OPEN, NEEDS_DISPATCHER, CLOSED]
const OUTCOMES = [ANSWERED, NO_ANSWER, SUPERSEDED]
const SOURCES = [CALL, DISPATCHER, CONCERN]

export const openCase = spacetimedb.reducer(
  { incident_id: t.u64(), victim_profile_id: t.u64(), goal: t.string() },
  (ctx, { incident_id, victim_profile_id, goal }) => {
    if (!ctx.db.incident.id.find(incident_id)) throw new Error("Incident not found")
    if (!ctx.db.profile.id.find(victim_profile_id)) throw new Error("Profile not found")
    const existing = [...ctx.db.supportCase.incident_id.filter(incident_id)].some(
      (row) => row.victim_profile_id === victim_profile_id,
    )
    if (existing) return
    ctx.db.supportCase.insert({
      id: 0n,
      incident_id,
      victim_profile_id,
      goal,
      brief: "",
      status: OPEN,
    })
  },
)

export const addAttempt = spacetimedb.reducer(
  { support_case_id: t.u64(), profile_id: t.u64(), ask: t.string() },
  (ctx, { support_case_id, profile_id, ask }) => {
    const current = ctx.db.supportCase.id.find(support_case_id)
    if (!current) throw new Error("Support case not found")
    if (current.status === CLOSED) throw new Error("Support case is closed")
    if (!ctx.db.profile.id.find(profile_id)) throw new Error("Profile not found")
    ctx.db.attempt.insert({
      id: 0n,
      support_case_id,
      profile_id,
      ask,
      call_id: undefined,
      outcome: undefined,
      answer: "",
      concern: "",
      created_at: ctx.timestamp,
    })
  },
)

export const setAttemptCall = spacetimedb.reducer(
  { attempt_id: t.u64(), call_id: t.string() },
  (ctx, { attempt_id, call_id }) => {
    const current = ctx.db.attempt.id.find(attempt_id)
    if (!current) throw new Error("Attempt not found")
    ctx.db.attempt.id.update({
      ...current,
      call_id: call_id.length === 0 ? undefined : call_id,
    })
  },
)

export const recordAnswer = spacetimedb.reducer(
  { attempt_id: t.u64(), outcome: t.string(), answer: t.string(), concern: t.string() },
  (ctx, { attempt_id, outcome, answer, concern }) => {
    if (!OUTCOMES.includes(outcome)) {
      throw new Error("outcome must be answered, no_answer, or superseded")
    }
    const current = ctx.db.attempt.id.find(attempt_id)
    if (!current) throw new Error("Attempt not found")
    // A real answer is never overwritten. Anything else may be, so a late report
    // still lands after the deadline already wrote no_answer.
    if (current.outcome === ANSWERED) return
    ctx.db.attempt.id.update({ ...current, outcome, answer, concern })
  },
)

export const addNote = spacetimedb.reducer(
  {
    support_case_id: t.u64(),
    attempt_id: t.u64(),
    source: t.string(),
    text: t.string(),
    has_place: t.bool(),
    lat: t.f64(),
    lng: t.f64(),
    radius_m: t.f64(),
  },
  (ctx, { support_case_id, attempt_id, source, text, has_place, lat, lng, radius_m }) => {
    if (!SOURCES.includes(source)) throw new Error("source must be call, dispatcher, or concern")
    if (text.trim().length === 0) throw new Error("text is required")
    if (!ctx.db.supportCase.id.find(support_case_id)) throw new Error("Support case not found")
    // attempt_id 0 means the note did not come from a call. Ids start at 1.
    if (attempt_id !== 0n && !ctx.db.attempt.id.find(attempt_id)) {
      throw new Error("Attempt not found")
    }
    ctx.db.note.insert({
      id: 0n,
      support_case_id,
      attempt_id: attempt_id === 0n ? undefined : attempt_id,
      source,
      text,
      lat: has_place ? lat : undefined,
      lng: has_place ? lng : undefined,
      radius_m: has_place ? radius_m : undefined,
      at: ctx.timestamp,
    })
  },
)

export const setBrief = spacetimedb.reducer(
  { support_case_id: t.u64(), brief: t.string() },
  (ctx, { support_case_id, brief }) => {
    const current = ctx.db.supportCase.id.find(support_case_id)
    if (!current) throw new Error("Support case not found")
    ctx.db.supportCase.id.update({ ...current, brief })
  },
)

export const setCaseStatus = spacetimedb.reducer(
  { support_case_id: t.u64(), status: t.string() },
  (ctx, { support_case_id, status }) => {
    if (!CASE_STATUS.includes(status)) {
      throw new Error("status must be open, needs_dispatcher, or closed")
    }
    const current = ctx.db.supportCase.id.find(support_case_id)
    if (!current) throw new Error("Support case not found")
    ctx.db.supportCase.id.update({ ...current, status })
  },
)
