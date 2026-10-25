import { contours } from "d3-contour";
import landuseData from "./data/landuse.json";
import buildingData from "./data/buildings.json";
import streetData from "./data/streets.json";

/**
 * A drill-grade wildfire spread model for the incident map. Not a forecast.
 * Fuel comes from mapped land use (woods burn hottest, grass fast, streets and buildings slow),
 * wind stretches spread into an ellipse downwind, and a minimum-travel-time search over a
 * ~12 m grid gives each spot an expected fire arrival time. Evacuation zones are bands of that time,
 * pulled closer wherever wooded land is nearby and widened for wind-blown embers.
 */
export type Wind = { from: number; mph: number };
export type ZoneId = "fire" | "now" | "warning" | "ready";
export type LngLat = [number, number];
export type MultiPolygon = LngLat[][][];

export const DEFAULT_WIND: Wind = { from: 45, mph: 25 };
export const COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
export const ZONES: { id: Exclude<ZoneId, "fire">; label: string; minutes: number }[] = [
  { id: "now", label: "Evacuate now", minutes: 60 },
  { id: "warning", label: "Evacuation warning", minutes: 120 },
  { id: "ready", label: "Be ready", minutes: 240 },
];
/** The perimeter drawn as already burning. */
export const BURNING_MINUTES = 20;
/** Modeled area: the mapped land use plus a margin of plain residential fuel, so zones end in open map, not at a grid edge. */
export const FIRE_EXTENT = { west: -122.2630, east: -122.2370, south: 37.8370, north: 37.8560 };
/** Fire starts in the wooded hills northeast of the block, where Diablo winds push it downhill. */
export const IGNITION: LngLat = [-122.2432, 37.8498];

const NX = 180;
const NY = 176;
const METERS_PER_DEGREE = 111195;
const BASE_SPREAD = 1.3; // m/min through ordinary residential yards with no wind
const WOOD_REACH = 60; // m: land this close to woods is warned one band earlier
const WOOD_PULL = 0.75;
const EMBER_REACH = 150; // m: zones reach this far past the projected spread, for wind-blown embers
const FUEL = { residential: 1, park: 1.3, field: 1.6, wood: 2.2, street: 0.8, arterial: 0.25, building: 0.6, water: 0 };
const ARTERIAL = new Set(["motorway", "trunk", "primary", "secondary"]);

const cosine = Math.cos((((FIRE_EXTENT.south + FIRE_EXTENT.north) / 2) * Math.PI) / 180);
const cellWidth = ((FIRE_EXTENT.east - FIRE_EXTENT.west) / NX) * cosine * METERS_PER_DEGREE;
const cellHeight = ((FIRE_EXTENT.north - FIRE_EXTENT.south) / NY) * METERS_PER_DEGREE;

export function insideRing(lng: number, lat: number, ring: number[][]) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const a = ring[i];
    const b = ring[j];
    if (a[1] > lat !== b[1] > lat && lng < ((b[0] - a[0]) * (lat - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

const column = (lng: number) => Math.floor(((lng - FIRE_EXTENT.west) / (FIRE_EXTENT.east - FIRE_EXTENT.west)) * NX);
const row = (lat: number) => Math.floor(((FIRE_EXTENT.north - lat) / (FIRE_EXTENT.north - FIRE_EXTENT.south)) * NY);
const cellLng = (i: number) => FIRE_EXTENT.west + ((i + 0.5) / NX) * (FIRE_EXTENT.east - FIRE_EXTENT.west);
const cellLat = (j: number) => FIRE_EXTENT.north - ((j + 0.5) / NY) * (FIRE_EXTENT.north - FIRE_EXTENT.south);
const cellAt = (lng: number, lat: number) => {
  const i = column(lng);
  const j = row(lat);
  return i >= 0 && i < NX && j >= 0 && j < NY ? j * NX + i : -1;
};

let fuelGrid: { fuel: Float32Array; nearWood: Uint8Array } | null = null;

/** Fuel per cell, painted lowest priority first so buildings, streets and water win. */
function fuels() {
  if (fuelGrid) return fuelGrid;
  const fuel = new Float32Array(NX * NY).fill(FUEL.residential);
  const wood = new Uint8Array(NX * NY);
  const paint = (ring: number[][], value: number, mark?: Uint8Array) => {
    const lngs = ring.map((point) => point[0]);
    const lats = ring.map((point) => point[1]);
    const i0 = Math.max(0, column(Math.min(...lngs)));
    const i1 = Math.min(NX - 1, column(Math.max(...lngs)));
    const j0 = Math.max(0, row(Math.max(...lats)));
    const j1 = Math.min(NY - 1, row(Math.min(...lats)));
    for (let j = j0; j <= j1; j += 1) {
      for (let i = i0; i <= i1; i += 1) {
        if (!insideRing(cellLng(i), cellLat(j), ring)) continue;
        fuel[j * NX + i] = value;
        if (mark) mark[j * NX + i] = 1;
      }
    }
  };
  const areas = (landuseData as { areas: { kind: string; ring: number[][] }[] }).areas;
  for (const kind of ["park", "field", "wood"] as const) {
    for (const area of areas) if (area.kind === kind) paint(area.ring, FUEL[kind], kind === "wood" ? wood : undefined);
  }
  for (const street of (streetData as { streets: { kind: string; line: number[][] }[] }).streets) {
    const arterial = ARTERIAL.has(street.kind);
    for (let k = 1; k < street.line.length; k += 1) {
      const [a, b] = [street.line[k - 1], street.line[k]];
      const steps = Math.ceil((Math.hypot((b[0] - a[0]) * cosine, b[1] - a[1]) * METERS_PER_DEGREE) / 4);
      for (let s = 0; s <= steps; s += 1) {
        const lng = a[0] + ((b[0] - a[0]) * s) / Math.max(steps, 1);
        const lat = a[1] + ((b[1] - a[1]) * s) / Math.max(steps, 1);
        const i = column(lng);
        const j = row(lat);
        // Wide roads are a real firebreak, so they cover the neighboring cells too.
        const reach = arterial ? 1 : 0;
        for (let dj = -reach; dj <= reach; dj += 1) {
          for (let di = -reach; di <= reach; di += 1) {
            const ii = i + di;
            const jj = j + dj;
            if (ii >= 0 && ii < NX && jj >= 0 && jj < NY) fuel[jj * NX + ii] = Math.min(fuel[jj * NX + ii], arterial ? FUEL.arterial : FUEL.street);
          }
        }
      }
    }
  }
  for (const feature of (buildingData as { features: { geometry: { coordinates: number[][][] } }[] }).features) {
    paint(feature.geometry.coordinates[0], FUEL.building);
  }
  for (const area of areas) if (area.kind === "water") paint(area.ring, FUEL.water);

  // Breadth-first distance from wooded cells, in cells.
  const reach = Math.ceil(WOOD_REACH / Math.min(cellWidth, cellHeight));
  const steps = new Int16Array(NX * NY).fill(-1);
  const queue: number[] = [];
  wood.forEach((value, index) => {
    if (value) {
      steps[index] = 0;
      queue.push(index);
    }
  });
  for (let head = 0; head < queue.length; head += 1) {
    const index = queue[head];
    if (steps[index] >= reach) continue;
    const i = index % NX;
    const j = Math.floor(index / NX);
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const ii = i + di;
      const jj = j + dj;
      if (ii < 0 || ii >= NX || jj < 0 || jj >= NY || steps[jj * NX + ii] >= 0) continue;
      steps[jj * NX + ii] = steps[index] + 1;
      queue.push(jj * NX + ii);
    }
  }
  const nearWood = new Uint8Array(NX * NY);
  steps.forEach((value, index) => {
    nearWood[index] = value >= 0 ? 1 : 0;
  });
  fuelGrid = { fuel, nearWood };
  return fuelGrid;
}

/** Head-fire speed multiplier and length-to-breadth ratio of the spread ellipse for a wind speed. */
export function windShape(mph: number) {
  const speed = Math.max(0, mph);
  return { head: 1 + 0.25 * speed, lengthToBreadth: Math.min(4, 1 + 0.08 * speed) };
}

export type FireModel = {
  wind: Wind;
  /** Expected fire arrival in minutes, before and after the wood adjustment; Infinity if unreachable. */
  minutesAt: (lng: number, lat: number) => { arrival: number; warned: number };
  zoneAt: (lng: number, lat: number) => ZoneId | null;
  fire: MultiPolygon;
  zones: { id: Exclude<ZoneId, "fire">; label: string; minutes: number; area: MultiPolygon }[];
  /** Zone of each building in src/data/buildings.json, by feature index. */
  buildingZones: (ZoneId | null)[];
};

const models = new Map<string, FireModel>();

export function fireModel(wind: Wind = DEFAULT_WIND, ignition: LngLat = IGNITION): FireModel {
  const key = `${wind.from}|${wind.mph}|${ignition.join(",")}`;
  const cached = models.get(key);
  if (cached) return cached;
  const { fuel, nearWood } = fuels();
  const arrival = spread(fuel, wind, ignition);
  const warned = embers(arrival.map((minutes, index) => (nearWood[index] ? minutes * WOOD_PULL : minutes)));
  const zoneOf = (index: number, burning: number, early: number): ZoneId | null => {
    if (index < 0 || !Number.isFinite(early)) return null;
    if (burning <= BURNING_MINUTES) return "fire";
    return ZONES.find((zone) => early <= zone.minutes)?.id ?? null;
  };
  const minutesAt = (lng: number, lat: number) => {
    const index = cellAt(lng, lat);
    return index < 0 ? { arrival: Infinity, warned: Infinity } : { arrival: arrival[index], warned: warned[index] };
  };
  const zoneAt = (lng: number, lat: number) => {
    const index = cellAt(lng, lat);
    return index < 0 ? null : zoneOf(index, arrival[index], warned[index]);
  };
  const buildingZones = (buildingData as { features: { geometry: { coordinates: number[][][] } }[] }).features.map((feature) => {
    const ring = feature.geometry.coordinates[0].slice(0, -1);
    return zoneAt(ring.reduce((sum, p) => sum + p[0], 0) / ring.length, ring.reduce((sum, p) => sum + p[1], 0) / ring.length);
  });
  const model: FireModel = {
    wind,
    minutesAt,
    zoneAt,
    fire: outline(arrival, BURNING_MINUTES),
    zones: ZONES.map((zone) => ({ ...zone, area: outline(warned, zone.minutes) })),
    buildingZones,
  };
  models.set(key, model);
  return model;
}

/** Each cell takes the earliest warning time within ember reach, so zones buffer the projected spread. */
function embers(minutes: Float64Array) {
  const reach = EMBER_REACH / Math.min(cellWidth, cellHeight);
  const span = Math.ceil(reach);
  const offsets: [number, number][] = [];
  for (let dj = -span; dj <= span; dj += 1) {
    for (let di = -span; di <= span; di += 1) if (Math.hypot(di * cellWidth, dj * cellHeight) <= EMBER_REACH) offsets.push([di, dj]);
  }
  const buffered = new Float64Array(minutes.length);
  for (let j = 0; j < NY; j += 1) {
    for (let i = 0; i < NX; i += 1) {
      let earliest = minutes[j * NX + i];
      for (const [di, dj] of offsets) {
        const ii = i + di;
        const jj = j + dj;
        if (ii >= 0 && ii < NX && jj >= 0 && jj < NY && minutes[jj * NX + ii] < earliest) earliest = minutes[jj * NX + ii];
      }
      buffered[j * NX + i] = earliest;
    }
  }
  return buffered;
}

/** Minimum travel time from the ignition cells over a 16-direction grid (Dijkstra). */
function spread(fuel: Float32Array, wind: Wind, ignition: LngLat) {
  const minutes = new Float64Array(NX * NY).fill(Infinity);
  const { head, lengthToBreadth } = windShape(wind.mph);
  const eccentricity = Math.sqrt(1 - 1 / lengthToBreadth ** 2);
  const toward = (((wind.from + 180) % 360) * Math.PI) / 180;
  const heap = new MinHeap();
  const start = cellAt(ignition[0], ignition[1]);
  if (start < 0) return minutes;
  const si = start % NX;
  const sj = Math.floor(start / NX);
  for (let dj = -2; dj <= 2; dj += 1) {
    for (let di = -2; di <= 2; di += 1) {
      const i = si + di;
      const j = sj + dj;
      if (i < 0 || i >= NX || j < 0 || j >= NY || !fuel[j * NX + i]) continue;
      minutes[j * NX + i] = 0;
      heap.push(0, j * NX + i);
    }
  }
  // 16 directions (neighbors plus knight's moves) keep the grid from bending fire onto 45° lines.
  // A knight's move also burns through the two cells it crosses, so it cannot hop a street or a pond.
  const offsets = [-2, -1, 0, 1, 2].flatMap((di) => [-2, -1, 0, 1, 2].map((dj) => [di, dj]))
    .filter(([di, dj]) => Math.max(Math.abs(di), Math.abs(dj)) === 1 || Math.abs(di) + Math.abs(dj) === 3);
  const moves = offsets.map(([di, dj]) => {
    const via = Math.abs(di) === 2 ? [[di / 2, 0], [di / 2, dj]] : Math.abs(dj) === 2 ? [[0, dj / 2], [di, dj / 2]] : [];
    const east = di * cellWidth;
    const north = -dj * cellHeight;
    const bearing = Math.atan2(east, north);
    // Elliptical spread from the rear focus: full head-fire speed downwind, slowest backing into the wind.
    const shape = (1 - eccentricity) / (1 - eccentricity * Math.cos(bearing - toward));
    return { di, dj, via, meters: Math.hypot(east, north), rate: BASE_SPREAD * head * shape };
  });
  while (heap.size) {
    const [time, index] = heap.pop();
    if (time > minutes[index]) continue;
    const i = index % NX;
    const j = Math.floor(index / NX);
    for (const move of moves) {
      const ii = i + move.di;
      const jj = j + move.dj;
      if (ii < 0 || ii >= NX || jj < 0 || jj >= NY) continue;
      const next = jj * NX + ii;
      if (!fuel[next] || move.via.some(([vi, vj]) => !fuel[(j + vj) * NX + i + vi])) continue;
      const crossed = move.via.reduce((sum, [vi, vj]) => sum + fuel[(j + vj) * NX + i + vi], 0);
      const burn = (fuel[index] + fuel[next] + crossed) / (2 + move.via.length);
      const arrive = time + move.meters / (move.rate * burn);
      if (arrive < minutes[next]) {
        minutes[next] = arrive;
        heap.push(arrive, next);
      }
    }
  }
  return minutes;
}

/** Everything reached within `limit` minutes, as lng/lat polygons. */
function outline(minutes: ArrayLike<number>, limit: number): MultiPolygon {
  // Contours enclose values at or above the threshold, so negate time; unreachable cells sit far below.
  const values = Array.from(minutes, (value) => (Number.isFinite(value) ? -value : -1e6));
  const [shape] = contours().size([NX, NY]).thresholds([-limit])(values);
  return shape.coordinates.map((polygon) =>
    polygon.map((ring) => ring.map(([x, y]) => [
      FIRE_EXTENT.west + (x / NX) * (FIRE_EXTENT.east - FIRE_EXTENT.west),
      FIRE_EXTENT.north - (y / NY) * (FIRE_EXTENT.north - FIRE_EXTENT.south),
    ] as LngLat)),
  );
}

class MinHeap {
  private keys: number[] = [];
  private values: number[] = [];
  get size() {
    return this.keys.length;
  }
  push(key: number, value: number) {
    const { keys, values } = this;
    let at = keys.length;
    keys.push(key);
    values.push(value);
    while (at > 0) {
      const parent = (at - 1) >> 1;
      if (keys[parent] <= key) break;
      keys[at] = keys[parent];
      values[at] = values[parent];
      at = parent;
    }
    keys[at] = key;
    values[at] = value;
  }
  pop(): [number, number] {
    const { keys, values } = this;
    const top: [number, number] = [keys[0], values[0]];
    const lastKey = keys.pop()!;
    const lastValue = values.pop()!;
    if (keys.length) {
      let at = 0;
      while (true) {
        let child = at * 2 + 1;
        if (child >= keys.length) break;
        if (child + 1 < keys.length && keys[child + 1] < keys[child]) child += 1;
        if (keys[child] >= lastKey) break;
        keys[at] = keys[child];
        values[at] = values[child];
        at = child;
      }
      keys[at] = lastKey;
      values[at] = lastValue;
    }
    return top;
  }
}
