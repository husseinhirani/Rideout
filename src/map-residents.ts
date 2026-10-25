import buildingData from "./data/buildings.json";
import type { House } from "./types";

type Ring = number[][];
const buildings = buildingData.features.map(feature => {
  const rings = feature.geometry.coordinates as Ring[];
  const outer = rings[0];
  return { id: feature.id, rings, west: Math.min(...outer.map(p => p[0])), east: Math.max(...outer.map(p => p[0])),
    south: Math.min(...outer.map(p => p[1])), north: Math.max(...outer.map(p => p[1])) };
});

function contains(ring: Ring, lng: number, lat: number): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [x, y] = ring[i], [previousX, previousY] = ring[j];
    if ((y > lat) !== (previousY > lat) && lng < (previousX - x) * (lat - y) / (previousY - y) + x) inside = !inside;
  }
  return inside;
}

/** Building IDs and live profile IDs are separate namespaces. Link only by containment,
 * never by proximity: a directory position does not prove current occupancy. */
export function residentsByBuilding(houses: House[], live: boolean): Map<number, House[]> {
  const result = new Map<number, House[]>();
  for (const house of houses) {
    const buildingIds = live ? buildings.filter(b => house.lng >= b.west && house.lng <= b.east
      && house.lat >= b.south && house.lat <= b.north && contains(b.rings[0], house.lng, house.lat)
      && !b.rings.slice(1).some(hole => contains(hole, house.lng, house.lat))).map(b => b.id) : [house.id];
    for (const id of buildingIds) result.set(id, [...(result.get(id) ?? []), house]);
  }
  return result;
}
