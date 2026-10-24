import { schema, table, t } from "spacetimedb/server"

export const CHECKING_IN = "checking_in"
export const SAFE = "safe"
export const VICTIM = "victim"
export const ACTIVE = "active"
export const OPEN = "open"
export const CONTACTING = "contacting"
export const ACCEPTED = "accepted"
export const DECLINED = "declined"
export const NO_ANSWER = "no_answer"

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
    area: Area,
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
    helper_profile_id: t.option(t.u64()),
    call_id: t.option(t.string()),
    status: t.string(),
  },
)

const attempt = table(
  { name: "attempt", public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    support_case_id: t.u64().index("btree"),
    profile_id: t.u64(),
    outcome: t.option(t.string()),
  },
)

const spacetimedb = schema({ profile, incident, incidentPerson, supportCase, attempt })
export default spacetimedb
