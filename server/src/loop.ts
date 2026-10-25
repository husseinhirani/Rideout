import {
  brief,
  interpretAnswer,
  interpretIncident,
  interpretCoordinationAnswer,
  plan,
  planStrict,
  type Brief,
  type IncidentSketch,
  type PlannedCall,
} from "./agent"
import { getCall, placeCall, placeCheckInCall } from "./cartesia"
import { createCoordinatorWorker, readStableCoordinationState, type CoordinationState } from "./coordinator-worker"
import {
  attempts,
  attemptProgress,
  caseProgress,
  caseIntakes,
  incomingRequests,
  callReducer,
  incidentPeople,
  incidents,
  notes,
  profiles,
  supportCases,
  type AttemptRow,
  type IncidentRow,
  type NoteRow,
  type ProfileRow,
  type SupportCaseRow,
} from "./db"
import { DEMO_LOCATIONS } from "../shared/locations"
import { createCaseFromIntake } from "./case-inputs"
import { ServiceError } from "./service"
import { recordingMode, scriptedPlan, scriptedInterpret, scriptedRidePlan } from "./recording-model"

// Legacy cases replan on dispatcher input. Opt-in coordinated cases instead use
// the durable worker below; both paths share dial() and the provider adapter.
// A report is evidence, not proof that the phone conversation has ended.

const NO_ANSWER_MS = 90_000
const E164 = /^\+[1-9]\d{1,14}$/
const PLACEHOLDER_PHONE_PREFIX = "+1555555"

const CHECKING_IN = "checking_in"
const SAFE = "safe"
const VICTIM = "victim"
const UNKNOWN = "unknown"
const ANSWERED = "answered"
const NO_ANSWER = "no_answer"
const CLOSED = "closed"
const CALL = "call"
const DISPATCHER = "dispatcher"
const CONCERN = "concern"

const EMPTY_BRIEF: Brief = { summary: "", suggestions: [] }

const automatic = () => process.env.AUTO_COORDINATE === "1"
async function readCoordinationState(): Promise<CoordinationState> {
  return readStableCoordinationState(caseProgress, async () => {
    const [cases, allIncidents, allProfiles, allAttempts, allNotes, attempt_progress, case_intakes] = await Promise.all([
      supportCases(), incidents(), profiles(), attempts(), notes(), attemptProgress(), caseIntakes(),
    ])
    return {cases,incidents:allIncidents,profiles:allProfiles,attempts:allAttempts,notes:allNotes,attempt_progress,case_intakes}
  })
}
const coordinationWorker = createCoordinatorWorker({
  read: readCoordinationState, reduce: callReducer,
  plan: input => recordingMode() ? scriptedPlan(input) : planStrict(input),
  interpret: input => recordingMode() ? scriptedInterpret(input) : interpretCoordinationAnswer(input),
  now: Date.now, inspect: getCall,
  dial: (attempt, profile, context, claimToken) => dial({attemptId:attempt.id,profile,ask:attempt.ask,context,claimToken}),
})
let coordinatorTimer: ReturnType<typeof setInterval> | undefined
export function startCoordinatorWorker(): void {
  if (!automatic() || coordinatorTimer) return
  coordinatorTimer = setInterval(() => background("coordinator scan", coordinationWorker.tick()), 1_000)
  coordinatorTimer.unref()
  background("coordinator startup", coordinationWorker.tick())
}

function configuredHelperIds(): number[] {
  const ids = (process.env.COORDINATOR_HELPER_IDS ?? "").split(",").map(value => Number(value.trim()))
  if (ids.length !== 2 || new Set(ids).size !== 2 || ids.some(id => !Number.isSafeInteger(id) || id <= 0)) {
    throw new Error("AUTO_COORDINATE requires COORDINATOR_HELPER_IDS with exactly two profile IDs")
  }
  return ids
}

// ------------------------------------------------------------------ reading

export async function getState(includeLegacyConfiguration = true): Promise<Record<string, unknown>> {
  const [allProfiles, allIncidents, people, cases, allAttempts, allNotes, coordination, attempt_progress, case_intakes, incoming_requests] = await Promise.all([
    profiles(),
    incidents(),
    incidentPeople(),
    supportCases(),
    attempts(),
    notes(),
    caseProgress(),
    attemptProgress(),
    caseIntakes(),
    incomingRequests(),
  ])
  return {
    simulate: process.env.SIMULATE === "1",
    demo_mode: {
      simulate: process.env.SIMULATE === "1", scripted: recordingMode(),
      auto_coordinate: automatic(), database: process.env.SPACETIMEDB_DATABASE ?? "sealert",
      helper_ids: includeLegacyConfiguration && automatic() ? configuredHelperIds() : [],
      reporter_id: includeLegacyConfiguration ? configuredReporterId() : null,
      inbound: process.env.INBOUND_REQUESTS === "1",
    },
    locations: includeLegacyConfiguration ? DEMO_LOCATIONS : [],
    profiles: allProfiles,
    incidents: allIncidents,
    incident_people: people,
    cases,
    attempts: allAttempts,
    notes: allNotes,
    coordination,
    attempt_progress,
    case_intakes,
    // Dispatcher view only. The caller-facing reply never carries case facts.
    incoming_requests,
  }
}

function configuredReporterId(): number | null {
  const id = Number(process.env.COORDINATOR_REPORTER_ID)
  return Number.isSafeInteger(id) && id > 0 ? id : null
}

// ------------------------------------------------------------------- intake

// The dispatcher's missing-child form. It goes through the same intake service
// as an inbound call, so the case gets the same receipt, intake row and
// parent-confirmed closure. The reporter is self-reported, never verified.
export async function openDispatcherIntake(input: {
  event_key: string
  reporter_profile_id: number | null
  intake: unknown
}): Promise<Awaited<ReturnType<typeof createCaseFromIntake>>> {
  if (!automatic()) throw new ServiceError(503, "Dispatcher intake requires AUTO_COORDINATE=1 with two configured helpers")
  const eventKey = input.event_key.trim()
  if (!/^[A-Za-z0-9-]{8,100}$/.test(eventKey)) throw new ServiceError(400, "event_key must be 8-100 letters, digits or dashes")
  const reporterProfileId = input.reporter_profile_id ?? configuredReporterId()
  if (reporterProfileId === null) throw new ServiceError(400, "Choose the reporter's profile")
  try {
    const result = await createCaseFromIntake(input.intake, {
      eventKey: "dispatcher:" + eventKey, reporterProfileId, helperProfileIds: configuredHelperIds(),
    })
    if (result.status === "recorded") background("intake plan", coordinationWorker.tick())
    return result
  } catch (error) {
    throw new ServiceError(409, "Intake was not recorded: " + errorMessage(error))
  }
}

// ---------------------------------------------------------------- incidents

export type OpenIncidentResult = {
  incident_id: number
  type: string
  description: string
  case_ids: number[]
}

export async function openIncidentFromText(text: string): Promise<OpenIncidentResult> {
  if (text.trim().length === 0) throw new ServiceError(400, "text is required")
  const allProfiles = await profiles()
  const sketch = await interpretIncident(
    {
      text,
      profiles: allProfiles.map((row) => ({ id: row.id, name: row.name, lat: row.lat, lng: row.lng })),
    },
    {
      type: "incident",
      lat: allProfiles[0]?.lat ?? 0,
      lng: allProfiles[0]?.lng ?? 0,
      radius_m: 0,
      victims: [],
    },
  )
  return openIncident({ ...sketch, description: text })
}

export function openIncidentStructured(input: {
  type: string
  lat: number
  lng: number
  radius_m: number
}): Promise<OpenIncidentResult> {
  if (input.type.trim().length === 0) throw new ServiceError(400, "type is required")
  return openIncident({ ...input, description: input.type, victims: [] })
}

async function openIncident(
  input: Omit<IncidentSketch, "radius_m"> & { description: string; radius_m: number },
): Promise<OpenIncidentResult> {
  if (!Number.isFinite(input.lat) || !Number.isFinite(input.lng)) {
    throw new ServiceError(400, "lat and lng are required")
  }
  const radius = Number.isFinite(input.radius_m) ? Math.max(0, input.radius_m) : 0
  const before = new Set((await incidents()).map((row) => row.id))
  await callReducer("createIncident", [input.type, input.description, input.lat, input.lng, radius])
  const created = (await incidents()).find((row) => !before.has(row.id))
  if (!created) throw new Error("createIncident did not insert an incident")

  const caseIds: number[] = []
  for (const victim of input.victims) {
    const profileId = await resolveVictim(victim)
    if (profileId === null) continue
    const caseId = await insertCase(created.id, profileId, victim.goal)
    if (caseId !== null) caseIds.push(caseId)
  }

  // Everything below here rings phones, so it runs after we answer the
  // dispatcher. The UI polls for the result.
  background("triage", triage(created))
  for (const caseId of caseIds) background("case " + String(caseId), startCase(caseId))
  return {
    incident_id: created.id,
    type: created.type,
    description: created.description,
    case_ids: caseIds,
  }
}

// A victim Claude could not match to a profile becomes a thin one: a name, a
// last known position, and no phone, so the radius sweep never picks her up and
// we never try to dial her.
async function resolveVictim(victim: IncidentSketch["victims"][number]): Promise<number | null> {
  const known = await profiles()
  if (victim.profile_id > 0 && known.some((row) => row.id === victim.profile_id)) {
    return victim.profile_id
  }
  if (victim.name.trim().length === 0) return null
  const before = new Set(known.map((row) => row.id))
  await callReducer("insertProfile", [victim.name, "", victim.lat, victim.lng, []])
  return (await profiles()).find((row) => !before.has(row.id))?.id ?? null
}

async function triage(incident: IncidentRow): Promise<void> {
  if (incident.area.radius_m <= 0) return
  const waiting = (await incidentPeople()).filter(
    (row) => row.incident_id === incident.id && row.status === CHECKING_IN,
  )
  if (waiting.length === 0) return
  const byId = new Map((await profiles()).map((row) => [row.id, row]))
  const hasCase = new Set(
    (await supportCases())
      .filter((row) => row.incident_id === incident.id)
      .map((row) => row.victim_profile_id),
  )
  await Promise.all(
    waiting.map(async (person) => {
      const profile = byId.get(person.profile_id)
      if (!profile || !isDialable(profile.phone) || hasCase.has(profile.id)) return
      try {
        await placeCheckInCall(profile.phone, {
          incident_id: String(incident.id),
          profile_id: String(profile.id),
          person_name: profile.name,
          // An empty attempt_id is how the in-call agent knows to report the
          // check-in rather than a case answer.
          attempt_id: "",
        })
        watchCheckIn(incident.id, profile.id)
      } catch (error) {
        console.error("check-in " + profile.name + ": " + errorMessage(error))
      }
    }),
  )
}

// Same deadline as a case call. Nobody answering is "unknown", which is
// neither safe nor cleared; a late answer still lands afterwards.
function watchCheckIn(incidentId: number, profileId: number): void {
  setTimeout(() => {
    background("check-in deadline " + String(profileId), (async () => {
      await callReducer("markCheckInUnanswered", [incidentId, profileId])
      await refreshIncidentBrief(incidentId)
    })())
  }, NO_ANSWER_MS).unref()
}

export async function onCheckIn(input: {
  incident_id: number
  profile_id: number
  result: string
}): Promise<{ result: string; support_case_id: number | null }> {
  if (input.result !== SAFE && input.result !== VICTIM) {
    throw new ServiceError(400, "result must be safe or victim")
  }
  await callReducer("recordCheckIn", [input.incident_id, input.profile_id, input.result])
  if (input.result !== VICTIM) {
    background("incident brief", refreshIncidentBrief(input.incident_id))
    return { result: SAFE, support_case_id: null }
  }
  const opened = (await supportCases()).find(
    (row) => row.incident_id === input.incident_id && row.victim_profile_id === input.profile_id,
  )
  if (!opened) throw new Error("recordCheckIn did not open a support case")
  // A ride case is not the missing-child scenario the coordinator is built for,
  // so it always uses the dispatcher-reviewed planner.
  background("case " + String(opened.id), startCase(opened.id, false))
  return { result: VICTIM, support_case_id: opened.id }
}

// -------------------------------------------------------------------- cases

export async function openCaseForVictim(input: {
  incident_id: number
  victim_profile_id: number
  goal: string
}): Promise<{ support_case_id: number }> {
  const goal = input.goal.trim()
  if (goal.length === 0) throw new ServiceError(400, "goal is required")
  const caseId = await insertCase(input.incident_id, input.victim_profile_id, goal)
  if (caseId === null) throw new ServiceError(400, "Case could not be opened")
  background("case " + String(caseId), startCase(caseId))
  return { support_case_id: caseId }
}

export async function onDispatcherInput(
  supportCaseId: number,
  text: string,
): Promise<{ support_case_id: number; planned: number; reason: string }> {
  if (text.trim().length === 0) throw new ServiceError(400, "text is required")
  await requireCase(supportCaseId)
  await callReducer("addNote", [supportCaseId, 0, DISPATCHER, text, false, 0, 0, 0])
  // runPlan writes the new attempt rows and hands the dialing to the
  // background, so the dispatcher sees the new trajectory without waiting on
  // any call that is still ringing.
  const planned = await runPlan(supportCaseId, text)
  background("brief " + String(supportCaseId), refreshBriefs(supportCaseId))
  return { support_case_id: supportCaseId, ...planned }
}

export async function closeCase(
  supportCaseId: number,
): Promise<{ support_case_id: number; status: string }> {
  const row = await requireCase(supportCaseId)
  await callReducer("setCaseStatus", [supportCaseId, CLOSED])
  background("incident brief", refreshIncidentBrief(row.incident_id))
  return { support_case_id: supportCaseId, status: CLOSED }
}

async function startCase(supportCaseId: number, coordinated = true): Promise<void> {
  if (coordinated && automatic()) {
    await callReducer("enableCoordination", [supportCaseId, configuredHelperIds()])
    startCoordinatorWorker()
  }
  await runPlan(supportCaseId, "")
  await refreshBriefs(supportCaseId)
}

async function insertCase(
  incidentId: number,
  victimProfileId: number,
  goal: string,
): Promise<number | null> {
  const before = new Set((await supportCases()).map((row) => row.id))
  await callReducer("openCase", [incidentId, victimProfileId, goal])
  const rows = await supportCases()
  const created = rows.find((row) => !before.has(row.id))
  if (created) return created.id
  // openCase returns silently when this victim already has a case.
  return (
    rows.find((row) => row.incident_id === incidentId && row.victim_profile_id === victimProfileId)
      ?.id ?? null
  )
}

async function requireCase(supportCaseId: number): Promise<SupportCaseRow> {
  const row = (await supportCases()).find((item) => item.id === supportCaseId)
  if (!row) throw new ServiceError(404, "Support case not found")
  return row
}

// The dispatcher stops a call that has not started, or a simulated one. A real
// call that may already be ringing is left alone: Sealert cannot hang it up.
export async function cancelCall(
  attemptId: number,
): Promise<{ attempt_id: number; cancelled: boolean; reason: string }> {
  const attempt = (await attempts()).find(row => row.id === attemptId)
  if (!attempt) throw new ServiceError(404, "Attempt not found")
  const progress = (await attemptProgress()).find(row => row.attempt_id === attemptId)
  const refusal = cancelRefusal(attempt, progress?.transport)
  if (refusal) return { attempt_id: attemptId, cancelled: false, reason: refusal }
  try {
    await callReducer("cancelAttempt", [attemptId])
  } catch (error) {
    // The worker can claim the call between our read and the reducer.
    return { attempt_id: attemptId, cancelled: false, reason: errorMessage(error) }
  }
  const simulated = attempt.call_id?.startsWith("sim_") === true
  return { attempt_id: attemptId, cancelled: true, reason: simulated ? "Simulated call ended." : "Call cancelled before dialing." }
}

export function cancelRefusal(attempt: AttemptRow, transport: string | undefined): string {
  const simulated = attempt.call_id?.startsWith("sim_") === true
  if (transport === undefined) {
    if (attempt.outcome != null) return "Call already has an outcome."
    return attempt.call_id && !simulated ? "A live call cannot be ended from Sealert." : ""
  }
  if (transport === "queued" || (transport === "active" && simulated)) return ""
  if (transport === "ended" || transport === "cancelled") return "Call already finished."
  if (transport === "dispatching") return "The call is being placed and cannot be cancelled safely."
  return "A live or unresolved call cannot be ended from Sealert."
}

// ----------------------------------------------------------------- profiles

export async function registerProfile(input: {
  name: string
  phone: string
  lat: number
  lng: number
  contact_profile_ids: number[]
}): Promise<{ profile_id: number }> {
  const name = input.name.trim()
  const phone = input.phone.trim()
  if (name.length === 0) throw new ServiceError(400, "name is required")
  if (phone && !E164.test(phone)) throw new ServiceError(400, "phone must be E.164, such as +14155550123, or empty")
  const known = await profiles()
  const missing = input.contact_profile_ids.find(id => !known.some(row => row.id === id))
  if (missing !== undefined) throw new ServiceError(400, "Contact profile " + String(missing) + " not found")
  const before = new Set(known.map(row => row.id))
  await callReducer("insertProfile", [name, phone, input.lat, input.lng, []])
  const created = (await profiles()).find(row => !before.has(row.id) && row.name === name && row.phone === phone && row.lat === input.lat && row.lng === input.lng)
  if (!created) throw new Error("insertProfile did not insert a profile")
  if (input.contact_profile_ids.length) await callReducer("setContacts", [created.id, input.contact_profile_ids])
  return { profile_id: created.id }
}

// ------------------------------------------------------------------ reports

export async function onReport(input: {
  attempt_id: number | null
  from_phone: string
  answer: string
  concern: string
}): Promise<{ support_case_id: number }> {
  if (input.answer.trim().length === 0) throw new ServiceError(400, "answer is required")
  if (input.attempt_id !== null) {
    const progress = (await attemptProgress()).find(row => row.attempt_id === input.attempt_id)
    if (progress) {
      const attempt = (await attempts()).find(row => row.id === input.attempt_id)
      if (!attempt) throw new ServiceError(404, "Attempt not found")
      if (progress.report_received && (attempt.answer !== input.answer || progress.raw_concern !== input.concern)) {
        throw new ServiceError(409, "A different final report already exists for this attempt")
      }
      try {
        await callReducer("receiveCoordinationReport", [input.attempt_id, input.answer, input.concern])
      } catch (error) {
        if (errorMessage(error).includes("different final report")) throw new ServiceError(409, "A different final report already exists for this attempt")
        throw error
      }
      // The scanner resumes processing even if Node stops immediately after ACK.
      // No Claude request or new call is awaited in this callback.
      return {support_case_id: progress.support_case_id}
    }
  }
  const target = await resolveReport(input)
  if (!target) throw new ServiceError(404, "No case matches this call")
  const { supportCaseId, attempt } = target
  if ((await caseProgress()).some(row => row.support_case_id === supportCaseId)) {
    throw new ServiceError(409, "Coordinated inbound updates need an explicitly matched case; inbound integration is pending")
  }
  const facts = await caseFacts(supportCaseId)
  const interpret = recordingMode() ? scriptedInterpret : interpretAnswer
  const learned = await interpret(
    {
      goal: facts.supportCase.goal,
      victim: facts.victim?.name ?? "",
      person: attempt ? (facts.profilesById.get(attempt.profile_id)?.name ?? "") : "someone who called in",
      ask: attempt?.ask ?? "",
      answer: input.answer,
      flagged_by_the_in_call_agent: input.concern,
      already_known: facts.caseNotes.map((row) => row.text),
    },
    {
      notes: [{ text: input.answer, has_place: false, lat: 0, lng: 0, radius_m: 0 }],
      concern: input.concern,
      reached: true,
    },
  )

  const attemptRef = attempt?.id ?? 0
  if (attempt) {
    await callReducer("recordAnswer", [
      attempt.id,
      learned.reached ? ANSWERED : NO_ANSWER,
      input.answer,
      learned.concern,
    ])
  }
  for (const note of learned.notes) {
    if (note.text.trim().length === 0) continue
    await callReducer("addNote", [
      supportCaseId,
      attemptRef,
      CALL,
      note.text,
      note.has_place,
      note.lat,
      note.lng,
      note.radius_m,
    ])
  }
  if (learned.concern.trim().length > 0) {
    await callReducer("addNote", [supportCaseId, attemptRef, CONCERN, learned.concern, false, 0, 0, 0])
  }
  background("brief " + String(supportCaseId), refreshBriefs(supportCaseId))
  return { support_case_id: supportCaseId }
}

async function resolveReport(input: {
  attempt_id: number | null
  from_phone: string
}): Promise<{ supportCaseId: number; attempt: AttemptRow | null } | null> {
  const rows = await attempts()
  if (input.attempt_id !== null) {
    const row = rows.find((item) => item.id === input.attempt_id)
    return row ? { supportCaseId: row.support_case_id, attempt: row } : null
  }
  // Someone calling in. Match them by number, newest open case first.
  const phone = input.from_phone.trim()
  if (phone.length === 0) return null
  const allProfiles = await profiles()
  const caller = allProfiles.find((row) => row.phone === phone)
  if (!caller) return null
  const ringing = rows.find((row) => row.profile_id === caller.id && row.outcome == null)
  if (ringing) return { supportCaseId: ringing.support_case_id, attempt: ringing }
  const byId = new Map(allProfiles.map((row) => [row.id, row]))
  const match = (await supportCases())
    .filter((row) => row.status !== CLOSED)
    .reverse()
    .find((row) => byId.get(row.victim_profile_id)?.contact_profile_ids.includes(caller.id) === true)
  return match ? { supportCaseId: match.id, attempt: null } : null
}

// ------------------------------------------------------------------ planning

type Pick = { profile: ProfileRow; ask: string; context: string }

async function runPlan(
  supportCaseId: number,
  instruction: string,
): Promise<{ planned: number; reason: string }> {
  if ((await caseProgress()).some(row => row.support_case_id === supportCaseId)) {
    if (automatic()) background("automatic plan", coordinationWorker.tick())
    return {planned: 0, reason: automatic() ? "Automatic coordination queued." : "Automatic coordination is paused."}
  }
  const facts = await caseFacts(supportCaseId)
  if (facts.supportCase.status === CLOSED) return { planned: 0, reason: "Case is closed." }
  if (facts.candidates.length === 0) {
    return { planned: 0, reason: "No one left to call on this case." }
  }
  const contacts = new Set(facts.victim?.contact_profile_ids ?? [])
  const result = await (recordingMode() ? scriptedRidePlan : plan)(
    {
      goal: facts.supportCase.goal,
      instruction,
      victim: { name: facts.victim?.name ?? "", lat: facts.victim?.lat, lng: facts.victim?.lng },
      incident: {
        type: facts.incident.type,
        description: facts.incident.description,
        radius_m: facts.incident.area.radius_m,
      },
      already_known: facts.caseNotes.map((row) => row.text),
      already_called: facts.caseAttempts.map((row) => ({
        person: facts.profilesById.get(row.profile_id)?.name ?? "",
        ask: row.ask,
        outcome: row.outcome ?? "ringing",
        answer: row.answer,
      })),
      candidates: facts.candidates.map((row) => ({
        profile_id: row.id,
        name: row.name,
        is_contact_of_the_victim: contacts.has(row.id),
      })),
    },
    {
      calls: [{ profile_id: facts.candidates[0].id, ask: facts.supportCase.goal, context: "" }],
      reason: "Claude was unavailable, so the first candidate was called.",
    },
  )

  const picks = choosePicks(result.calls, facts.candidates, facts.supportCase.goal)
  if (picks.length === 0) return { planned: 0, reason: result.reason }

  const before = new Set(facts.caseAttempts.map((row) => row.id))
  for (const pick of picks) {
    await callReducer("addAttempt", [supportCaseId, pick.profile.id, pick.ask])
  }
  const fresh = (await attempts()).filter(
    (row) => row.support_case_id === supportCaseId && !before.has(row.id),
  )
  const dials = picks.flatMap((pick) => {
    const row = fresh.find((item) => item.profile_id === pick.profile.id)
    return row ? [{ ...pick, attemptId: row.id }] : []
  })
  background("dial " + String(supportCaseId), Promise.all(dials.map((item) => dial(item))))
  return { planned: dials.length, reason: result.reason }
}

// An id Claude invented, or one it repeated, falls back to the next unused
// candidate in order. The loop keeps working when the API is down.
function choosePicks(calls: PlannedCall[], candidates: ProfileRow[], goal: string): Pick[] {
  const byId = new Map(candidates.map((row) => [row.id, row]))
  const used = new Set<number>()
  const picks: Pick[] = []
  for (const call of calls) {
    let target = byId.get(call.profile_id)
    if (!target || used.has(target.id)) target = candidates.find((row) => !used.has(row.id))
    if (!target) break
    used.add(target.id)
    const ask = call.ask.trim()
    picks.push({ profile: target, ask: ask.length > 0 ? ask : goal, context: call.context.trim() })
  }
  return picks
}

async function dial(item: Pick & { attemptId: number; claimToken?: string }): Promise<void> {
  if (item.claimToken) {
    let callId = ""
    try {
      if (!isDialable(item.profile.phone)) throw new Error("Destination is not dialable in this mode")
      callId = await placeCall(item.profile.phone, {
        attempt_id:String(item.attemptId),person_name:item.profile.name,ask:item.ask,context:item.context,
      })
      await callReducer("recordCoordinationDispatch", [item.attemptId,item.claimToken,callId,""])
    } catch (error) {
      // The provider may have accepted the request; preserve uncertainty and any
      // known call id instead of treating an exception as an unanswered call.
      await callReducer("recordCoordinationDispatch", [item.attemptId,item.claimToken,callId,errorMessage(error)])
    }
    return
  }
  try {
    const callId = await placeCall(item.profile.phone, {
      attempt_id: String(item.attemptId),
      person_name: item.profile.name,
      ask: item.ask,
      context: item.context,
    })
    await callReducer("setAttemptCall", [item.attemptId, callId])
    watchForNoAnswer(item.attemptId)
  } catch (error) {
    await callReducer("recordAnswer", [item.attemptId, NO_ANSWER, "", errorMessage(error)])
  }
}

// One deadline per call, set where we dial. Nothing polls, and nothing else
// waits on this call, so a missed answer costs one row and no state.
function watchForNoAnswer(attemptId: number): void {
  setTimeout(() => {
    background("deadline " + String(attemptId), expire(attemptId))
  }, NO_ANSWER_MS).unref()
}

async function expire(attemptId: number): Promise<void> {
  const row = (await attempts()).find((item) => item.id === attemptId)
  if (!row || row.outcome != null) return
  await callReducer("recordAnswer", [attemptId, NO_ANSWER, "", ""])
  await refreshBriefs(row.support_case_id)
}

// ------------------------------------------------------------------- briefs

async function refreshBriefs(supportCaseId: number): Promise<void> {
  if ((await caseProgress()).some(row => row.support_case_id === supportCaseId)) return
  const facts = await caseFacts(supportCaseId)
  if (recordingMode()) {
    // Same template coordinated cases use, so a scripted run makes no Claude call.
    const latest = facts.caseNotes.slice(-6).map(row => row.text)
    const summary = `${facts.supportCase.goal} Latest reports (not verified): ${latest.length ? latest.join("; ") : "None yet."}`
    await callReducer("setBrief", [supportCaseId, JSON.stringify({ summary, suggestions: [] })])
    return
  }
  const result = await brief(
    {
      scope: "one case",
      goal: facts.supportCase.goal,
      victim: facts.victim?.name ?? "",
      incident: { type: facts.incident.type, description: facts.incident.description },
      calls: facts.caseAttempts.map((row) => ({
        person: facts.profilesById.get(row.profile_id)?.name ?? "",
        ask: row.ask,
        outcome: row.outcome ?? "ringing",
        answer: row.answer,
      })),
      notes: facts.caseNotes.map((row) => ({
        source: row.source,
        text: row.text,
        place: row.lat == null ? null : { lat: row.lat, lng: row.lng, radius_m: row.radius_m },
      })),
    },
    EMPTY_BRIEF,
  )
  // An empty summary means the call failed. Keep the brief we already had.
  if (result.summary.trim().length > 0) {
    await callReducer("setBrief", [supportCaseId, JSON.stringify(result)])
  }
  await refreshIncidentBrief(facts.supportCase.incident_id)
}

async function refreshIncidentBrief(incidentId: number): Promise<void> {
  if (recordingMode()) return
  const incident = (await incidents()).find((row) => row.id === incidentId)
  if (!incident) return
  const cases = (await supportCases()).filter((row) => row.incident_id === incidentId)
  const coordinated = new Set((await caseProgress()).map(row => row.support_case_id))
  if (cases.some(row => coordinated.has(row.id))) return
  const people = (await incidentPeople()).filter((row) => row.incident_id === incidentId)
  const byId = new Map((await profiles()).map((row) => [row.id, row]))
  const result = await brief(
    {
      scope: "a whole incident, summarised for the dispatcher above the individual cases",
      incident: { type: incident.type, description: incident.description },
      triage: {
        safe: people.filter((row) => row.status === SAFE).length,
        still_checking_in: people.filter((row) => row.status === CHECKING_IN).length,
        no_answer: people.filter((row) => row.status === UNKNOWN).length,
        needs_help: people.filter((row) => row.status === VICTIM).length,
      },
      cases: cases.map((row) => ({
        person: byId.get(row.victim_profile_id)?.name ?? "",
        status: row.status,
        goal: row.goal,
        brief: summaryOf(row.brief),
      })),
    },
    EMPTY_BRIEF,
  )
  if (result.summary.trim().length === 0) return
  await callReducer("setIncidentBrief", [incidentId, JSON.stringify(result)])
}

function summaryOf(stored: string): string {
  if (stored.trim().length === 0) return ""
  try {
    const parsed = JSON.parse(stored) as { summary?: unknown }
    return typeof parsed.summary === "string" ? parsed.summary : stored
  } catch {
    return stored
  }
}

// ------------------------------------------------------------------- facts

type CaseFacts = {
  supportCase: SupportCaseRow
  incident: IncidentRow
  victim: ProfileRow | undefined
  caseAttempts: AttemptRow[]
  caseNotes: NoteRow[]
  profilesById: Map<number, ProfileRow>
  candidates: ProfileRow[]
}

async function caseFacts(supportCaseId: number): Promise<CaseFacts> {
  const supportCase = await requireCase(supportCaseId)
  const incident = (await incidents()).find((row) => row.id === supportCase.incident_id)
  if (!incident) throw new ServiceError(404, "Incident not found")
  const allProfiles = await profiles()
  const profilesById = new Map(allProfiles.map((row) => [row.id, row]))
  const victim = profilesById.get(supportCase.victim_profile_id)
  const caseAttempts = (await attempts()).filter((row) => row.support_case_id === supportCaseId)
  const caseNotes = (await notes()).filter((row) => row.support_case_id === supportCaseId)
  const people = (await incidentPeople()).filter((row) => row.incident_id === incident.id)
  return {
    supportCase,
    incident,
    victim,
    caseAttempts,
    caseNotes,
    profilesById,
    candidates: candidatesFor({
      victimProfileId: supportCase.victim_profile_id,
      contactProfileIds: victim?.contact_profile_ids ?? [],
      // A single-person incident sweeps nobody into incident_person, so the
      // pool is everyone we know. The dispatcher reviews every plan anyway.
      incidentProfileIds:
        people.length > 0 ? people.map((row) => row.profile_id) : allProfiles.map((row) => row.id),
      needsHelpProfileIds: people
        .filter((row) => row.status === VICTIM)
        .map((row) => row.profile_id),
      attemptedProfileIds: caseAttempts.map((row) => row.profile_id),
      profilesById,
    }),
  }
}

// The candidate list is code, not prompt. Claude picks from what this returns
// and writes the wording; it never widens the list.
export function candidatesFor(input: {
  victimProfileId: number
  contactProfileIds: number[]
  incidentProfileIds: number[]
  needsHelpProfileIds: number[]
  attemptedProfileIds: number[]
  profilesById: Map<number, ProfileRow>
}): ProfileRow[] {
  // Someone who needs help themselves is never asked to help with someone else.
  const excluded = new Set([input.victimProfileId, ...input.needsHelpProfileIds])
  const attempted = new Set(input.attemptedProfileIds)
  const seen = new Set<number>()
  const picked: ProfileRow[] = []
  // Contacts first: they are the people who actually know the victim.
  for (const id of [...input.contactProfileIds, ...input.incidentProfileIds]) {
    if (seen.has(id)) continue
    seen.add(id)
    if (excluded.has(id) || attempted.has(id)) continue
    const profile = input.profilesById.get(id)
    if (!profile || !isDialable(profile.phone)) continue
    picked.push(profile)
  }
  return picked
}

export function isDialable(phone: string): boolean {
  if (!E164.test(phone)) return false
  // The placeholder prefix exists to stop a real dial to a fake number.
  // Simulate mode never dials, so it is not a reason to leave someone out of
  // the call list.
  if (process.env.SIMULATE === "1") return true
  return !phone.startsWith(PLACEHOLDER_PHONE_PREFIX)
}

function background(label: string, work: Promise<unknown>): void {
  work.catch((error: unknown) => {
    console.error(label + ": " + errorMessage(error))
  })
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "failed"
}
