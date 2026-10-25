/**
 * The backend contract, as GET /state returns it. These mirror the row types in
 * server/src/db.ts; keep them in step rather than inventing frontend-only fields.
 * Every route is same-origin through the Vite proxy (vite.config.ts).
 */

export type Transport = "queued" | "dispatching" | "active" | "ended" | "unknown" | "cancelled";

export type ProfileRow = { id: number; name: string; phone: string; lat: number; lng: number; contact_profile_ids: number[] };

export type IncidentRow = {
  id: number;
  type: string;
  description: string;
  area: { lat: number; lng: number; radius_m: number };
  brief: string;
  status: string;
  created_at: string;
  ended_at: string | null;
};

export type IncidentPersonRow = { id: number; incident_id: number; profile_id: number; status: "checking_in" | "safe" | "victim" | "unknown" | string };

export type SupportCaseRow = { id: number; incident_id: number; victim_profile_id: number; goal: string; brief: string; status: "open" | "needs_dispatcher" | "closed" | string };

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
  from_phone: string;
  direction: string;
  text: string;
  revision: number;
  status: "pending" | "prepared" | "needs_clarification" | "recorded" | "needs_review" | string;
  decision_json: string;
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

export type BackendState = {
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
  intake: (body: {
    event_key: string;
    reporter_profile_id: number | null;
    child: { name: string; description: string; last_seen_location_id: string; last_seen_time: string };
    reporter: { name: string; relationship: string };
  }) => call<IntakeResult>("/intake", body),
  incident: (body: { type: string; lat: number; lng: number; radius_m: number } | { text: string }) =>
    call<{ incident_id: number; case_ids: number[] }>("/incidents", body),
  caseInput: (caseId: number, text: string) => call<{ support_case_id: number; planned: number; reason: string }>(`/cases/${caseId}/input`, { text }),
  closeCase: (caseId: number) => call<{ support_case_id: number; status: string }>(`/cases/${caseId}/close`, {}),
  cancel: (attemptId: number) => call<{ attempt_id: number; cancelled: boolean; reason: string }>(`/attempts/${attemptId}/cancel`, {}),
  report: (attemptId: number, answer: string, concern: string) =>
    call<{ support_case_id: number }>("/calls/report", { attempt_id: String(attemptId), answer, concern }),
  checkIn: (incidentId: number, profileId: number, result: "safe" | "victim") =>
    call<{ result: string; support_case_id: number | null }>("/check-ins", { incident_id: incidentId, profile_id: profileId, result }),
  inbound: (fromPhone: string, text: string, providerCallId: string) =>
    call<{ request_id: number; status: string; reply: string }>("/requests", { from_phone: fromPhone, provider_call_id: providerCallId, direction: "inbound", text }),
  register: (body: { name: string; phone: string; lat: number; lng: number; contact_profile_ids: number[] }) =>
    call<{ profile_id: number }>("/profiles", body),
};
