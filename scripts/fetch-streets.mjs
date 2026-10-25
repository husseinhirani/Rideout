import fs from "node:fs/promises";

// Streets for the simple map, around the block chosen by fetch-buildings.mjs.
const place = JSON.parse(await fs.readFile(new URL("../src/data/place.json", import.meta.url), "utf8"));
const midLat = (place.south + place.north) / 2;
const midLng = (place.west + place.east) / 2;
const box = { south: midLat - 0.012, west: midLng - 0.016, north: midLat + 0.012, east: midLng + 0.016 };

const endpoints = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];

const USER_AGENT = "RideOutCalHacks/0.1 (educational hackathon demo)";
const KINDS = new Set(["motorway", "trunk", "primary", "secondary", "tertiary", "unclassified", "residential", "living_street"]);

const query = `[out:json][timeout:110];
way["highway"](${box.south},${box.west},${box.north},${box.east});
out geom;`;

let payload = null;
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
      signal: AbortSignal.timeout(120000),
    });
    if (!response.ok) {
      lastError = `${endpoint} ${response.status}`;
      continue;
    }
    payload = await response.json();
    console.log(`streets from ${endpoint}`);
    break;
  } catch (error) {
    lastError = `${endpoint} ${error.message}`;
  }
}
if (!payload) throw new Error(`Overpass failed (${lastError})`);

const round = (value) => Math.round(value * 1e6) / 1e6;
const streets = (payload.elements ?? [])
  .filter((element) => element.type === "way" && element.geometry?.length > 1 && KINDS.has(element.tags?.highway))
  .map((element) => ({
    name: element.tags.name ?? "",
    kind: element.tags.highway,
    line: element.geometry.map((point) => [round(point.lon), round(point.lat)]),
  }));

await fs.writeFile(new URL("../src/data/streets.json", import.meta.url), JSON.stringify({ streets }));
console.log(`kept ${streets.length} streets`);
