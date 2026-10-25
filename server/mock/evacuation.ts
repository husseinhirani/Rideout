import { emptyFacts, type Scenario, type Facts } from '../shared/assistance'

/** Starting positions drawn from the project's actual mapped building geometry.
 * Roster order chooses a position, never a helper/recipient role. A position must
 * be confirmed during the drill before matching can use it. */
export const DRILL_STARTING_LOCATIONS: Scenario['locations'] = [
  {
    "id": "drill-point-1",
    "label": "West community pickup point, position 1",
    "lat": 37.8462532,
    "lng": -122.2500055,
    "zone_id": "west",
    "access": "community",
    "source": "Mapped building footprint 209730410 in src/data/buildings.json; simulated participant placement, not a real resident location"
  },
  {
    "id": "drill-point-2",
    "label": "West community pickup point, position 2",
    "lat": 37.84654777,
    "lng": -122.2496995,
    "zone_id": "west",
    "access": "community",
    "source": "Mapped building footprint 476176125 in src/data/buildings.json; simulated participant placement, not a real resident location"
  },
  {
    "id": "drill-point-3",
    "label": "East community pickup point, position 3",
    "lat": 37.84736437,
    "lng": -122.24707809,
    "zone_id": "east",
    "access": "community",
    "source": "Mapped building footprint 476176035 in src/data/buildings.json; simulated participant placement, not a real resident location"
  },
  {
    "id": "drill-point-4",
    "label": "East community pickup point, position 4",
    "lat": 37.84748935,
    "lng": -122.24729482,
    "zone_id": "east",
    "access": "community",
    "source": "Mapped building footprint 1149999262 in src/data/buildings.json; simulated participant placement, not a real resident location"
  },
  {
    "id": "drill-point-5",
    "label": "West community pickup point, position 5",
    "lat": 37.84672381,
    "lng": -122.24933027,
    "zone_id": "west",
    "access": "community",
    "source": "Mapped building footprint 476176111 in src/data/buildings.json; simulated participant placement, not a real resident location"
  },
  {
    "id": "drill-point-6",
    "label": "East community pickup point, position 6",
    "lat": 37.8473174,
    "lng": -122.24731612,
    "zone_id": "east",
    "access": "community",
    "source": "Mapped building footprint 476176036 in src/data/buildings.json; simulated participant placement, not a real resident location"
  },
  {
    "id": "drill-point-7",
    "label": "West community pickup point, position 7",
    "lat": 37.84712872,
    "lng": -122.24954152,
    "zone_id": "west",
    "access": "community",
    "source": "Mapped building footprint 476176154 in src/data/buildings.json; simulated participant placement, not a real resident location"
  },
  {
    "id": "drill-point-8",
    "label": "East community pickup point, position 8",
    "lat": 37.8473806,
    "lng": -122.24753778,
    "zone_id": "east",
    "access": "community",
    "source": "Mapped building footprint 476176038 in src/data/buildings.json; simulated participant placement, not a real resident location"
  },
  {
    "id": "drill-point-9",
    "label": "West community pickup point, position 9",
    "lat": 37.8475174,
    "lng": -122.24905019,
    "zone_id": "west",
    "access": "community",
    "source": "Mapped building footprint 209734794 in src/data/buildings.json; simulated participant placement, not a real resident location"
  },
  {
    "id": "drill-point-10",
    "label": "East community pickup point, position 10",
    "lat": 37.84775685,
    "lng": -122.2475857,
    "zone_id": "east",
    "access": "community",
    "source": "Mapped building footprint 476176046 in src/data/buildings.json; simulated participant placement, not a real resident location"
  }
]

/** Fictional access graph, not a claim about actual roads or people's whereabouts. */
export const EVACUATION_DRILL: Scenario = {
  title: 'Rockridge community evacuation drill', drill: true, immersive: true,
  context: 'A wildfire is moving toward the Rockridge neighborhood and is expected to reach it in about an hour. Residents are being asked to leave now for the community reception center at 100 Community Way. Speak about it as real and current, in one or two short sentences; never call it a drill, exercise or simulation. The person is at home.',
  evacuation_brief: {
    summary: 'A wildfire is moving toward the neighborhood and is expected to reach it in about an hour. Residents should leave now for the community reception center.',
    destination_address: '100 Community Way',
    arrival_window_minutes: 60,
    source: 'Operator-supplied evacuation exercise v2; not a live warning, shelter address or traffic forecast',
    travel_estimates: [
      { location_id: 'drill-point-1', mode: 'car', minutes: 15 },
      { location_id: 'drill-point-1', mode: 'bicycle', minutes: 75 },
      { location_id: 'drill-point-2', mode: 'car', minutes: 28 },
      { location_id: 'drill-point-2', mode: 'bicycle', minutes: 85 },
    ],
  },
  locations: [
    { id: 'west', label: 'West community pickup point', lat: 37.8462, lng: -122.2499, access: 'community' },
    { id: 'east', label: 'East community pickup point', lat: 37.8464, lng: -122.2472, access: 'community' },
    ...DRILL_STARTING_LOCATIONS,
    { id: 'ridge', label: 'Ridge restricted area', lat: 37.853, lng: -122.245, access: 'specialist' },
    { id: 'reception', label: 'Community reception center', lat: 37.8458, lng: -122.251, zone_id: 'west', access: 'community', source: 'Fictional drill destination; not a live evacuation site' },
  ],
  community_routes: [['west','west'],['east','east'],['west','east']],
  destination_location_id: 'reception',
  route_edges: [
    { from: 'drill-point-2', to: 'drill-point-1', duration_seconds: 780, source: 'Fictional drill route v1: 13-minute approach including simulated evacuation congestion and vehicle preparation; not live traffic or distance-derived timing' },
    { from: 'drill-point-1', to: 'drill-point-2', duration_seconds: 780, source: 'Fictional drill route v1: reverse approach also assumes 13 minutes including simulated congestion and preparation; not live traffic' },
    { from: 'drill-point-1', to: 'reception', duration_seconds: 900, source: 'Fictional drill route v2: fifteen-minute journey to the simulated reception center; not live road guidance' },
    { from: 'drill-point-2', to: 'reception', duration_seconds: 1680, source: 'Fictional drill route v2: 28-minute journey via position 1 to the simulated reception center; not live road guidance' },
  ],
  destination: 'the community reception center', handoff_mode: 'callback', follow_through: 'arrangement', follow_up_ms: 60000, max_tasks_per_person: 12,
}
export const SIMULATED_NEIGHBORS: { name: string; facts: Facts }[] = [
  { name: 'Helen Cho', facts: { ...emptyFacts(), location_id:'west', needs_transport:true,party_size:1,wheelchair:true,pets:false } },
  { name: 'Daniel Ruiz', facts: { ...emptyFacts(), location_id:'west',needs_transport:false,can_help:true,seats:2,wheelchair_space:true,pets_allowed:true } },
  { name: 'Priya Shah', facts: { ...emptyFacts(),location_id:'ridge',needs_transport:true,party_size:1,wheelchair:false,pets:false } },
  { name: 'Grace Park', facts: { ...emptyFacts(),location_id:'east',needs_transport:false,can_help:false,seats:0,wheelchair_space:false,pets_allowed:false } },
  { name: 'Omar Ali', facts: { ...emptyFacts(),location_id:'east',needs_transport:true,party_size:2,wheelchair:false,pets:true } },
  { name: 'Maya Chen', facts: { ...emptyFacts(),location_id:'west',needs_transport:false,can_help:true,seats:3,wheelchair_space:false,pets_allowed:true } },
  { name: 'Luis Romero', facts: { ...emptyFacts(),location_id:'east',needs_transport:false,can_help:true,seats:1,wheelchair_space:false,pets_allowed:false } },
  { name: 'Nora Davis', facts: { ...emptyFacts(),location_id:'west',needs_transport:true,party_size:2,wheelchair:false,pets:false } },
  { name: 'Sam Patel', facts: { ...emptyFacts(),location_id:'ridge',needs_transport:true,party_size:1,wheelchair:false,pets:false } },
  { name: 'Ava Reed', facts: { ...emptyFacts(),location_id:'east',needs_transport:false,can_help:false,seats:0,wheelchair_space:false,pets_allowed:false } },
  { name: 'Ben Lewis', facts: { ...emptyFacts(),location_id:'west',needs_transport:false,can_help:true,seats:2,wheelchair_space:false,pets_allowed:false } },
  { name: 'Iris Kim', facts: { ...emptyFacts(),location_id:'east',needs_transport:true,party_size:1,wheelchair:false,pets:false } },
]
