import buildingData from "./data/buildings.json";

/**
 * Demo household records for every building on the block.
 * Registered residents get hand-written details that match the drill script;
 * every other footprint gets a stable made-up household keyed on its OSM id.
 * Tomorrow: these come from the registration table instead.
 */
export type Household = {
  owner: string;
  people: number;
  vehicles: string[];
  number: number;
  address: string;
  needs?: string;
};

type Ring = number[][];
type BuildingFeature = { id?: number; geometry: { coordinates: Ring[] } };

const REGISTERED: Record<string, Omit<Household, "owner" | "number" | "address">> = {
  "Helen Cho": { people: 1, vehicles: [], needs: "Walker. Her daughter has the car." },
  "Daniel Ruiz": { people: 1, vehicles: ["Gray Honda Civic · 2 open seats"] },
  "Luis Ortega": { people: 2, vehicles: [], needs: "Wheelchair. Second-floor unit." },
  "Maya Chen": { people: 4, vehicles: ["Silver Toyota Sienna van"] },
  "Priya Shah": { people: 2, vehicles: ["White Toyota Prius"] },
  "Andre Walsh": { people: 4, vehicles: ["Blue Subaru Outback"] },
  "Naomi Berg": { people: 3, vehicles: ["Black Volvo XC60"] },
  "Chris Feldman": { people: 2, vehicles: ["Red Mazda 3"] },
  "Rosa Nguyen": { people: 5, vehicles: ["Green Toyota RAV4", "Gray Kia Soul"] },
  "Samir Patel": { people: 4, vehicles: ["White Tesla Model Y"] },
  "June Adler": { people: 1, vehicles: ["Beige Honda Fit"] },
  "Evan Brooks": { people: 3, vehicles: ["Black Ford F-150"] },
};

const FIRST = ["Alex", "Grace", "Marcus", "Lena", "Tom", "Ana", "Kevin", "Ruth", "Omar", "Jess", "Paul", "Mei", "Sean", "Carla", "Raj", "Ellen", "Hugo", "Tara", "Ben", "Ines"];
const LAST = ["Kim", "Duarte", "Fischer", "Okafor", "Lindqvist", "Morales", "Sato", "Bennett", "Haddad", "Novak", "Reyes", "Park", "O'Neill", "Gupta", "Larsen", "Wu", "Alvarez", "Price", "Tanaka", "Moreau"];
const CARS = [
  "Silver Honda Accord",
  "Blue Toyota Corolla",
  "White Subaru Forester",
  "Black BMW 3 Series",
  "Gray Hyundai Ioniq 5",
  "Red Volkswagen Golf",
  "Green Subaru Crosstrek",
  "White Ford Transit van",
  "Navy Chevy Bolt",
  "Silver Lexus RX",
];
export const STREETS = ["Lawton Ave", "Manila Ave", "Shafter Ave", "Keith Ave"];

const directory = buildDirectory();

export function householdIdsWhere(test: (home: Household) => boolean): number[] {
  return [...directory.entries()].filter(([, home]) => test(home)).map(([id]) => id);
}

export function householdFor(id: number, registeredName?: string): Household {
  const base = directory.get(id) ?? { owner: "Unknown", people: 0, vehicles: [], number: 0, address: "Address unknown" };
  const known = registeredName ? REGISTERED[registeredName] : undefined;
  return known ? { ...base, ...known, owner: registeredName as string } : base;
}

function buildDirectory() {
  const spots = (buildingData.features as BuildingFeature[]).flatMap((feature) => {
    const ring = feature.geometry.coordinates[0];
    if (!ring?.length) return [];
    const lng = ring.reduce((sum, point) => sum + point[0], 0) / ring.length;
    const lat = ring.reduce((sum, point) => sum + point[1], 0) / ring.length;
    return [{ id: feature.id ?? 0, lng, lat }];
  });
  let west = 180;
  let east = -180;
  let south = 90;
  let north = -90;
  for (const spot of spots) {
    west = Math.min(west, spot.lng);
    east = Math.max(east, spot.lng);
    south = Math.min(south, spot.lat);
    north = Math.max(north, spot.lat);
  }

  // Streets run in latitude bands; numbers climb west to east, odd on one side, even on the other.
  const taken = new Set<string>();
  const result = new Map<number, Household>();
  for (const spot of [...spots].sort((a, b) => a.lng - b.lng)) {
    const band = Math.min(STREETS.length - 1, Math.floor(((north - spot.lat) / Math.max(north - south, 1e-6)) * STREETS.length));
    const side = spot.lat - (south + ((STREETS.length - band - 0.5) / STREETS.length) * (north - south)) > 0 ? 1 : 0;
    let number = 5400 + Math.round(((spot.lng - west) / Math.max(east - west, 1e-6)) * 120) * 2 + side;
    while (taken.has(`${band}-${number}`)) number += 2;
    taken.add(`${band}-${number}`);

    const seed = hash(spot.id);
    const people = 1 + (seed % 5);
    const carCount = people === 1 ? seed % 2 : 1 + ((seed >>> 3) % 2);
    const vehicles = Array.from({ length: carCount }, (_, i) => CARS[(seed + i * 7) % CARS.length]);
    result.set(spot.id, {
      owner: `${FIRST[seed % FIRST.length]} ${LAST[(seed >>> 5) % LAST.length]}`,
      people,
      vehicles,
      number,
      address: `${number} ${STREETS[band]}`,
    });
  }
  return result;
}

function hash(value: number) {
  let x = Math.abs(value) | 0;
  x = Math.imul((x >>> 16) ^ x, 0x45d9f3b);
  x = Math.imul((x >>> 16) ^ x, 0x45d9f3b);
  return ((x >>> 16) ^ x) >>> 0;
}
