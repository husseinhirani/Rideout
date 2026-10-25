export type HouseStatus = "waiting" | "out" | "needs_ride" | "unknown" | "no_ride" | "blocked";

export type House = {
  id: number;
  name: string;
  status: HouseStatus;
  note: string;
  lng: number;
  lat: number;
};

// holding = the AI handed the call to a person and the resident is waiting;
// operator = a person (the lead) is on the line; canceled = the lead stopped the call.
export type CallPhase = "calling" | "live" | "holding" | "operator" | "missed" | "declined" | "canceled" | "done";

export type CallSegment = {
  speaker: "resident" | "operator" | "system";
  text: string;
  at: number;
};

export type CallRecording = {
  url: string;
  mimeType: string;
  durationMs: number;
};

export type CallCard = {
  id: string;
  name: string;
  phase: CallPhase;
  transcript: string;
  at: number;
  startedAt: number;
  answeredAt: number | null;
  endedAt: number | null;
  householdId?: number;
  taskId?: string;
  handledBy?: "agent" | "operator";
  segments?: CallSegment[];
  escalation?: { reason: string; at: number };
  recording?: CallRecording;
  // "alert" = a community broadcast (missing child); "check" = a welfare check-in.
  purpose?: "check" | "alert";
  voicemail?: boolean;
};

export type IncidentKind = "wildfire" | "missing_child";

export type MissingChild = {
  name: string;
  age: string;
  clothing: string;
  lastSeen: string;
  callback: string;
};

export type Sighting = {
  id: string;
  householdId: number;
  reporter: string;
  address: string;
  text: string;
  at: number;
  lng: number;
  lat: number;
  safe: boolean;
};

export type Incident = {
  kind: IncidentKind;
  startedAt: number;
  child: MissingChild | null;
  sightings: Sighting[];
  foundAt: number | null;
};

export type OperatorSession = {
  callId: string;
  name: string;
  householdId: number | null;
  mode: "direct" | "takeover" | "escalation";
  startedAt: number;
};

export type OperatorOutcome = {
  status: HouseStatus | null;
  note: string;
  audio: Blob | null;
  durationMs: number;
};

export type ChatMessage = {
  id: string;
  from: "lead" | "facilitator";
  text: string;
  at: number;
};

export type TaskTarget = {
  householdId: number;
  name: string;
  address: string;
  registered: boolean;
};

export type CallTask = {
  id: string;
  request: string;
  targets: TaskTarget[];
  state: "running" | "done";
  createdAt: number;
  finishedAt: number | null;
  summary: string | null;
};

export type InboundReport = {
  from: string;
  transcript: string;
  phase: "ringing" | "live" | "filed";
  summary?: string;
  at?: number;
};

export type TelemetryEvent = {
  id: string;
  at: number;
  text: string;
};

export type Place = {
  name: string;
  south: number;
  west: number;
  north: number;
  east: number;
};
