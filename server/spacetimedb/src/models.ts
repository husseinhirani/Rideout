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

const spacetimedb = schema({ profile, incident, incidentPerson, supportCase, attempt, note })
export default spacetimedb
