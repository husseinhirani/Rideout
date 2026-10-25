import fs from "node:fs/promises";

// Spread drill starting positions across the whole neighborhood: farthest-point sampling over
// mapped building centroids, so every prefix of the list is already well spread.
// Usage: node scripts/drill-positions.mjs [count]  (paste the output into server/mock/evacuation.ts)
const count = Number(process.argv[2] ?? 20);
const buildings = JSON.parse(await fs.readFile(new URL("../src/data/buildings.json", import.meta.url), "utf8"));
const place = JSON.parse(await fs.readFile(new URL("../src/data/place.json", import.meta.url), "utf8"));
const middleLng = (place.west + place.east) / 2;
const middleLat = (place.south + place.north) / 2;
const cosine = Math.cos((middleLat * Math.PI) / 180);

const spots = buildings.features.map((feature) => {
  const ring = feature.geometry.coordinates[0];
  const points = ring.slice(0, -1);
  return {
    id: feature.id,
    lng: points.reduce((sum, point) => sum + point[0], 0) / points.length,
    lat: points.reduce((sum, point) => sum + point[1], 0) / points.length,
  };
});
const meters = (a, b) => Math.hypot((a.lng - b.lng) * cosine, a.lat - b.lat) * 111195;

// Start next to the middle of the block, then keep taking the footprint farthest from everything chosen.
const chosen = [spots.reduce((best, spot) => (meters(spot, { lng: middleLng, lat: middleLat }) < meters(best, { lng: middleLng, lat: middleLat }) ? spot : best))];
while (chosen.length < Math.min(count, spots.length)) {
  let best = null;
  let bestGap = -1;
  for (const spot of spots) {
    const gap = Math.min(...chosen.map((other) => meters(spot, other)));
    if (gap > bestGap) {
      best = spot;
      bestGap = gap;
    }
  }
  chosen.push(best);
}

const round = (value) => Number(value.toFixed(8));
const locations = chosen.map((spot, index) => {
  const zone = spot.lng < middleLng ? "west" : "east";
  return {
    id: `drill-point-${index + 1}`,
    label: `${zone === "west" ? "West" : "East"} community position ${index + 1}`,
    lat: round(spot.lat),
    lng: round(spot.lng),
    zone_id: zone,
    access: "community",
    source: `Mapped building footprint ${spot.id} in src/data/buildings.json; simulated participant placement, not a real resident location`,
  };
});
console.log(JSON.stringify(locations, null, 2));
