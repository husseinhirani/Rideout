import fs from "node:fs/promises";

// Parks, water and trees for the simple map, around the block chosen by fetch-buildings.mjs.
const place = JSON.parse(await fs.readFile(new URL("../src/data/place.json", import.meta.url), "utf8"));
const midLat = (place.south + place.north) / 2;
const midLng = (place.west + place.east) / 2;
const box = { south: midLat - 0.006, west: midLng - 0.008, north: midLat + 0.006, east: midLng + 0.008 };
const bbox = `${box.south},${box.west},${box.north},${box.east}`;

const endpoints = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];

const USER_AGENT = "RideOutCalHacks/0.1 (educational hackathon demo)";

const query = `[out:json][timeout:110];
(
  way["leisure"~"^(park|garden|playground|pitch|recreation_ground)$"](${bbox});
  way["landuse"~"^(grass|recreation_ground|cemetery|forest|meadow|village_green)$"](${bbox});
  way["natural"~"^(wood|scrub|grassland|water)$"](${bbox});
  way["water"](${bbox});
  node["natural"="tree"](${bbox});
);
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
    console.log(`landuse from ${endpoint}`);
    break;
  } catch (error) {
    lastError = `${endpoint} ${error.message}`;
  }
}
if (!payload) throw new Error(`Overpass failed (${lastError})`);

const round = (value) => Math.round(value * 1e6) / 1e6;
const kindOf = (tags = {}) => {
  if (tags.natural === "water" || tags.water) return "water";
  if (tags.natural === "wood" || tags.landuse === "forest" || tags.natural === "scrub") return "wood";
  // Pitches and playgrounds stay open green: no trees get scattered on them.
  if (tags.leisure === "pitch" || tags.leisure === "playground") return "field";
  return "park";
};
const areas = [];
const trees = [];
for (const element of payload.elements ?? []) {
  if (element.type === "node") {
    trees.push([round(element.lon), round(element.lat)]);
    continue;
  }
  if (element.type !== "way" || !(element.geometry?.length > 3)) continue;
  areas.push({ kind: kindOf(element.tags), ring: element.geometry.map((point) => [round(point.lon), round(point.lat)]) });
}

await fs.writeFile(new URL("../src/data/landuse.json", import.meta.url), JSON.stringify({ areas, trees }));
console.log(`kept ${areas.length} areas (${areas.filter((a) => a.kind === "water").length} water) and ${trees.length} trees`);
