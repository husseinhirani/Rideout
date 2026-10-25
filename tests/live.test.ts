import { describe, expect, it } from "vitest";
import type { BackendState } from "../src/api";
import { briefOf, callsFor, cancellable, caseStatus, coordinationOf, currentCase, followUpAt, housesFrom, inboundFrom, notesFor, sightingsFrom } from "../src/live";

const base = (): BackendState => ({
  demo_mode: { simulate: true, scripted: true, auto_coordinate: true, database: "rideout-recording-demo", helper_ids: [1, 2], reporter_id: 4, inbound: true },
  locations: [
    { id: "park-bench", label: "Park bench", lat: 37.8466, lng: -122.2528 },
    { id: "playground", label: "Playground", lat: 37.8476, lng: -122.2486 },
  ],
  profiles: [
    { id: 1, name: "Blair (recording)", phone: "+15555550102", lat: 37.84686, lng: -122.25004, contact_profile_ids: [] },
    { id: 2, name: "Helen Cho", phone: "+15555550201", lat: 37.8467, lng: -122.2493, contact_profile_ids: [] },
    { id: 3, name: "Ava", phone: "", lat: 37.8466, lng: -122.2528, contact_profile_ids: [] },
    { id: 4, name: "Morgan (recording)", phone: "+15555550104", lat: 34.19, lng: -118.13, contact_profile_ids: [] },
  ],
  incidents: [{ id: 1, type: "point", description: "", area: { lat: 0, lng: 0, radius_m: 0 }, brief: "", status: "active", created_at: "", ended_at: null }],
  incident_people: [],
  cases: [{ id: 7, incident_id: 1, victim_profile_id: 3, goal: "Locate Ava", brief: JSON.stringify({ summary: "Waiting on 1 call(s).", suggestions: ["Ask about the slide"] }), status: "open" }],
  attempts: [
    { id: 10, support_case_id: 7, profile_id: 1, ask: "Can you check the Park bench?", call_id: "sim_a", outcome: "answered", answer: "Yes, I can check the park bench.", concern: "", created_at: "" },
    { id: 11, support_case_id: 7, profile_id: 2, ask: "Can you check the Playground?", call_id: null, outcome: null, answer: "", concern: "", created_at: "" },
  ],
  notes: [
    { id: 1, support_case_id: 7, attempt_id: null, source: "call", text: "Morgan (unverified intake): Ava missing", lat: null, lng: null, radius_m: null, at: "2026-10-25T02:00:00Z" },
    { id: 2, support_case_id: 7, attempt_id: 10, source: "call", text: "Blair: Possible match near the slide", lat: 37.8476, lng: -122.2486, radius_m: 0, at: "2026-10-25T02:01:00Z" },
  ],
  coordination: [{ support_case_id: 7, helper_profile_ids: [1, 2], input_revision: 3, evaluated_revision: 3, failure_count: 0, retry_at_ms: null, blocked_reason: "" }],
  attempt_progress: [
    { attempt_id: 10, support_case_id: 7, context: "", transport: "active", claim_token: "t", dispatch_error: "", claimed_at_ms: 1, report_received: true, report_processed: true, raw_concern: "", report_received_at_ms: 5000, accepted_at_ms: 5000, review_consumed: false },
    { attempt_id: 11, support_case_id: 7, context: "", transport: "queued", claim_token: "", dispatch_error: "", claimed_at_ms: null, report_received: false, report_processed: false, raw_concern: "", report_received_at_ms: null, accepted_at_ms: null, review_consumed: false },
  ],
  case_intakes: [{ support_case_id: 7, reporter_profile_id: 4, child_description: "Age 7, red jacket", last_seen_location_id: "park-bench", last_seen_time: "15:00", reporter_name: "Morgan", reporter_relationship: "parent", reunion_confirmed: false, confirmed_at: null }],
  incoming_requests: [
    { id: 1, provider_call_id: "p1", from_phone: "+15555550104", direction: "inbound", text: "My child Ava…", revision: 1, status: "recorded", decision_json: "{}", reply: "Thank you", support_case_id: 7, failure_count: 0, retry_at_ms: 0 },
    { id: 2, provider_call_id: "p2", from_phone: "+19999999999", direction: "inbound", text: "Hello?", revision: 1, status: "needs_review", decision_json: "{}", reply: "Saved for review", support_case_id: null, failure_count: 0, retry_at_ms: 0 },
  ],
});

describe("calls", () => {
  it("shows transport and report separately: an answered report on an active call is not ended", () => {
    const [first, second] = callsFor(base(), 7);
    expect(first.transportLabel).toBe("Active");
    expect(first.reportLabel).toBe("Report processed · accepted");
    expect(second.transportLabel).toBe("Queued");
    expect(second.reportLabel).toBe("No report yet");
  });
  it("does not invent a follow-up deadline from acceptance", () => {
    expect(followUpAt(base().attempt_progress[0])).toBeNull();
    expect(followUpAt(base().attempt_progress[1])).toBeNull();
  });
  it("labels unknown transport as unresolved and offers cancel only where the backend allows it", () => {
    const state = base();
    state.attempt_progress[0].transport = "unknown";
    const [first, second] = callsFor(state, 7);
    expect(first.transportLabel).toMatch(/unresolved, not safe to retry/);
    expect(cancellable(first)).toBe(false);
    expect(cancellable(second)).toBe(true);
  });
});

describe("case status", () => {
  it("never calls a manual close a reunion", () => {
    const state = base();
    state.cases[0].status = "closed";
    const status = caseStatus(state.cases[0], state.case_intakes![0]);
    expect(status.label).toBe("Closed manually · reunion not confirmed");
    expect(status.label).not.toMatch(/found/i);
  });
  it("shows a reunion only from the original reporter's confirmation, and still as self-reported", () => {
    const state = base();
    state.cases[0].status = "closed";
    state.case_intakes![0] = { ...state.case_intakes![0], reunion_confirmed: true, confirmed_at: "2026-10-25T02:03:00Z" };
    const status = caseStatus(state.cases[0], state.case_intakes![0]);
    expect(status.tone).toBe("reunion");
    expect(status.label).toMatch(/self-reported, not verified/);
  });
  it("follows the newest open case unless one is chosen", () => {
    const state = base();
    state.cases.push({ ...state.cases[0], id: 8, status: "closed" });
    expect(currentCase(state, null)?.id).toBe(7);
    expect(currentCase(state, 8)?.id).toBe(8);
  });
  it("reports pending and blocked coordination", () => {
    const state = base();
    state.coordination[0].input_revision = 4;
    expect(coordinationOf(state, 7, 0).kind).toBe("pending");
    state.coordination[0].blocked_reason = "Planning failed";
    expect(coordinationOf(state, 7, 0).kind).toBe("blocked");
  });
  it("reads the brief JSON", () => {
    expect(briefOf(base().cases[0].brief)).toEqual({ summary: "Waiting on 1 call(s).", suggestions: ["Ask about the slide"] });
    expect(briefOf("plain text").summary).toBe("plain text");
  });
});

describe("notes and pins", () => {
  it("labels a possible match as unconfirmed and pins only notes with a place", () => {
    const state = base();
    expect(notesFor(state, 7).map((view) => view.kind)).toEqual(["report", "possible"]);
    const pins = sightingsFrom(state, 7);
    expect(pins.map((pin) => pin.label)).toEqual(["Park bench · demo point", "Playground · demo point", "Possible match · unconfirmed"]);
  });
});

describe("houses", () => {
  const footprints = [
    { id: 100, lng: -122.2493, lat: 37.8467 },
    { id: 200, lng: -122.2500, lat: 37.84686 },
    { id: 300, lng: -122.2510, lat: 37.8470 },
  ];
  const bounds = { south: 37.845, north: 37.849, west: -122.254, east: -122.246 };
  it("keeps residents on their offline footprint, places others nearest, and leaves out the phoneless child and off-block profiles", () => {
    const residents = [{ id: 100, name: "Helen Cho", status: "waiting" as const, note: "", lng: -122.2493, lat: 37.8467 }];
    const houses = housesFrom(base(), residents, footprints, bounds);
    expect(houses.map((house) => [house.name, house.id])).toEqual([
      ["Blair (recording)", 200],
      ["Helen Cho", 100],
    ]);
  });
  it("maps check-in statuses without ever claiming a ride case is out", () => {
    const state = base();
    state.incidents.push({ id: 2, type: "wildfire", description: "", area: { lat: 37.8468, lng: -122.25, radius_m: 400 }, brief: "", status: "active", created_at: "", ended_at: null });
    state.incident_people = [
      { id: 1, incident_id: 2, profile_id: 1, status: "unknown" },
      { id: 2, incident_id: 2, profile_id: 2, status: "victim" },
    ];
    state.cases.push({ id: 9, incident_id: 2, victim_profile_id: 2, goal: "Ride", brief: "", status: "open" });
    state.attempts.push({ id: 12, support_case_id: 9, profile_id: 1, ask: "Ride?", call_id: "sim_b", outcome: "answered", answer: "Yes", concern: "", created_at: "" });
    const houses = housesFrom(state, [], footprints, bounds);
    expect(houses.find((house) => house.name === "Blair (recording)")?.status).toBe("unknown");
    const helen = houses.find((house) => house.name === "Helen Cho");
    expect(helen?.status).toBe("needs_ride");
    expect(helen?.note).toMatch(/unconfirmed/);
  });
});

describe("inbound", () => {
  it("lists requests newest first, flags review, and never treats a phone match as verified", () => {
    const views = inboundFrom(base());
    expect(views.map((view) => view.row.id)).toEqual([2, 1]);
    expect(views[0].review).toBe(true);
    expect(views[0].caller).toMatch(/unknown caller/);
    expect(views[1].caller).toMatch(/not verified/);
  });
});

describe("closed coordination", () => {
  it("says a closed case plans nothing more, even with an unevaluated revision", () => {
    const state = base();
    state.cases[0].status = "closed";
    state.coordination[0].input_revision = 9;
    expect(coordinationOf(state, 7, 0).text).toBe("Case closed. No further calls are planned.");
  });
});


describe("generic state", () => {
  it("handles absent incident area and masked phones without inventing locations or caller identity", () => {
    const state = base();
    state.read_model_version = 2;
    state.incidents[0].area = null;
    state.profiles = state.profiles.map(({ phone, ...p }) => ({ ...p, phone_last4: phone?.slice(-4) }));
    state.incoming_requests = state.incoming_requests?.map(({ from_phone, ...r }) => ({ ...r, phone_last4: from_phone?.slice(-4) }));
    const points = housesFrom(state, [], [], { south: 37, north: 38, west: -123, east: -122 });
    expect(points[0]).toMatchObject({ id: 1, lat: state.profiles[0].lat, lng: state.profiles[0].lng });
    expect(inboundFrom(state)[1].caller).toMatch(/identity unverified/);
    expect(inboundFrom(state)[1].caller).not.toMatch(/Morgan/);
    expect(sightingsFrom(state, 7)).toHaveLength(1);
  });
});
