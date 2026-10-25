import fs from "node:fs/promises";

const places = [
  { name: "Rockridge", south: 37.8442, west: -122.253, north: 37.8482, east: -122.2468 },
  { name: "Temescal", south: 37.8366, west: -122.2686, north: 37.8394, east: -122.2652 },
  { name: "Elmwood", south: 37.8566, west: -122.2616, north: 37.8594, east: -122.2582 },
];

const endpoints = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];

const USER_AGENT = "SealertCalHacks/0.1 (educational hackathon demo)";

function toFeatures(elements) {
  return elements
    .filter((element) => element.type === "way" && element.geometry?.length > 3)
    .map((element) => {
      const ring = element.geometry.map((point) => [point.lon, point.lat]);
      const first = ring[0];
      const last = ring[ring.length - 1];
      if (first[0] !== last[0] || first[1] !== last[1]) ring.push(first);
      const levels = Number(element.tags?.["building:levels"]);
      const taggedHeight = Number(String(element.tags?.height ?? "").replace(/m$/, ""));
      const jitter = 6.2 + (element.id % 5) * 0.7;
      const height = Number.isFinite(taggedHeight)
        ? taggedHeight
        : Number.isFinite(levels)
          ? levels * 3.1
          : jitter;
      let area = 0;
      for (let i = 0; i < ring.length - 1; i += 1) {
        area += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
      }
      return {
        type: "Feature",
        id: element.id,
        properties: {
          osmId: element.id,
          height: Math.max(4.5, Math.min(height, 16)),
          area: Math.abs(area),
        },
        geometry: { type: "Polygon", coordinates: [ring] },
      };
    })
    .filter((feature) => feature.properties.area > 0.000000004 && feature.properties.area < 0.000002);
}

// Fallback when every Overpass mirror is down: the main OSM API returns raw XML,
// so rebuild the same { type, id, tags, geometry } elements Overpass would give.
async function fetchOsmApi(place) {
  const url = `https://api.openstreetmap.org/api/0.6/map?bbox=${place.west},${place.south},${place.east},${place.north}`;
  const response = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!response.ok) throw new Error(`${url} ${response.status}`);
  const xml = await response.text();
  const nodes = new Map();
  for (const match of xml.matchAll(/<node id="(-?\d+)"[^>]*?lat="([-\d.]+)" lon="([-\d.]+)"/g)) {
    nodes.set(match[1], { lat: Number(match[2]), lon: Number(match[3]) });
  }
  const elements = [];
  for (const match of xml.matchAll(/<way id="(\d+)"[^>]*>([\s\S]*?)<\/way>/g)) {
    const tags = Object.fromEntries([...match[2].matchAll(/<tag k="([^"]*)" v="([^"]*)"/g)].map((tag) => [tag[1], tag[2]]));
    if (!tags.building) continue;
    const geometry = [...match[2].matchAll(/<nd ref="(-?\d+)"/g)].map((nd) => nodes.get(nd[1]));
    if (geometry.some((point) => !point)) continue;
    elements.push({ type: "way", id: Number(match[1]), tags, geometry });
  }
  return { features: toFeatures(elements), endpoint: "api.openstreetmap.org" };
}

async function fetchPlace(place) {
  const query = `[out:json][timeout:50];
way["building"](${place.south},${place.west},${place.north},${place.east});
out geom;`;
  let lastError = "no attempt";
  for (const endpoint of endpoints) {
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
          "User-Agent": USER_AGENT,
        },
        body: new URLSearchParams({ data: query }),
        signal: AbortSignal.timeout(30000),
      });
      if (!response.ok) {
        lastError = `${endpoint} ${response.status}`;
        continue;
      }
      const payload = await response.json();
      return { features: toFeatures(payload.elements ?? []), endpoint };
    } catch (error) {
      lastError = `${endpoint} ${error.message}`;
    }
  }
  console.warn(`Overpass failed (${lastError}), trying the OSM API`);
  return fetchOsmApi(place);
}

await fs.mkdir(new URL("../src/data/", import.meta.url), { recursive: true });

let best = null;
for (const place of places) {
  const result = await fetchPlace(place);
  console.log(`${place.name}: ${result.features.length} from ${result.endpoint}`);
  if (!best || result.features.length > best.features.length) best = { place, ...result };
  if (result.features.length >= 40) break;
}

const collection = { type: "FeatureCollection", features: best.features };
await fs.writeFile(new URL("../src/data/buildings.json", import.meta.url), JSON.stringify(collection));
await fs.writeFile(
  new URL("../src/data/place.json", import.meta.url),
  JSON.stringify({
    name: best.place.name,
    south: best.place.south,
    west: best.place.west,
    north: best.place.north,
    east: best.place.east,
  }, null, 2),
);
console.log(`kept ${best.place.name} (${best.features.length})`);
