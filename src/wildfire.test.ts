import { describe, expect, it } from "vitest";
import landuse from "./data/landuse.json";
import { DEFAULT_WIND, FIRE_EXTENT, fireModel, insideRing, windShape, ZONES, type LngLat } from "./wildfire";

const middle: LngLat = [(FIRE_EXTENT.west + FIRE_EXTENT.east) / 2, (FIRE_EXTENT.south + FIRE_EXTENT.north) / 2];
const metersNorth = (meters: number) => meters / 111195;
const rank = (zone: string | null) => (zone === "fire" ? 0 : zone === null ? 9 : 1 + ZONES.findIndex((item) => item.id === zone));

describe("wildfire spread model", () => {
  it("burns downwind sooner than upwind", () => {
    const model = fireModel({ from: 0, mph: 25 }, middle);
    const downwind = model.minutesAt(middle[0], middle[1] - metersNorth(300)).arrival;
    const upwind = model.minutesAt(middle[0], middle[1] + metersNorth(300)).arrival;
    expect(downwind).toBeLessThan(upwind / 3);
  });

  it("stretches the spread further as wind picks up", () => {
    expect(windShape(40).lengthToBreadth).toBeGreaterThan(windShape(10).lengthToBreadth);
    const calm = fireModel({ from: 0, mph: 10 }, middle).minutesAt(middle[0], middle[1] - metersNorth(300)).arrival;
    const strong = fireModel({ from: 0, mph: 40 }, middle).minutesAt(middle[0], middle[1] - metersNorth(300)).arrival;
    expect(strong).toBeLessThan(calm);
  });

  it("warns land near woods earlier than its arrival time alone would", () => {
    const model = fireModel(DEFAULT_WIND);
    const wood = (landuse as { areas: { kind: string; ring: number[][] }[] }).areas.find((area) =>
      area.kind === "wood" && area.ring.every(([lng, lat]) => lng > FIRE_EXTENT.west && lng < FIRE_EXTENT.east && lat > FIRE_EXTENT.south && lat < FIRE_EXTENT.north));
    expect(wood).toBeDefined();
    const ring = wood!.ring;
    // Points halfway between the first vertex and every other one; one of them lies inside the patch.
    const inside = ring.map(([lng, lat]) => [(lng + ring[0][0]) / 2, (lat + ring[0][1]) / 2] as LngLat)
      .find(([lng, lat]) => insideRing(lng, lat, ring) && Number.isFinite(model.minutesAt(lng, lat).arrival));
    expect(inside).toBeDefined();
    const { arrival, warned } = model.minutesAt(...inside!);
    expect(warned).toBeLessThan(arrival);
  });

  it("turns the danger with the wind", () => {
    const southwestCorner: LngLat = [-122.2525, 37.8445];
    const diablo = fireModel({ from: 45, mph: 25 });
    const onshore = fireModel({ from: 225, mph: 25 });
    expect(diablo.minutesAt(...southwestCorner).arrival).toBeLessThan(onshore.minutesAt(...southwestCorner).arrival);
    expect(rank(diablo.zoneAt(...southwestCorner))).toBeLessThan(rank(onshore.zoneAt(...southwestCorner)));
  });

  it("nests zones inside one another and draws a burning perimeter", () => {
    const model = fireModel(DEFAULT_WIND);
    expect(model.fire.length).toBeGreaterThan(0);
    const counted = (id: string) => model.buildingZones.filter((zone) => rank(zone) <= rank(id)).length;
    expect(counted("now")).toBeLessThanOrEqual(counted("warning"));
    expect(counted("warning")).toBeLessThanOrEqual(counted("ready"));
    expect(counted("now")).toBeGreaterThan(0);
  });
});
