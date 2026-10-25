import type { AssistanceState } from "../server/shared/assistance";
import type { ContactScope, InformationPolicy, ProfileSettingsRow, InformationAttemptRow, CreateInformationInput, ConfigureInformationInput, RequestInformationCallInput, InformationCommandResult } from "../server/shared/information";
import type { InformationPlanningRow, InformationDecisionRow } from "../server/shared/information-plan";
import type { InformationIntakeConfiguration, InformationIncomingResolution } from "../server/shared/information-incoming";
export type { ContactScope, InformationPolicy, InformationPlanningRow, InformationDecisionRow, InformationIntakeConfiguration };

/**
 * The backend contract, as GET /state returns it. These mirror the row types in
 * server/src/db.ts; keep them in step rather than inventing frontend-only fields.
 * Every route is same-origin through the Vite proxy (vite.config.ts).
 */

export type Transport = "queued" | "dispatching" | "active" | "ended" | "unknown" | "cancelled";

export type ProfileRow = { id: number; name: string; phone?: string; phone_last4?: string; lat: number; lng: number; contact_profile_ids: number[] };

export type IncidentRow = {
  id: number;
  type: string;
  description: string;
  area: { lat: number; lng: number; radius_m: number } | null;
  brief: string;
  status: string;
  created_at: string;
  ended_at: string | null;
};

export type IncidentPersonRow = { id: number; incident_id: number; profile_id: number; status: "checking_in" | "safe" | "victim" | "unknown" | string };

export type SupportCaseRow = { id: number; incident_id: number; victim_profile_id: number | null; kind?: string; objective?: string; scope?: ContactScope; policy?: InformationPolicy; input_revision?: number; evaluated_revision?: number; goal: string; brief: string; status: "open" | "needs_dispatcher" | "closed" | string };

export type AttemptRow = {
  id: number;
  support_case_id: number;
  profile_id: number;
  ask: string;
  call_id: string | null;
  outcome: string | null;
  answer: string;
  concern: string;
  created_at: string;
};

export type NoteRow = {
  id: number;
  support_case_id: number;
  attempt_id: number | null;
  source: "call" | "dispatcher" | "concern" | string;
  text: string;
  lat: number | null;
  lng: number | null;
  radius_m: number | null;
  at: string;
};

export type CaseProgressRow = {
  support_case_id: number;
  helper_profile_ids: number[];
  input_revision: number;
  evaluated_revision: number;
  failure_count: number;
  retry_at_ms: number | null;
  blocked_reason: string;
};

export type AttemptProgressRow = {
  attempt_id: number;
  support_case_id: number;
  context: string;
  transport: Transport;
  claim_token: string;
  dispatch_error: string;
  claimed_at_ms: number | null;
  report_received: boolean;
  report_processed: boolean;
  raw_concern: string;
  report_received_at_ms: number | null;
  accepted_at_ms: number | null;
  review_consumed: boolean;
};

export type CaseIntakeRow = {
  support_case_id: number;
  reporter_profile_id: number;
  child_description: string;
  last_seen_location_id: string;
  last_seen_time: string;
  reporter_name: string;
  reporter_relationship: string;
  reunion_confirmed: boolean;
  confirmed_at: string | null;
};

export type IncomingRequestRow = {
  id: number;
  provider_call_id: string;
  from_phone?: string; phone_last4?: string; identity_status?: string; review_reason?: string;
  direction: string;
  text: string;
  revision: number;
  status: "pending" | "prepared" | "needs_clarification" | "recorded" | "needs_review" | string;
  decision_json?: string;
  reply: string;
  support_case_id: number | null;
  failure_count: number;
  retry_at_ms: number;
};

export type DemoLocation = { id: string; label: string; lat: number; lng: number };

export type DemoMode = {
  simulate: boolean;
  scripted: boolean;
  auto_coordinate: boolean;
  database: string;
  helper_ids: number[];
  reporter_id?: number | null;
  inbound?: boolean;
};

export type InformationCase = SupportCaseRow & { kind: "information"; objective: string; scope: ContactScope; policy: InformationPolicy; input_revision: number; evaluated_revision: number };
export function informationCases(state: BackendState): InformationCase[] { return state.cases.filter((row): row is InformationCase => row.kind === "information"); }
export type DirectoryResult = { profiles: (ProfileRow & { eligible: boolean; eligibility_reasons: string[]; call_consent: boolean; availability: string })[]; next_after_id: number | null };
export type BackendState = {
  assistance_sessions?: AssistanceState[];
  wildfire_demo?: { name: string; names?: string[]; count?: number; ready: boolean };
  wildfire_drills?: { case_id: number; profile_id: number; started_at: string }[];
  read_model_version?: number;
  server_time_ms?: number;
  adaptive_planning_available?: boolean;
  profile_settings?: ProfileSettingsRow[];
  information_attempts?: InformationAttemptRow[];
  information_planning?: InformationPlanningRow[];
  information_decisions?: InformationDecisionRow[];
  information_intake_configuration?: InformationIntakeConfiguration;
  information_incoming_resolutions?: InformationIncomingResolution[];
  demo_mode: DemoMode;
  locations?: DemoLocation[];
  profiles: ProfileRow[];
  incidents: IncidentRow[];
  incident_people: IncidentPersonRow[];
  cases: SupportCaseRow[];
  attempts: AttemptRow[];
  notes: NoteRow[];
  coordination: CaseProgressRow[];
  attempt_progress: AttemptProgressRow[];
  case_intakes?: CaseIntakeRow[];
  incoming_requests?: IncomingRequestRow[];
};

export type IntakeQuestion = { field: string; question: string };
export type IntakeResult = { status: "recorded"; support_case_id: number } | { status: "needs_clarification"; questions: IntakeQuestion[] };

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function call<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  const text = await response.text();
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    // The Vite proxy answers with HTML or plain text when the backend is down.
  }
  if (!response.ok) {
    const message = (parsed as { error?: unknown } | null)?.error;
    throw new ApiError(response.status, typeof message === "string" ? message : `Request failed (${response.status})`);
  }
  if (parsed === null) throw new ApiError(response.status, "The backend did not answer with JSON");
  return parsed as T;
}

export const api = {
  state: () => call<BackendState>("/state"),
  directory: (filter: ContactScope, after = 0, caseId?: number) => call<DirectoryResult>(`/profiles?filter=${encodeURIComponent(JSON.stringify(filter))}&after_id=${after}${caseId === undefined ? "" : `&case_id=${caseId}`}`),
  incident: (body: CreateInformationInput) => call<InformationCommandResult>("/incidents", body),
  configure: (id: number, body: ConfigureInformationInput) => call<InformationCommandResult>(`/cases/${id}/configuration`, body),
  caseInput: (id: number, body: { command_id: string; expected_input_revision: number; text: string }) => call<InformationCommandResult>(`/cases/${id}/input`, body),
  closeCase: (id: number, body: { command_id: string; expected_input_revision: number; reason: string }) => call<InformationCommandResult>(`/cases/${id}/close`, body),
  cancel: (id: number, body: { command_id: string; expected_input_revision: number; reason: string }) => call<InformationCommandResult>(`/attempts/${id}/cancel`, body),
  requestCall: (id: number, body: RequestInformationCallInput) => call<InformationCommandResult>(`/cases/${id}/calls`, body),
  review: (id: number, body: { command_id: string; expected_revision: number; decision: "attach" | "reject"; reason: string; support_case_id?: number }) => call<InformationCommandResult>(`/incoming-requests/${id}/review`, body),
  intakeConfiguration: (body: Record<string, unknown> & { command_id: string; expected_revision: number }) => call<InformationCommandResult>("/intake-configuration", body),
  simulationReport: (attempt_id: number, answer: string, concern: string) => call<InformationCommandResult>("/simulation/report", { attempt_id, answer, concern }),
};
