import fs from "node:fs/promises";

const places = [
  { name: "Rockridge", south: 37.8442, west: -122.2516, north: 37.8468, east: -122.2482 },
  { name: "Temescal", south: 37.8366, west: -122.2686, north: 37.8394, east: -122.2652 },
  { name: "Elmwood", south: 37.8566, west: -122.2616, north: 37.8594, east: -122.2582 },
];

const endpoints = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];

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
          "User-Agent": "RideOutCalHacks/0.1 (educational hackathon demo)",
        },
        body: new URLSearchParams({ data: query }),
      });
      if (!response.ok) {
        lastError = `${endpoint} ${response.status}`;
        continue;
      }
      const payload = await response.json();
      const features = (payload.elements ?? [])
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
      return { features, endpoint };
    } catch (error) {
      lastError = `${endpoint} ${error.message}`;
    }
  }
  throw new Error(lastError);
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
