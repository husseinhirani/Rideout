export type HouseStatus = "waiting" | "out" | "needs_ride" | "unknown" | "no_ride" | "blocked";

export type House = {
  id: number;
  name: string;
  status: HouseStatus;
  note: string;
  lng: number;
  lat: number;
};

export type CallPhase = "calling" | "live" | "missed" | "declined" | "done";

export type CallCard = {
  id: string;
  name: string;
  phase: CallPhase;
  transcript: string;
  at: number;
  startedAt: number;
  answeredAt: number | null;
  endedAt: number | null;
};

export type InboundReport = {
  from: string;
  transcript: string;
  phase: "ringing" | "live" | "filed";
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
