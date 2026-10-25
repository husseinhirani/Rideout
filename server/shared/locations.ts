// The demo block the frontend draws (Rockridge, Oakland). These are fictional
// points on that block, not surveyed places. The coordinator may only assign
// helpers to these ids, and the frontend draws them from /state instead of
// inferring regions from prose.
export const BLOCK = { lat: 37.84686, lng: -122.25004, radius_m: 400 }

export const DEMO_LOCATIONS = [
  { id: "park-bench", label: "Park bench", lat: 37.8466, lng: -122.2528 },
  { id: "playground", label: "Playground", lat: 37.8476, lng: -122.2486 },
] as const
