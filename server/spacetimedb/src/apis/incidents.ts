import { nextIncidentId, nextCaseId } from "../ids"
import { t } from "spacetimedb/server"
import spacetimedb, { CHECKING_IN, OPEN, SAFE, VICTIM, ACTIVE } from "../models"

const EARTH_RADIUS_M = 6_371_000

export const createIncident = spacetimedb.reducer(
  { type: t.string(), description: t.string(), lat: t.f64(), lng: t.f64(), radius_m: t.f64() },
  (ctx, { type, description, lat, lng, radius_m }) => {
    // radius 0 is a single-person incident, such as one missing child.
    if (radius_m < 0) throw new Error("radius_m must not be negative")
    const created = ctx.db.incident.insert({
      id: nextIncidentId(ctx),
      type,
      description,
      area: { lat, lng, radius_m },
      brief: "",
      status: ACTIVE,
      created_at: ctx.timestamp,
      ended_at: undefined,
    })
    for (const person of ctx.db.profile.iter()) {
      // A profile with no phone is someone we never call, such as a missing
      // child. Sweeping them in would leave them checking_in forever.
      if (person.phone.trim().length === 0) continue
      if (distanceM(lat, lng, person.lat, person.lng) <= radius_m) {
        ctx.db.incidentPerson.insert({
          id: 0n,
          incident_id: created.id,
          profile_id: person.id,
          status: CHECKING_IN,
        })
      }
    }
  },
)

export const recordCheckIn = spacetimedb.reducer(
  { incident_id: t.u64(), profile_id: t.u64(), result: t.string() },
  (ctx, { incident_id, profile_id, result }) => {
    if (result !== SAFE && result !== VICTIM) throw new Error("result must be safe or victim")
    const person = [...ctx.db.incidentPerson.incident_id.filter(incident_id)].find(
      (row) => row.profile_id === profile_id,
    )
    if (!person) throw new Error("Profile is not on this incident")
    if (person.status !== CHECKING_IN) throw new Error("Check-in is already recorded")
    ctx.db.incidentPerson.id.update({ ...person, status: result })
    if (result !== VICTIM) return
    const existing = [...ctx.db.supportCase.incident_id.filter(incident_id)].some(
      (row) => row.victim_profile_id === profile_id,
    )
    if (existing) return
    ctx.db.supportCase.insert({
      id: nextCaseId(ctx),
      incident_id,
      victim_profile_id: profile_id,
      goal: "Find someone who can get this person out, and keep them informed.",
      brief: "",
      status: OPEN,
    })
  },
)

function distanceM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (degrees: number) => (degrees * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)))
}

export const setIncidentBrief = spacetimedb.reducer(
  { incident_id: t.u64(), brief: t.string() },
  (ctx, { incident_id, brief }) => {
    if ([...ctx.db.supportCase.incident_id.filter(incident_id)].some(row => ctx.db.caseProgress.support_case_id.find(row.id))) return
    const current = ctx.db.incident.id.find(incident_id)
    if (!current) throw new Error("Incident not found")
    ctx.db.incident.id.update({ ...current, brief })
  },
)
