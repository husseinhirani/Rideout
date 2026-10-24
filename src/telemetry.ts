import { useEffect, useMemo, useRef, useState } from "react";
import type { Feature, FeatureCollection, Polygon } from "geojson";
import buildings from "./data/buildings.json";
import placeJson from "./data/place.json";
import type { CallCard, House, HouseStatus, InboundReport, Place } from "./types";

/**
 * Tomorrow: replace this hook with a Convex subscription.
 * Keep the returned shape. The map colors houses by `status`
 * and keys feature-state on `house.id` (the OpenStreetMap way id).
 */
const place = placeJson as Place;
const footprints = northOfFreeway(buildings as FeatureCollection);
const GEO = buildingExtent();

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
  { name: "Samir Patel", lines: ["We're out.", "The car is full."], result: { status: "out", note: "Leaving. Car is full." } },
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

  useEffect(() => {
    if (!running) return;
    const timers = BEATS.map((beat, index) =>
      window.setTimeout(() => {
        const id = `${runId}-${beat.callId}`;
        if (beat.kind === "dial") {
          const now = Date.now();
          setCalls((current) => [
            ...current,
            { id, name: beat.name, phase: "calling", transcript: "", at: beat.at, startedAt: now, answeredAt: null, endedAt: null },
          ]);
        } else if (beat.kind === "say") {
          setCalls((current) =>
            current.map((call) =>
              call.id === id
                ? { ...call, phase: "live", transcript: beat.text, answeredAt: call.answeredAt ?? Date.now() }
                : call,
            ),
          );
          if (beat.lineDone && listeningRef.current === id) speak(beat.sentence, beat.name);
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
        if (index === BEATS.length - 1) setRunning(false);
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
        setInbound((current) => (current ? { ...current, phase: "filed" } : current));
      }, 6400 + inboundWords.length * 140 + 700),
    ];
    return () => {
      timers.forEach((timer) => window.clearTimeout(timer));
      inboundTimers.forEach((timer) => window.clearTimeout(timer));
    };
  }, [running, runId]);

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
    select: setSelectedId,
    listen,
    start: () => {
      window.speechSynthesis?.cancel();
      listeningRef.current = null;
      setListeningId(null);
      setHouses(initial.map((house) => ({ ...house })));
      setCalls([]);
      setInbound(null);
      setSelectedId(null);
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
