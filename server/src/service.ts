import { nextCandidate } from "./candidates"
import { placeCheckInCall, placeHelperCall } from "./cartesia"
import {
  attempts,
  callReducer,
  incidentPeople,
  incidents,
  profiles,
  supportCases,
  type ProfileRow,
} from "./db"

const SAFE = "safe"
const VICTIM = "victim"
const ACCEPTED = "accepted"
const DECLINED = "declined"
const NO_ANSWER = "no_answer"
const PLACEHOLDER_PHONE_PREFIX = "+1555555"
const E164 = /^\+[1-9]\d{1,14}$/

export class ServiceError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = "ServiceError"
    this.status = status
  }
}

export type OpenIncidentResult = {
  incident_id: number
  calls: { profile_id: number; call_id: string }[]
  skipped: { profile_id: number; phone: string }[]
  errors: { profile_id: number; error: string }[]
}

export async function openIncident(input: {
  type: string
  lat: number
  lng: number
  radius_m: number
}): Promise<OpenIncidentResult> {
  if (input.type.trim().length === 0) throw new ServiceError(400, "type is required")
  if (!Number.isFinite(input.lat) || !Number.isFinite(input.lng)) {
    throw new ServiceError(400, "lat and lng are required")
  }
  if (!Number.isFinite(input.radius_m) || input.radius_m <= 0) {
    throw new ServiceError(400, "radius_m must be greater than 0")
  }
  const before = new Set((await incidents()).map((row) => row.id))
  await callReducer("createIncident", [input.type, input.lat, input.lng, input.radius_m])
  const created = (await incidents()).find((row) => !before.has(row.id))
  if (!created) throw new Error("createIncident did not insert an incident")
  const people = (await incidentPeople()).filter((row) => row.incident_id === created.id)
  const byId = new Map((await profiles()).map((row) => [row.id, row]))
  const calls: OpenIncidentResult["calls"] = []
  const skipped: OpenIncidentResult["skipped"] = []
  const errors: OpenIncidentResult["errors"] = []
  for (const person of people) {
    const profile = byId.get(person.profile_id)
    if (!profile) {
      errors.push({ profile_id: person.profile_id, error: "Profile not found" })
      continue
    }
    if (!isDialable(profile.phone)) {
      skipped.push({ profile_id: profile.id, phone: profile.phone })
      continue
    }
    try {
      const callId = await placeCheckInCall(profile.phone, {
        incident_id: String(created.id),
        profile_id: String(profile.id),
      })
      calls.push({ profile_id: profile.id, call_id: callId })
    } catch (error) {
      errors.push({ profile_id: profile.id, error: errorMessage(error) })
    }
  }
  return { incident_id: created.id, calls, skipped, errors }
}

export async function recordCheckInResult(input: {
  incident_id: number
  profile_id: number
  result: string
}): Promise<{ result: string; support_case_id: number | null; helper_call_id: string | null; helper_error: string | null }> {
  if (input.result !== SAFE && input.result !== VICTIM) {
    throw new ServiceError(400, "result must be safe or victim")
  }
  await callReducer("recordCheckIn", [input.incident_id, input.profile_id, input.result])
  if (input.result !== VICTIM) {
    return { result: SAFE, support_case_id: null, helper_call_id: null, helper_error: null }
  }
  const supportCase = (await supportCases()).find(
    (row) => row.incident_id === input.incident_id && row.victim_profile_id === input.profile_id,
  )
  if (!supportCase) throw new Error("recordCheckIn did not open a support case")
  const helper = await placeNextHelper(supportCase.id)
  return {
    result: VICTIM,
    support_case_id: supportCase.id,
    helper_call_id: helper.callId,
    helper_error: helper.error,
  }
}

export async function recordHelperAnswer(input: {
  support_case_id: number
  profile_id: number
  outcome: string
}): Promise<{ outcome: string; helper_call_id: string | null; helper_error: string | null }> {
  if (input.outcome !== ACCEPTED && input.outcome !== DECLINED) {
    throw new ServiceError(400, "outcome must be accepted or declined")
  }
  await callReducer("recordAttempt", [input.support_case_id, input.profile_id, input.outcome])
  if (input.outcome === ACCEPTED) {
    return { outcome: ACCEPTED, helper_call_id: null, helper_error: null }
  }
  const helper = await placeNextHelper(input.support_case_id)
  return { outcome: DECLINED, helper_call_id: helper.callId, helper_error: helper.error }
}

export async function placeNextHelper(supportCaseId: number): Promise<{ callId: string | null; error: string | null }> {
  const supportCase = (await supportCases()).find((row) => row.id === supportCaseId)
  if (!supportCase) throw new ServiceError(404, "Support case not found")
  if (supportCase.status === ACCEPTED) return { callId: null, error: null }
  const open = (await attempts()).some(
    (row) => row.support_case_id === supportCaseId && row.outcome == null,
  )
  if (open) return { callId: null, error: "Support case already has an open attempt" }
  const people = await incidentPeople()
  const safeProfileIds = people
    .filter((row) => row.incident_id === supportCase.incident_id && row.status === SAFE)
    .map((row) => row.profile_id)
  const byId = new Map((await profiles()).map((row) => [row.id, row]))
  const victim = byId.get(supportCase.victim_profile_id)
  const dialableSafe = safeProfileIds.filter((id) => {
    const profile = byId.get(id)
    return profile !== undefined && isDialable(profile.phone)
  })
  const attemptedProfileIds = (await attempts())
    .filter((row) => row.support_case_id === supportCaseId)
    .map((row) => row.profile_id)
  const profileId = nextCandidate({
    victimProfileId: supportCase.victim_profile_id,
    contactProfileIds: victim?.contact_profile_ids ?? [],
    safeProfileIds: dialableSafe,
    attemptedProfileIds,
  })
  if (profileId === null) return { callId: null, error: null }
  const candidate = byId.get(profileId) as ProfileRow
  await callReducer("recordAttempt", [supportCaseId, profileId, ""])
  try {
    const callId = await placeHelperCall(candidate.phone, {
      incident_id: String(supportCase.incident_id),
      profile_id: String(profileId),
      support_case_id: String(supportCaseId),
      victim_profile_id: String(supportCase.victim_profile_id),
    })
    await callReducer("setCallId", [supportCaseId, callId])
    return { callId, error: null }
  } catch (error) {
    await callReducer("recordAttempt", [supportCaseId, profileId, NO_ANSWER])
    return { callId: null, error: errorMessage(error) }
  }
}

function isDialable(phone: string): boolean {
  return E164.test(phone) && !phone.startsWith(PLACEHOLDER_PHONE_PREFIX)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Call could not start"
}
