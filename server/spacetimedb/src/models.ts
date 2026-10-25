import { schema, table, t } from "spacetimedb/server"

export const CHECKING_IN = "checking_in"
export const SAFE = "safe"
export const VICTIM = "victim"
export const ACTIVE = "active"

export const OPEN = "open"
export const NEEDS_DISPATCHER = "needs_dispatcher"
export const CLOSED = "closed"

export const ANSWERED = "answered"
export const NO_ANSWER = "no_answer"
export const SUPERSEDED = "superseded"

export const CALL = "call"
export const DISPATCHER = "dispatcher"
export const CONCERN = "concern"

const Area = t.object("Area", {
  lat: t.f64(),
  lng: t.f64(),
  radius_m: t.f64(),
})

const profile = table(
  { name: "profile", public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    name: t.string(),
    phone: t.string(),
    lat: t.f64(),
    lng: t.f64(),
    contact_profile_ids: t.array(t.u64()),
  },
)

const incident = table(
  { name: "incident", public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    type: t.string(),
    description: t.string(),
    area: Area,
    brief: t.string(),
    status: t.string(),
    created_at: t.timestamp(),
    ended_at: t.option(t.timestamp()),
  },
)

const incidentPerson = table(
  { name: "incident_person", public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    incident_id: t.u64().index("btree"),
    profile_id: t.u64().index("btree"),
    status: t.string(),
  },
)

const supportCase = table(
  { name: "support_case", public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    incident_id: t.u64().index("btree"),
    victim_profile_id: t.u64().index("btree"),
    goal: t.string(),
    brief: t.string(),
    status: t.string(),
  },
)

const attempt = table(
  { name: "attempt", public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    support_case_id: t.u64().index("btree"),
    profile_id: t.u64(),
    ask: t.string(),
    call_id: t.option(t.string()),
    outcome: t.option(t.string()),
    answer: t.string(),
    concern: t.string(),
    created_at: t.timestamp(),
  },
)

const note = table(
  { name: "note", public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    support_case_id: t.u64().index("btree"),
    attempt_id: t.option(t.u64()),
    source: t.string(),
    text: t.string(),
    lat: t.option(t.f64()),
    lng: t.option(t.f64()),
    radius_m: t.option(t.f64()),
    at: t.timestamp(),
  },
)

const caseProgress = table(
  { name: "case_progress", public: true },
  {
    support_case_id: t.u64().primaryKey(),
    helper_profile_ids: t.array(t.u64()),
    input_revision: t.u64(),
    evaluated_revision: t.u64(),
    failure_count: t.u8(),
    retry_at_ms: t.option(t.f64()),
    blocked_reason: t.string(),
  },
)

const attemptProgress = table(
  { name: "attempt_progress", public: true },
  {
    attempt_id: t.u64().primaryKey(),
    support_case_id: t.u64().index("btree"),
    context: t.string(),
    transport: t.string(),
    claim_token: t.string(),
    dispatch_error: t.string(),
    claimed_at_ms: t.option(t.f64()),
    report_received: t.bool(),
    report_processed: t.bool(),
    raw_concern: t.string(),
    report_received_at_ms: t.option(t.f64()),
    accepted_at_ms: t.option(t.f64()),
    review_consumed: t.bool(),
  },
)

const caseIntake = table(
  { name: "case_intake", public: true },
  {
    support_case_id: t.u64().primaryKey(),
    reporter_profile_id: t.u64(),
    child_description: t.string(),
    last_seen_location_id: t.string(),
    last_seen_time: t.string(),
    reporter_name: t.string(),
    reporter_relationship: t.string(),
    reunion_confirmed: t.bool(),
    confirmed_at: t.option(t.timestamp()),
  },
)

const caseInput = table(
  { name: "case_input", public: true },
  {
    event_key: t.string().primaryKey(),
    support_case_id: t.u64().index("btree"),
    reporter_profile_id: t.u64(),
    kind: t.string(),
    payload: t.string(),
    received_at: t.timestamp(),
  },
)

const incomingRequest = table(
  { name: "incoming_request", public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    provider_call_id: t.string().unique(),
    from_phone: t.string(),
    direction: t.string(),
    text: t.string(),
    revision: t.u64(),
    status: t.string(),
    decision_json: t.string(),
    reply: t.string(),
    support_case_id: t.option(t.u64()),
    failure_count: t.u32(),
    retry_at_ms: t.u64(),
  },
)

const spacetimedb = schema({ profile, incident, incidentPerson, supportCase, attempt, note, caseProgress, attemptProgress, caseIntake, caseInput, incomingRequest })
export default spacetimedb
