import type { AttemptProgressRow, AttemptRow, BackendState, CaseIntakeRow, IncidentRow, IncomingRequestRow, NoteRow, ProfileRow, SupportCaseRow, Transport } from "./api";
import type { CallCard, House, HouseStatus, Sighting } from "./types";

/**
 * Pure adapters from GET /state to what the views draw. No timers and no local
 * timeline: everything here is a function of the latest backend snapshot.
 * The wording follows the backend's display rules: an answered report is not an
 * ended call, "not seen" is not a cleared area, a possible match is not a
 * confirmed identity, and only the original reporter's confirmation is a reunion.
 */


export type Brief = { summary: string; suggestions: string[] };

export function briefOf(stored: string): Brief {
  if (!stored.trim()) return { summary: "", suggestions: [] };
  try {
    const parsed = JSON.parse(stored) as { summary?: unknown; suggestions?: unknown };
    return {
      summary: typeof parsed.summary === "string" ? parsed.summary : "",
      suggestions: Array.isArray(parsed.suggestions) ? parsed.suggestions.filter((item): item is string => typeof item === "string") : [],
    };
  } catch {
    return { summary: stored, suggestions: [] };
  }
}

const TRANSPORT: Record<Transport, string> = {
  queued: "Queued",
  dispatching: "Placing call",
  active: "Active",
  ended: "Ended",
  unknown: "Unknown · unresolved, not safe to retry",
  cancelled: "Cancelled",
};

export function transportLabel(transport: Transport | undefined): string {
  return transport ? TRANSPORT[transport] ?? transport : "Not tracked";
}

export function reportLabel(progress: AttemptProgressRow | undefined, attempt: AttemptRow): string {
  if (progress) {
    if (progress.report_processed) return progress.accepted_at_ms !== null ? "Report processed · accepted" : "Report processed";
    if (progress.report_received) return "Report saved · processing";
    return "No report yet";
  }
  if (attempt.outcome === "answered") return "Report processed";
  if (attempt.outcome === "no_answer") return "No answer";
  if (attempt.outcome === "cancelled") return "Cancelled";
  if (attempt.outcome === "superseded") return "Superseded";
  return "No report yet";
}

// A due review lets the coordinator reconsider; it does not promise another call.
export function followUpAt(progress: AttemptProgressRow | undefined): number | null {
  return null; // No persisted review deadline is exposed by this backend.
}

export function isPossibleMatch(text: string): boolean {
  return /possible (find|match)/i.test(text);
}

/** The case the dashboard follows: the chosen one, else the newest open, else the newest. */
export function currentCase(state: BackendState, chosenId: number | null): SupportCaseRow | null {
  if (chosenId === 0) return null; // Explicit idle view; history remains selectable.
  const chosen = chosenId === null ? undefined : state.cases.find((row) => row.id === chosenId);
  if (chosen) return chosen;
  const newest = [...state.cases].sort((a, b) => b.id - a.id);
  return newest.find((row) => row.status !== "closed") ?? newest[0] ?? null;
}

export function intakeOf(state: BackendState, caseId: number): CaseIntakeRow | null {
  return state.case_intakes?.find((row) => row.support_case_id === caseId) ?? null;
}

export type CaseStatus = { label: string; tone: "open" | "reunion" | "closed"; reunionAt: string | null };

export function caseStatus(row: SupportCaseRow, intake: CaseIntakeRow | null): CaseStatus {
  if (row.kind === "information") return { label: row.status === "closed" ? "Closed by organizer" : row.policy?.paused ? "Paused" : "Open", tone: row.status === "closed" ? "closed" : "open", reunionAt: null };
  if (intake?.reunion_confirmed) {
    return { label: "Reunion reported by original reporter · self-reported, not verified", tone: "reunion", reunionAt: intake.confirmed_at };
  }
  if (row.status === "closed") return { label: "Closed manually · reunion not confirmed", tone: "closed", reunionAt: null };
  if (row.status === "needs_dispatcher") return { label: "Needs dispatcher", tone: "open", reunionAt: null };
  return { label: "Open", tone: "open", reunionAt: null };
}

export type Coordination = { kind: "none" | "idle" | "pending" | "blocked" | "retrying"; text: string };

export function coordinationOf(state: BackendState, caseId: number, now: number): Coordination {
  if (state.cases.find((row) => row.id === caseId)?.status === "closed") return { kind: "idle", text: "Case closed. No further calls are planned." };
  const information = state.cases.find(row => row.id === caseId && row.kind === "information");
  if (information) {
    const planning = state.information_planning?.find(p => p.support_case_id === caseId);
    if (information.policy?.paused) return { kind: "blocked", text: "Paused; organizer action is required." };
    if (!planning?.enabled) return { kind: "idle", text: "Manual questions. The organizer chooses each call." };
    if (planning.blocked_reason) return { kind: "blocked", text: planning.blocked_reason };
    if (planning.error) return { kind: "retrying", text: `Planning failed: ${planning.error}${planning.retry_at_ms ? ` · retry eligible ${new Date(planning.retry_at_ms).toLocaleTimeString()}` : " · organizer action needed"}` };
    if (information.input_revision !== information.evaluated_revision) return { kind: "pending", text: "New information awaits a coordinator decision." };
    return { kind: "idle", text: "Current decision includes the evaluated evidence." };
  }
  const progress = state.coordination.find((row) => row.support_case_id === caseId);
  if (!progress) return { kind: "none", text: "Planned by the dispatcher-reviewed planner." };
  if (progress.blocked_reason) return { kind: "blocked", text: `Blocked: ${progress.blocked_reason}` };
  if (progress.retry_at_ms !== null && progress.retry_at_ms > now) return { kind: "retrying", text: "Planning failed; retrying shortly." };
  if (progress.input_revision !== progress.evaluated_revision) return { kind: "pending", text: "New information is waiting to be planned." };
  return { kind: "idle", text: "Up to date with every report." };
}

export type LiveCall = {
  attempt: AttemptRow;
  progress: AttemptProgressRow | undefined;
  person: ProfileRow | undefined;
  transport: Transport | undefined;
  transportLabel: string;
  reportLabel: string;
  followUpAt: number | null;
  simulated: boolean;
};

export function notReached(call: LiveCall): boolean {
  return ["no_answer", "not_reached"].includes(call.attempt.outcome ?? "");
}

/** The contact outcome is distinct from the provider connection ending. */
export function callStatusLabel(call: LiveCall): string {
  if (["queued", "dispatching", "active", "unknown"].includes(call.transport ?? "")) return call.transportLabel;
  return notReached(call) ? "Not reached" : call.transportLabel;
}

export type FollowUp = { call: LiveCall; reason: string; retrying: boolean };

/** Rebuilt from durable records, including after a page refresh. One item per case/person. */
export function followUps(state: BackendState): FollowUp[] {
  const openCases = new Set(state.cases.filter(row => row.status !== "closed").map(row => row.id));
  const groups = new Map<string, LiveCall[]>();
  for (const call of callsFor(state, null)) {
    if (!openCases.has(call.attempt.support_case_id) || call.transport === "cancelled"
      || ["cancelled", "superseded"].includes(call.attempt.outcome ?? "")) continue;
    const key = `${call.attempt.support_case_id}:${call.attempt.profile_id}`;
    groups.set(key, [...(groups.get(key) ?? []), call]);
  }
  return [...groups.values()].flatMap(group => {
    group.sort((a, b) => b.attempt.id - a.attempt.id);
    const latest = group[0];
    const retrying = ["queued", "dispatching", "active"].includes(latest.transport ?? "");
    // Starting a retry does not resolve a previous unsuccessful contact.
    const call = group.find(item => !["queued", "dispatching", "active"].includes(item.transport ?? ""));
    if (!call) return [];
    const reason = call.transport === "unknown" ? "Call status is unconfirmed. Review it before attempting another call."
      : notReached(call) ? "Not reached. Their situation is still unknown; another contact method or follow-up is needed."
      : call.attempt.concern || (call.transport === "ended" && !call.progress?.report_received && !call.attempt.answer
        ? "The call ended without a report. Their situation is still unknown." : "");
    return reason ? [{ call, reason, retrying }] : [];
  }).sort((a, b) => b.call.attempt.id - a.call.attempt.id);
}

export function callsFor(state: BackendState, caseId: number | null): LiveCall[] {
  return state.attempts
    .filter((row) => caseId === null || row.support_case_id === caseId)
    .sort((a, b) => a.id - b.id)
    .map((attempt) => {
      const progress = state.attempt_progress.find((row) => row.attempt_id === attempt.id);
      return {
        attempt,
        progress,
        person: state.profiles.find((row) => row.id === attempt.profile_id),
        transport: progress?.transport,
        transportLabel: progress ? transportLabel(progress.transport) : legacyTransport(attempt),
        reportLabel: reportLabel(progress, attempt),
        followUpAt: followUpAt(progress),
        simulated: attempt.call_id?.startsWith("sim_") === true || state.assistance_sessions?.some(session => session.case_id === attempt.support_case_id && session.people.some(person => person.profile_id === attempt.profile_id && person.mode === "simulated")) === true,
      };
    });
}

// Legacy (ride) attempts have no transport row; only say what the row proves.
function legacyTransport(attempt: AttemptRow): string {
  if (attempt.outcome === "cancelled") return "Cancelled";
  if (attempt.outcome !== null) return "Finished";
  return attempt.call_id ? "Dialed" : "Not dialed yet";
}

/** Whether the dispatcher may try to cancel; the backend still decides. */
export function cancellable(call: LiveCall): boolean {
  if (call.progress) return call.transport === "queued" || (call.transport === "active" && call.simulated);
  return call.attempt.outcome === null && (!call.attempt.call_id || call.simulated);
}

/** A simulated call still waiting for the helper's report, which the simulation box supplies. */
export function awaitingSimulatedReport(call: LiveCall): boolean {
  if (!call.simulated) return false;
  if (call.progress) return !call.progress.report_received && (call.transport === "active" || call.transport === "unknown");
  return call.attempt.outcome === null;
}

export type NoteView = { note: NoteRow; kind: "report" | "concern" | "dispatcher" | "possible"; label: string };

export function notesFor(state: BackendState, caseId: number): NoteView[] {
  return state.notes
    .filter((row) => row.support_case_id === caseId)
    .sort((a, b) => a.id - b.id)
    .map((note) => {
      if (note.source === "concern") return { note, kind: "concern", label: "Concern flagged" };
      if (note.source === "dispatcher") return { note, kind: "dispatcher", label: "Dispatcher input" };
      if (isPossibleMatch(note.text)) return { note, kind: "possible", label: "Possible match · unconfirmed" };
      return { note, kind: "report", label: "Report · not verified" };
    });
}

export function latestIncident(state: BackendState, sweepOnly: boolean): IncidentRow | null {
  return [...state.incidents].sort((a, b) => b.id - a.id).find((row) => !sweepOnly || (row.area?.radius_m ?? 0) > 0) ?? null;
}

type Point = { id: number; lng: number; lat: number };

/** Registered residents keep the footprint the offline map gives them; anyone else takes the nearest free one. */
export function housesFrom(state: BackendState, residents: House[], footprints: Point[], bounds: { south: number; north: number; west: number; east: number }): House[] {
  if (state.read_model_version === 2) return state.profiles
    .filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lng) && p.lat >= bounds.south && p.lat <= bounds.north && p.lng >= bounds.west && p.lng <= bounds.east)
    .map(p => ({ id: p.id, name: p.name, lat: p.lat, lng: p.lng, status: "waiting" as const, note: "Stored directory coordinate; current whereabouts unverified." }));
  const sweep = latestIncident(state, true);
  const people = sweep ? state.incident_people.filter((row) => row.incident_id === sweep.id) : [];
  const used = new Set<number>();
  const houses: House[] = [];
  for (const profile of state.profiles) {
    // A profile with no phone is someone RideOut never calls, such as the missing child.
    if (!profile.phone) continue;
    const resident = residents.find((row) => row.name === profile.name);
    const spot = resident && !used.has(resident.id) ? resident : nearest(footprints, profile, used, bounds);
    if (!spot) continue;
    used.add(spot.id);
    const person = people.find((row) => row.profile_id === profile.id);
    const { status, note } = houseStatus(state, profile, person?.status, sweep?.id ?? null);
    houses.push({ id: spot.id, name: profile.name, status, note, lng: spot.lng, lat: spot.lat });
  }
  return houses;
}

function nearest(footprints: Point[], profile: ProfileRow, used: Set<number>, bounds: { south: number; north: number; west: number; east: number }): Point | null {
  if (profile.lat < bounds.south || profile.lat > bounds.north || profile.lng < bounds.west || profile.lng > bounds.east) return null;
  let best: Point | null = null;
  let bestDistance = Infinity;
  for (const item of footprints) {
    if (used.has(item.id)) continue;
    const distance = (item.lng - profile.lng) ** 2 + (item.lat - profile.lat) ** 2;
    if (distance < bestDistance) {
      best = item;
      bestDistance = distance;
    }
  }
  return best;
}

function houseStatus(state: BackendState, profile: ProfileRow, checkIn: string | undefined, incidentId: number | null): { status: HouseStatus; note: string } {
  const helping = state.coordination.filter((row) => row.helper_profile_ids.includes(profile.id)).map((row) => `#${row.support_case_id}`);
  const helper = helping.length ? ` Helper on case ${helping.join(", ")}.` : "";
  if (checkIn === "checking_in") return { status: "waiting", note: `Check-in call placed. No answer recorded yet.${helper}` };
  if (checkIn === "safe") return { status: "out", note: `Said they are safe.${helper}` };
  if (checkIn === "unknown") return { status: "unknown", note: `No answer to the check-in call. Not confirmed safe.${helper}` };
  if (checkIn === "victim") {
    const rideCase = state.cases.find((row) => row.incident_id === incidentId && row.victim_profile_id === profile.id);
    const offer = rideCase ? state.attempts.find((row) => row.support_case_id === rideCase.id && row.outcome === "answered") : undefined;
    const driver = offer ? state.profiles.find((row) => row.id === offer.profile_id)?.name : undefined;
    return {
      status: "needs_ride",
      note: driver ? `Needs a ride. ${driver} answered the ride request · unconfirmed until they are out.` : "Needs help getting out. A ride case is open.",
    };
  }
  return { status: "waiting", note: `Registered.${helper}` };
}

/** Map pins: the demo locations, and every note the backend stored with a place. */
export function sightingsFrom(state: BackendState, caseId: number | null): Sighting[] {
  const pins: Sighting[] = (state.read_model_version === 2 ? [] : state.locations ?? []).map((location) => ({
    id: `location-${location.id}`,
    householdId: 0,
    reporter: "",
    address: location.label,
    text: location.label,
    at: 0,
    lng: location.lng,
    lat: location.lat,
    safe: true,
    label: `${location.label} · demo point`,
  }));
  if (caseId === null) return pins;
  for (const view of notesFor(state, caseId)) {
    const { note } = view;
    if (note.lat === null || note.lng === null) continue;
    pins.push({
      id: `note-${note.id}`,
      householdId: 0,
      reporter: note.source,
      address: "",
      text: note.text,
      at: Date.parse(note.at),
      lng: note.lng,
      lat: note.lat,
      safe: false,
      label: view.kind === "dispatcher" ? "Last seen · reported, not verified" : view.kind === "possible" ? "Possible match · unconfirmed" : "Reported here · not verified",
    });
  }
  return pins;
}

/** Live calls in the offline CallCard shape, only for the node graph's colours. */
export function graphCalls(calls: LiveCall[], houses: House[]): CallCard[] {
  return calls.map((call) => {
    const house = houses.find((row) => row.name === call.person?.name);
    const at = Date.parse(call.attempt.created_at) || 0;
    const phase: CallCard["phase"] =
      call.transport === "active" ? "live" : notReached(call) ? "missed" : call.transport === "ended" ? "done" : call.transport === "cancelled" ? "canceled" : call.transport === undefined && call.attempt.outcome !== null ? "done" : "calling";
    return { id: `attempt-${call.attempt.id}`, name: call.person?.name ?? "Unknown", phase, transcript: call.attempt.answer ? `Saved call report (not a verbatim transcript): ${call.attempt.answer}` : "", at, startedAt: at, answeredAt: null, endedAt: null, householdId: house?.id };
  });
}

export type InboundView = { row: IncomingRequestRow; caller: string; label: string; review: boolean };

const INBOUND: Record<string, string> = {
  pending: "Saved · processing",
  prepared: "Saved · applying",
  recorded: "Recorded",
  attached: "Attached",
  rejected: "Rejected",
  needs_clarification: "Needs clarification",
  needs_review: "Needs review",
};

export function inboundFrom(state: BackendState): InboundView[] {
  return [...(state.incoming_requests ?? [])]
    .sort((a, b) => b.id - a.id)
    .map((row) => {
      const caller = row.from_phone ? state.profiles.filter((profile) => !!profile.phone && profile.phone === row.from_phone) : [];
      return {
        row,
        // Caller-number matching is not identity verification.
        caller: caller.length === 1 ? `${caller[0].name} · by phone number, not verified` : `${row.phone_last4 ? `Phone ending ${row.phone_last4}` : "Incoming caller"} · unknown caller, identity unverified`,
        label: INBOUND[row.status] ?? row.status,
        review: row.status === "needs_review" || row.status === "needs_clarification",
      };
    });
}

export function demoLabel(state: BackendState): string {
  const mode = state.demo_mode;
  const parts = [mode.simulate ? "Drill mode" : "Phone calling enabled", mode.scripted ? "scripted model" : "Claude model", `db ${mode.database}`];
  return parts.join(" · ");
}
