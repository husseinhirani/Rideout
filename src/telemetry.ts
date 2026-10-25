import { useEffect, useMemo, useRef, useState } from "react";
import type { Feature, FeatureCollection, Polygon } from "geojson";
import buildings from "./data/buildings.json";
import placeJson from "./data/place.json";
import { alertMessage, alertOutcome, alertReply, escalationReason, handoff, plan, scriptFor, summarize } from "./facilitator";
import { householdFor } from "./households";
import type {
  CallCard,
  CallRecording,
  CallSegment,
  CallTask,
  ChatMessage,
  House,
  HouseStatus,
  Incident,
  InboundReport,
  MissingChild,
  OperatorOutcome,
  OperatorSession,
  Place,
  TaskTarget,
} from "./types";

/**
 * Tomorrow: replace this hook with a Convex subscription.
 * Keep the returned shape. The map colors houses by `status`
 * and keys feature-state on `house.id` (the OpenStreetMap way id).
 */
const place = placeJson as Place;
export const footprints = northOfFreeway(buildings as FeatureCollection);
export const GEO = buildingExtent();

function northOfFreeway(collection: FeatureCollection): FeatureCollection {
  const features = collection.features.filter((feature) => {
    const ring = (feature.geometry as Polygon).coordinates[0];
    const lat = ring.reduce((sum, point) => sum + point[1], 0) / ring.length;
    return lat > 37.84545;
  });
  return { type: "FeatureCollection", features: features.length >= 12 ? features : collection.features };
}

function buildingExtent() {
  let south = 90;
  let north = -90;
  let west = 180;
  let east = -180;
  for (const feature of footprints.features) {
    for (const [lng, lat] of (feature.geometry as Polygon).coordinates[0]) {
      south = Math.min(south, lat);
      north = Math.max(north, lat);
      west = Math.min(west, lng);
      east = Math.max(east, lng);
    }
  }
  return { south, north, west, east, name: place.name };
}

type Role = {
  key: string;
  name: string;
  note: string;
  pick: "helen" | "daniel" | "luis" | "maya" | "priya" | "out";
};

const ROLES: Role[] = [
  { key: "helen", name: "Helen Cho", note: "Registered.", pick: "helen" },
  { key: "daniel", name: "Daniel Ruiz", note: "Registered.", pick: "daniel" },
  { key: "luis", name: "Luis Ortega", note: "Registered.", pick: "luis" },
  { key: "maya", name: "Maya Chen", note: "Registered.", pick: "maya" },
  { key: "priya", name: "Priya Shah", note: "Registered.", pick: "priya" },
  { key: "out-1", name: "Andre Walsh", note: "Registered.", pick: "out" },
  { key: "out-2", name: "Naomi Berg", note: "Registered.", pick: "out" },
  { key: "out-3", name: "Chris Feldman", note: "Registered.", pick: "out" },
  { key: "out-4", name: "Rosa Nguyen", note: "Registered.", pick: "out" },
  { key: "out-5", name: "Samir Patel", note: "Registered.", pick: "out" },
  { key: "out-6", name: "June Adler", note: "Registered.", pick: "out" },
  { key: "out-7", name: "Evan Brooks", note: "Registered.", pick: "out" },
];

type Footprint = {
  id: number;
  lng: number;
  lat: number;
};

function centroid(feature: Feature): [number, number] {
  const ring = (feature.geometry as Polygon).coordinates[0];
  let lng = 0;
  let lat = 0;
  const count = Math.max(ring.length - 1, 1);
  for (let i = 0; i < count; i += 1) {
    lng += ring[i][0];
    lat += ring[i][1];
  }
  return [lng / count, lat / count];
}

function footprintsOfInterest(): Footprint[] {
  return footprints.features.map((feature) => {
    const [lng, lat] = centroid(feature);
    return { id: feature.id as number, lng, lat };
  });
}

function takeClosest(pool: Footprint[], lng: number, lat: number): Footprint {
  let best = pool[0];
  let bestDistance = Infinity;
  for (const item of pool) {
    const distance = (item.lng - lng) ** 2 + (item.lat - lat) ** 2;
    if (distance < bestDistance) {
      best = item;
      bestDistance = distance;
    }
  }
  return best;
}

export function assignHouses(): House[] {
  const all = footprintsOfInterest();
  const cut = GEO.west + (GEO.east - GEO.west) * 0.68;
  const midLat = (GEO.south + GEO.north) / 2;
  const safe = all.filter((item) => item.lng < cut);
  const exposed = all.filter((item) => item.lng >= cut);
  const pool = safe.length >= 8 ? safe : all;
  const used = new Set<number>();
  const claim = (lng: number, lat: number, source = pool) => {
    const available = source.filter((item) => !used.has(item.id));
    const chosen = takeClosest(available.length ? available : source, lng, lat);
    used.add(chosen.id);
    return chosen;
  };

  const named = {
    helen: claim(cut - 0.00025, midLat),
    daniel: claim(GEO.west + (cut - GEO.west) * 0.4, midLat),
    luis: claim(cut - 0.00045, midLat + (GEO.north - GEO.south) * 0.2),
    priya: claim(GEO.west + (cut - GEO.west) * 0.2, GEO.north - 0.0002),
    maya: claim(GEO.east - 0.00015, midLat, exposed.length ? exposed : pool),
  };
  const spare = pool.filter((item) => !used.has(item.id));
  let spareIndex = 0;

  return ROLES.map((role) => {
    const spot = role.pick === "out" ? spare[spareIndex++] ?? claim(place.west, midLat) : named[role.pick];
    return {
      id: spot.id,
      name: role.name,
      status: "waiting" as HouseStatus,
      note: role.note,
      lng: spot.lng,
      lat: spot.lat,
    };
  });
}

export function fireFeature(): Feature<Polygon> {
  const cut = GEO.west + (GEO.east - GEO.west) * 0.68;
  return {
    type: "Feature",
    properties: {},
    geometry: {
      type: "Polygon",
      coordinates: [[
        [cut, GEO.south - 0.00015],
        [GEO.east + 0.0002, GEO.south],
        [GEO.east + 0.0001, GEO.north + 0.0001],
        [cut - 0.0002, GEO.north],
        [cut, GEO.south - 0.00015],
      ]],
    },
  };
}

const FIRE = fireFeature();

type ScriptCall = {
  name: string;
  lines: string[];
  missed?: boolean;
  declined?: boolean;
  ringMs?: number;
  result: { status: HouseStatus; note: string };
};

const CALLS: ScriptCall[] = [
  { name: "Andre Walsh", lines: ["I'm already on Claremont.", "The car is full."], result: { status: "out", note: "Already driving out. Car is full." } },
  { name: "Naomi Berg", lines: ["We're past College Avenue.", "No seats left."], result: { status: "out", note: "Already driving out." } },
  { name: "Chris Feldman", lines: ["Leaving now.", "I don't have an open seat."], result: { status: "out", note: "Leaving. No open seats." } },
  { name: "Rosa Nguyen", lines: ["I'm on the bridge already.", "I can't turn around."], result: { status: "out", note: "Already driving out." } },
  { name: "Samir Patel", lines: ["We're out.", "But my dad on Shafter isn't picking up. Should we go back for him?"], result: { status: "out", note: "Leaving. Car is full." } },
  { name: "June Adler", lines: ["I left ten minutes ago."], result: { status: "out", note: "Already out." } },
  { name: "Evan Brooks", lines: ["Driving out on Claremont.", "No room in the back."], result: { status: "out", note: "Already driving out." } },
  { name: "Helen Cho", lines: ["I can't leave on my own.", "I use a walker.", "My daughter has the car."], result: { status: "needs_ride", note: "Walker. Daughter has the car." } },
  { name: "Daniel Ruiz", lines: ["I'm leaving in the Honda.", "Two seats are open."], result: { status: "out", note: "Gray Honda. Two seats. Leaving now." } },
  { name: "Luis Ortega", lines: ["I can't get down the stairs.", "I use a wheelchair."], result: { status: "needs_ride", note: "Wheelchair." } },
  { name: "Maya Chen", lines: ["I have the van.", "The road out crosses the fire."], result: { status: "blocked", note: "Van. Not offered. Route crosses the fire." } },
  { name: "Priya Shah", lines: [], missed: true, ringMs: 42000, result: { status: "unknown", note: "No answer. Unknown." } },
  { name: "Daniel Ruiz", lines: ["I can pick up Helen.", "Gray Honda. I'll stay off the fire road."], result: { status: "out", note: "Gray Honda. Accepted Helen." } },
  { name: "Helen Cho", lines: ["Daniel Ruiz is coming in a gray Honda.", "If he does not arrive, call 911."], result: { status: "out", note: "Daniel Ruiz, gray Honda. Call 911 if he does not arrive." } },
  { name: "Luis Ortega", lines: ["There is no van that fits the wheelchair.", "If you are in danger, call 911."], result: { status: "no_ride", note: "No ride. Call 911 if you are in danger." } },
];

type Beat =
  | { at: number; callId: string; name: string; kind: "dial" | "miss" | "decline" }
  | { at: number; callId: string; name: string; kind: "say"; text: string; sentence: string; lineDone: boolean }
  | { at: number; callId: string; name: string; kind: "resolve"; status: HouseStatus; note: string };

function pushCall(beats: Beat[], call: ScriptCall, index: number, start: number) {
  const callId = `${index}-${call.name}`;
  const ring = call.ringMs ?? (call.missed ? 42000 : 1800 + (index % 4) * 350);
  beats.push({ at: start, callId, name: call.name, kind: "dial" });
  if (call.missed || call.declined || call.lines.length === 0) {
    const at = start + ring;
    beats.push({ at, callId, name: call.name, kind: call.declined ? "decline" : "miss" });
    beats.push({ at, callId, name: call.name, kind: "resolve", status: call.result.status, note: call.result.note });
    return at;
  }
  let at = start + ring;
  let soFar = "";
  for (const line of call.lines) {
    const words = line.split(" ");
    let partial = "";
    words.forEach((word, wordIndex) => {
      partial = partial ? `${partial} ${word}` : word;
      at += 140;
      beats.push({
        at,
        callId,
        name: call.name,
        kind: "say",
        text: soFar ? `${soFar} ${partial}` : partial,
        sentence: line,
        lineDone: wordIndex === words.length - 1,
      });
    });
    soFar = soFar ? `${soFar} ${line}` : line;
    at += 200;
  }
  at += 350;
  beats.push({ at, callId, name: call.name, kind: "resolve", status: call.result.status, note: call.result.note });
  return at;
}

function buildBeats(): Beat[] {
  const beats: Beat[] = [];
  const first = CALLS.slice(0, 12);
  const follow = CALLS.slice(12);
  const ended: Record<string, number> = {};
  first.forEach((call, index) => {
    const start = 400 + index * 80;
    ended[call.name] = pushCall(beats, call, index, start);
  });
  const askAt = Math.max(ended["Helen Cho"] ?? 0, ended["Daniel Ruiz"] ?? 0) + 450;
  const asked = pushCall(beats, follow[0], 12, askAt);
  const told = pushCall(beats, follow[1], 13, asked + 350);
  const luisAt = Math.max(ended["Luis Ortega"] ?? 0, ended["Maya Chen"] ?? 0, told) + 350;
  pushCall(beats, follow[2], 14, luisAt);
  return beats.sort((a, b) => a.at - b.at);
}

const BEATS = buildBeats();

/** Display-only companions for a real drill. Reconstruct from its saved start
 * time so refreshing never restarts the script or queues any extra phone calls. */
export function wildfireMockCalls(startedAt: number, now: number): CallCard[] {
  const calls = new Map<string, CallCard>();
  for (const beat of BEATS) {
    if (beat.at > now - startedAt) break;
    const id = `mock-${startedAt}-${beat.callId}`;
    const at = startedAt + beat.at;
    if (beat.kind === "dial") {
      calls.set(id, { id, name: beat.name, phase: "calling", transcript: "", at,
        startedAt: at, answeredAt: null, endedAt: null });
      continue;
    }
    const call = calls.get(id);
    if (!call) continue;
    if (beat.kind === "say") {
      call.phase = "live"; call.answeredAt ??= at; call.transcript = beat.text;
    } else if (beat.kind === "miss" || beat.kind === "decline") {
      call.phase = beat.kind === "miss" ? "missed" : "declined"; call.endedAt = at;
    } else if (beat.kind === "resolve") {
      if (call.phase !== "missed" && call.phase !== "declined") call.phase = "done";
      call.endedAt ??= at;
    }
  }
  return [...calls.values()];
}

function mark(houses: House[], name: string, status: HouseStatus, note: string): House[] {
  return houses.map((house) => (house.name === name ? { ...house, status, note } : house));
}

export function useRideOut() {
  const initial = useMemo(() => assignHouses(), []);
  const [houses, setHouses] = useState<House[]>(initial);
  const [calls, setCalls] = useState<CallCard[]>([]);
  const [running, setRunning] = useState(false);
  const [started, setStarted] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [runId, setRunId] = useState(0);
  const [listeningId, setListeningId] = useState<string | null>(null);
  const [inbound, setInbound] = useState<InboundReport | null>(null);
  const listeningRef = useRef<string | null>(null);
  const [chat, setChat] = useState<ChatMessage[]>([]);
  const [tasks, setTasks] = useState<CallTask[]>([]);
  const housesRef = useRef(houses);
  const callsRef = useRef(calls);
  const taskTimers = useRef<number[]>([]);
  const taskCount = useRef(0);
  const [operator, setOperator] = useState<OperatorSession | null>(null);
  const operatorRef = useRef(operator);
  // Calls the AI no longer drives: canceled, taken over, or handed to a person.
  const stopped = useRef(new Set<string>());
  // Task bookkeeping that runs once when a facilitator-requested call finally ends.
  const finishers = useRef(new Map<string, () => void>());
  const recordings = useRef(new Map<string, Blob>());
  const directCount = useRef(0);
  const [incident, setIncident] = useState<Incident>({ kind: "wildfire", startedAt: 0, child: null, sightings: [], foundAt: null });
  const [inboundLog, setInboundLog] = useState<InboundReport[]>([]);
  housesRef.current = houses;
  callsRef.current = calls;
  operatorRef.current = operator;

  useEffect(() => () => taskTimers.current.forEach((timer) => window.clearTimeout(timer)), []);

  const later = (ms: number, run: () => void) => {
    taskTimers.current.push(window.setTimeout(run, ms));
  };

  const post = (from: ChatMessage["from"], text: string) => {
    setChat((current) => [...current, { id: `${from}-${Date.now()}-${current.length}`, from, text, at: Date.now() }]);
  };

  const patchCall = (id: string, change: (call: CallCard) => CallCard) =>
    setCalls((current) => current.map((call) => (call.id === id ? change(call) : call)));
  const segment = (speaker: CallSegment["speaker"], text: string): CallSegment => ({ speaker, text, at: Date.now() });
  const endTask = (id: string) => {
    const finish = finishers.current.get(id);
    finishers.current.delete(id);
    finish?.();
  };
  const hush = (id: string) => {
    if (listeningRef.current !== id) return;
    window.speechSynthesis?.cancel();
    listeningRef.current = null;
    setListeningId(null);
  };

  // The AI hands the call to a person: the resident stays on hold until the lead picks up.
  const escalate = (id: string, name: string, reason: string) => {
    stopped.current.add(id);
    hush(id);
    patchCall(id, (call) => ({
      ...call,
      phase: "holding",
      escalation: { reason, at: Date.now() },
      segments: [...(call.segments ?? []), segment("system", `Handed to a person. ${reason}`)],
    }));
    post("facilitator", `${name}'s call needs a person. ${reason} They are on hold. Pick up from the banner or the caller list.`);
  };

  const cancelCall = (id: string) => {
    const call = callsRef.current.find((item) => item.id === id);
    if (!call || !["calling", "live", "holding"].includes(call.phase)) return;
    stopped.current.add(id);
    hush(id);
    patchCall(id, (current) => ({
      ...current,
      phase: "canceled",
      endedAt: Date.now(),
      segments: [...(current.segments ?? []), segment("system", "Canceled by the lead.")],
    }));
    endTask(id);
  };

  const takeOver = (id: string) => {
    const call = callsRef.current.find((item) => item.id === id);
    if (operatorRef.current || !call || !["calling", "live", "holding"].includes(call.phase)) return;
    const mode = call.phase === "holding" ? "escalation" : "takeover";
    stopped.current.add(id);
    hush(id);
    patchCall(id, (current) => ({
      ...current,
      phase: "operator",
      handledBy: "operator",
      answeredAt: current.answeredAt ?? Date.now(),
      segments: [...(current.segments ?? []), segment("system", mode === "escalation" ? "The lead picked up." : "The lead took over from the AI.")],
    }));
    setOperator({ callId: id, name: call.name, householdId: call.householdId ?? null, mode, startedAt: Date.now() });
  };

  const callDirect = (householdId: number) => {
    if (operatorRef.current) return;
    const house = housesRef.current.find((item) => item.id === householdId);
    const name = householdFor(householdId, house?.name).owner;
    directCount.current += 1;
    const id = `lead-${directCount.current}-${householdId}`;
    const now = Date.now();
    setCalls((current) => [
      ...current,
      {
        id,
        name,
        phase: "operator",
        transcript: "",
        at: 0,
        startedAt: now,
        answeredAt: now,
        endedAt: null,
        householdId,
        handledBy: "operator",
        segments: [segment("system", "The lead called directly.")],
      },
    ]);
    setOperator({ callId: id, name, householdId, mode: "direct", startedAt: now });
  };

  const operatorSaid = (text: string) => {
    const session = operatorRef.current;
    if (session && text.trim()) patchCall(session.callId, (call) => ({ ...call, segments: [...(call.segments ?? []), segment("operator", text.trim())] }));
  };

  const hangUp = (outcome: OperatorOutcome) => {
    const session = operatorRef.current;
    if (!session) return;
    let recording: CallRecording | undefined;
    if (outcome.audio) {
      recordings.current.set(session.callId, outcome.audio);
      recording = { url: URL.createObjectURL(outcome.audio), mimeType: outcome.audio.type || "audio/webm", durationMs: outcome.durationMs };
    }
    const note = outcome.note.trim();
    patchCall(session.callId, (call) => ({
      ...call,
      phase: "done",
      endedAt: Date.now(),
      recording,
      segments: [...(call.segments ?? []), ...(note ? [segment("operator", `Note: ${note}`)] : []), segment("system", "The lead hung up.")],
    }));
    const status = outcome.status;
    if (status && session.householdId !== null) {
      setHouses((current) =>
        current.map((house) => (house.id === session.householdId ? { ...house, status, note: note || house.note } : house)),
      );
    }
    setOperator(null);
    endTask(session.callId);
  };

  // One call the facilitator handed to the caller: ring, talk, then write the house's new status.
  const runCall = (taskId: string, target: TaskTarget, startAt: number, done: () => void) => {
    const id = `${taskId}-${target.householdId}`;
    const script = scriptFor(target, housesRef.current);
    const live = () => !stopped.current.has(id);
    let ended = false;
    finishers.current.set(id, () => {
      if (ended) return;
      ended = true;
      done();
    });
    const patch = (change: (call: CallCard) => CallCard) => patchCall(id, change);
    later(startAt, () => {
      setCalls((current) => [
        ...current,
        {
          id,
          name: target.name,
          phase: "calling",
          transcript: "",
          at: startAt,
          startedAt: Date.now(),
          answeredAt: null,
          endedAt: null,
          householdId: target.householdId,
          taskId,
          handledBy: "agent",
          segments: [],
        },
      ]);
    });
    if (!script.answered) {
      later(startAt + 9000, () => {
        if (!live()) return;
        patch((call) => ({ ...call, phase: "missed", transcript: "No answer. It rang, then stopped.", endedAt: Date.now() }));
        endTask(id);
      });
      return;
    }
    let at = startAt + 1600 + (target.householdId % 3) * 300;
    let soFar = "";
    for (const line of script.lines) {
      const words = line.split(" ");
      const before = soFar;
      words.forEach((_, index) => {
        at += 140;
        const text = `${before ? `${before} ` : ""}${words.slice(0, index + 1).join(" ")}`;
        const lineDone = index === words.length - 1;
        later(at, () => {
          if (!live()) return;
          patch((call) => ({
            ...call,
            phase: "live",
            transcript: text,
            answeredAt: call.answeredAt ?? Date.now(),
            segments: lineDone ? [...(call.segments ?? []), segment("resident", line)] : call.segments,
          }));
          if (lineDone && listeningRef.current === id) speak(line, target.name);
          const reason = lineDone ? escalationReason(line) : null;
          if (reason) escalate(id, target.name, reason);
        });
      });
      soFar = soFar ? `${soFar} ${line}` : line;
      at += 200;
    }
    const result = script.result;
    later(at + 350, () => {
      if (!live()) return;
      patch((call) => ({ ...call, phase: "done", endedAt: Date.now() }));
      if (result) {
        setHouses((current) =>
          current.map((house) => (house.id === target.householdId ? { ...house, status: result.status, note: result.note } : house)),
        );
      }
      endTask(id);
    });
  };

  const ask = (request: string) => {
    const text = request.trim();
    if (!text) return;
    post("lead", text);
    later(450, () => {
      const decision = plan(text, housesRef.current);
      if (decision.kind === "reply") {
        post("facilitator", decision.text);
        return;
      }
      if (/\b(myself|let me call|i.?ll call|i will call|connect me|put me through)\b/i.test(text)) {
        if (decision.targets.length !== 1) {
          post("facilitator", "Name one house to call yourself, for example \"I'll call Luis myself\".");
          return;
        }
        if (operatorRef.current) {
          post("facilitator", "You are already on a call. Hang up first, then ask again.");
          return;
        }
        const [target] = decision.targets;
        post("facilitator", `Connecting you to ${target.name} at ${target.address}. The call is recorded for the log.`);
        callDirect(target.householdId);
        return;
      }
      taskCount.current += 1;
      const taskId = `task-${taskCount.current}`;
      const { targets } = decision;
      setTasks((current) => [
        ...current,
        { id: taskId, request: text, targets, state: "running", createdAt: Date.now(), finishedAt: null, summary: null },
      ]);
      post("facilitator", handoff(targets, decision.label));
      let remaining = targets.length;
      const finish = () => {
        remaining -= 1;
        if (remaining > 0) return;
        later(500, () => {
          const mine = callsRef.current.filter((call) => call.taskId === taskId);
          const summary = summarize(targets, mine, housesRef.current);
          post("facilitator", summary);
          setTasks((current) =>
            current.map((task) => (task.id === taskId ? { ...task, state: "done", finishedAt: Date.now(), summary } : task)),
          );
        });
      };
      targets.forEach((target, index) => runCall(taskId, target, 300 + index * 220, finish));
    });
  };

  useEffect(() => {
    if (!running || incident.kind !== "wildfire") return;
    const timers = BEATS.map((beat, index) =>
      window.setTimeout(() => {
        const id = `${runId}-${beat.callId}`;
        if (index === BEATS.length - 1) setRunning(false);
        if (beat.kind !== "dial" && stopped.current.has(id)) return;
        if (beat.kind === "dial") {
          const now = Date.now();
          setCalls((current) => [
            ...current,
            {
              id,
              name: beat.name,
              phase: "calling",
              transcript: "",
              at: beat.at,
              startedAt: now,
              answeredAt: null,
              endedAt: null,
              householdId: initial.find((house) => house.name === beat.name)?.id,
              handledBy: "agent",
              segments: [],
            },
          ]);
        } else if (beat.kind === "say") {
          patchCall(id, (call) => ({
            ...call,
            phase: "live",
            transcript: beat.text,
            answeredAt: call.answeredAt ?? Date.now(),
            segments: beat.lineDone ? [...(call.segments ?? []), segment("resident", beat.sentence)] : call.segments,
          }));
          if (beat.lineDone && listeningRef.current === id) speak(beat.sentence, beat.name);
          const reason = beat.lineDone ? escalationReason(beat.sentence) : null;
          if (reason) escalate(id, beat.name, reason);
        } else if (beat.kind === "miss" || beat.kind === "decline") {
          const declined = beat.kind === "decline";
          setCalls((current) =>
            current.map((call) =>
              call.id === id
                ? {
                    ...call,
                    phase: declined ? "declined" : "missed",
                    transcript: declined ? "Declined the call." : "No answer. It rang, then stopped.",
                    endedAt: Date.now(),
                  }
                : call,
            ),
          );
        } else if (beat.kind === "resolve") {
          setCalls((current) =>
            current.map((call) =>
              call.id === id
                ? {
                    ...call,
                    phase: call.phase === "missed" || call.phase === "declined" ? call.phase : "done",
                    endedAt: call.endedAt ?? Date.now(),
                  }
                : call,
            ),
          );
          setHouses((current) => mark(current, beat.name, beat.status, beat.note));
        }
      }, beat.at),
    );
    const inboundLine = "My son Leo was at a friend's on Colby. He is not picking up.";
    const inboundWords = inboundLine.split(" ");
    const inboundTimers = [
      window.setTimeout(() => {
        setInbound({ from: "Ken Abe", transcript: "", phase: "ringing" });
      }, 4800),
      ...inboundWords.map((_, index) =>
        window.setTimeout(() => {
          setInbound({
            from: "Ken Abe",
            transcript: inboundWords.slice(0, index + 1).join(" "),
            phase: "live",
          });
        }, 6400 + index * 140),
      ),
      window.setTimeout(() => {
        const summary =
          "Leo is not home. He was at a friend’s on Colby and is not picking up. Logged for the neighborhood lead. RideOut does not call 911.";
        const report: InboundReport = { from: "Ken Abe", transcript: inboundLine, phase: "filed", summary, at: Date.now() };
        setInbound(report);
        setInboundLog((current) => [...current, report]);
        post("facilitator", "Ken Abe says his son Leo is missing. You can start a missing child alert from Start → Missing child. It is filled in with Leo's details.");
      }, 6400 + inboundWords.length * 140 + 700),
    ];
    return () => {
      timers.forEach((timer) => window.clearTimeout(timer));
      inboundTimers.forEach((timer) => window.clearTimeout(timer));
    };
    // The drill timers are keyed to one run; helpers they call only touch refs and setters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, runId, incident.kind]);

  // Missing child: the caller reads one alert to every home on the block, a few at a time.
  const broadcast = (child: MissingChild, alertId: number) => {
    const message = alertMessage(child);
    const names = new Map(initial.map((house) => [house.id, house.name]));
    const homes = footprintsOfInterest();
    const answered: typeof homes = [];
    homes.forEach((spot, index) => {
      const id = `alert-${alertId}-${spot.id}`;
      const home = householdFor(spot.id, names.get(spot.id));
      const live = () => !stopped.current.has(id);
      const dialAt = 300 + index * 90;
      const ring = 1500 + (spot.id % 9) * 120;
      const outcome = alertOutcome(spot.id);
      if (outcome === "answered") answered.push(spot);
      later(dialAt, () => {
        setCalls((current) => [
          ...current,
          {
            id,
            name: home.owner,
            phase: "calling",
            transcript: "",
            at: dialAt,
            startedAt: Date.now(),
            answeredAt: null,
            endedAt: null,
            householdId: spot.id,
            handledBy: "agent",
            purpose: "alert",
            segments: [],
          },
        ]);
      });
      if (outcome === "missed") {
        later(dialAt + 7000, () => {
          if (!live()) return;
          patchCall(id, (call) => ({ ...call, phase: "missed", transcript: "No answer. It rang, then stopped.", endedAt: Date.now() }));
        });
        return;
      }
      if (outcome === "voicemail") {
        later(dialAt + ring + 2500, () => {
          if (!live()) return;
          patchCall(id, (call) => ({
            ...call,
            phase: "done",
            voicemail: true,
            transcript: "Voicemail. Left the alert.",
            endedAt: Date.now(),
            segments: [...(call.segments ?? []), segment("system", `Left the alert on voicemail: ${message}`)],
          }));
        });
        return;
      }
      const reply = alertReply(spot.id);
      later(dialAt + ring, () => {
        if (!live()) return;
        patchCall(id, (call) => ({
          ...call,
          phase: "live",
          answeredAt: Date.now(),
          segments: [...(call.segments ?? []), segment("system", `Read the alert: ${message}`)],
        }));
      });
      later(dialAt + ring + 2200, () => {
        if (!live()) return;
        patchCall(id, (call) => ({ ...call, transcript: reply, segments: [...(call.segments ?? []), segment("resident", reply)] }));
        const reason = escalationReason(reply);
        if (reason) escalate(id, home.owner, reason);
      });
      later(dialAt + ring + 3400, () => {
        if (!live()) return;
        patchCall(id, (call) => ({ ...call, phase: "done", endedAt: Date.now() }));
      });
    });

    // Two neighbors near the middle of the block call back: one sighting, then one who has the child safe.
    const first = child.name.split(" ")[0];
    const midLng = (GEO.west + GEO.east) / 2;
    const midLat = (GEO.south + GEO.north) / 2;
    const near = [...answered].sort(
      (a, b) => (a.lng - midLng) ** 2 + (a.lat - midLat) ** 2 - ((b.lng - midLng) ** 2 + (b.lat - midLat) ** 2),
    );
    const spotter = near.at(Math.min(3, near.length - 1));
    const finder = near.at(Math.min(9, near.length - 1));
    if (spotter) {
      const street = householdFor(spotter.id, names.get(spotter.id)).address.replace(/^\d+\s*/, "");
      callBack(
        spotter.id,
        names.get(spotter.id),
        13000,
        `Hi, you called about a missing kid? A boy in ${child.clothing} just walked past my house on ${street}, toward College Avenue.`,
        `Sighting: a boy in ${child.clothing} passing ${street}, heading toward College Ave.`,
        { lng: spotter.lng, lat: spotter.lat, safe: false },
      );
    }
    if (finder && finder !== spotter) {
      callBack(
        finder.id,
        names.get(finder.id),
        26000,
        `${first} is here at our house with my daughter. He says he got lost on the way home. He's safe.`,
        `${first} is safe at this house. Confirm with the family, then mark him found.`,
        { lng: finder.lng, lat: finder.lat, safe: true },
      );
    }
    later(Math.max(homes.length * 90 + 9000, 36000), () => setRunning(false));
  };

  const callBack = (
    householdId: number,
    registeredName: string | undefined,
    at: number,
    line: string,
    summary: string,
    where: { lng: number; lat: number; safe: boolean },
  ) => {
    const home = householdFor(householdId, registeredName);
    const words = line.split(" ");
    later(at, () => setInbound({ from: home.owner, transcript: "", phase: "ringing", at: Date.now() }));
    words.forEach((_, index) => {
      later(at + 1600 + index * 140, () =>
        setInbound({ from: home.owner, transcript: words.slice(0, index + 1).join(" "), phase: "live", at: Date.now() }),
      );
    });
    later(at + 1600 + words.length * 140 + 700, () => {
      const report: InboundReport = { from: home.owner, transcript: line, phase: "filed", summary, at: Date.now() };
      setInbound(report);
      setInboundLog((current) => [...current, report]);
      setIncident((current) => ({
        ...current,
        sightings: [
          ...current.sightings,
          { id: `sighting-${current.sightings.length + 1}`, householdId, reporter: home.owner, address: home.address, text: line, at: Date.now(), ...where },
        ],
      }));
      post(
        "facilitator",
        where.safe
          ? `${home.owner} (${home.address}) called back: ${line} Confirm with the family, then press Mark found.`
          : `Sighting from ${home.owner} (${home.address}): ${line} Pinned on the map.`,
      );
    });
  };

  const resetAll = () => {
    window.speechSynthesis?.cancel();
    taskTimers.current.forEach((timer) => window.clearTimeout(timer));
    taskTimers.current = [];
    stopped.current.clear();
    finishers.current.clear();
    recordings.current.clear();
    callsRef.current.forEach((call) => call.recording && URL.revokeObjectURL(call.recording.url));
    setOperator(null);
    setChat([]);
    setTasks([]);
    listeningRef.current = null;
    setListeningId(null);
    setHouses(initial.map((house) => ({ ...house })));
    setCalls([]);
    setInbound(null);
    setInboundLog([]);
    setSelectedId(null);
  };

  const startMissingChild = (child: MissingChild) => {
    resetAll();
    const alertId = Date.now();
    setIncident({ kind: "missing_child", startedAt: alertId, child, sightings: [], foundAt: null });
    setStarted(true);
    setRunning(true);
    setRunId((value) => value + 1);
    post(
      "facilitator",
      `Missing child alert for ${child.name} is going out. Amina is calling all ${footprintsOfInterest().length} homes on the block. Call-backs go to Elena, and every sighting is pinned on the map.`,
    );
    broadcast(child, alertId);
  };

  const markFound = () => {
    setIncident((current) => (current.foundAt ? current : { ...current, foundAt: Date.now() }));
    const pending = callsRef.current.filter((call) => call.purpose === "alert" && (call.phase === "calling" || call.phase === "live"));
    pending.forEach((call) => stopped.current.add(call.id));
    const child = incident.child?.name ?? "The child";
    const onHold = callsRef.current.filter((call) => call.phase === "holding").length;
    const holdNote = onHold ? ` ${onHold} ${onHold === 1 ? "neighbor is" : "neighbors are"} still on hold for you; pick up to tell them, or cancel.` : "";
    post("facilitator", `${child} is marked found. I stopped the alert calls still going out.${holdNote} The log has every call and sighting.`);
    later(400, () => setRunning(false));
  };

  const withoutRide = houses.filter((house) => house.status === "needs_ride" || house.status === "no_ride").length;
  const selected = houses.find((house) => house.id === selectedId) ?? null;

  const listen = (id: string) => {
    if (listeningRef.current === id) {
      window.speechSynthesis?.cancel();
      listeningRef.current = null;
      setListeningId(null);
      return;
    }
    const call = calls.find((item) => item.id === id);
    listeningRef.current = id;
    setListeningId(id);
    const text = call?.transcript || `Calling ${call?.name ?? "this house"}.`;
    speak(text, call?.name ?? "", () => {
      if (listeningRef.current === id) {
        listeningRef.current = null;
        setListeningId(null);
      }
    });
  };

  return {
    place: GEO,
    footprints,
    fire: FIRE,
    houses,
    calls,
    inbound,
    withoutRide,
    running,
    started,
    selected,
    listeningId,
    chat,
    tasks,
    ask,
    operator,
    cancelCall,
    takeOver,
    callDirect,
    operatorSaid,
    hangUp,
    recordingFor: (id: string) => recordings.current.get(id) ?? null,
    incident,
    inboundLog,
    homesOnBlock: footprints.features.length,
    startMissingChild,
    markFound,
    select: setSelectedId,
    listen,
    start: () => {
      resetAll();
      setIncident({ kind: "wildfire", startedAt: Date.now(), child: null, sightings: [], foundAt: null });
      setStarted(true);
      setRunning(true);
      setRunId((value) => value + 1);
    },
  };
}

let speakToken = 0;

function speak(text: string, name: string, onend?: () => void) {
  if (!window.speechSynthesis) return;
  const token = ++speakToken;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  const voices = window.speechSynthesis.getVoices().filter((voice) => voice.lang.toLowerCase().startsWith("en"));
  if (voices.length) utterance.voice = voices[hash(name) % voices.length];
  utterance.rate = 0.96;
  utterance.pitch = 0.86 + (hash(name) % 5) * 0.07;
  utterance.onend = () => {
    if (token !== speakToken) return;
    onend?.();
  };
  window.speechSynthesis.speak(utterance);
}

function hash(value: string) {
  let total = 0;
  for (let i = 0; i < value.length; i += 1) total = (total + value.charCodeAt(i) * (i + 1)) % 997;
  return total;
}

export function formatClock(ms: number) {
  const total = Math.round(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}
