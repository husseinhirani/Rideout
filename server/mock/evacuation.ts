import { emptyFacts, type Scenario, type Facts } from '../shared/assistance'

/** Starting positions drawn from the project's actual mapped building geometry,
 * spread across the whole neighborhood by scripts/drill-positions.mjs. Each keeps
 * its west/east zone, so community routes are unchanged. Roster order chooses a
 * position, never a helper/recipient role. A position must be confirmed during
 * the drill before matching can use it. Positions 11-20 belong to simulated neighbors. */
export const DRILL_STARTING_LOCATIONS: Scenario['locations'] = [
  {
    "id": "drill-point-1",
    "label": "West community position 1",
    "lat": 37.8462532,
    "lng": -122.2500055,
    "zone_id": "west",
    "access": "community",
    "source": "Mapped building footprint 209730410 in src/data/buildings.json; simulated participant placement, not a real resident location"
  },
  {
    "id": "drill-point-2",
    "label": "East community position 2",
    "lat": 37.84418307,
    "lng": -122.246803,
    "zone_id": "east",
    "access": "community",
    "source": "Mapped building footprint 476177056 in src/data/buildings.json; simulated participant placement, not a real resident location"
  },
  {
    "id": "drill-point-3",
    "label": "East community position 3",
    "lat": 37.84820164,
    "lng": -122.24675212,
    "zone_id": "east",
    "access": "community",
    "source": "Mapped building footprint 476176026 in src/data/buildings.json; simulated participant placement, not a real resident location"
  },
  {
    "id": "drill-point-4",
    "label": "West community position 4",
    "lat": 37.84815397,
    "lng": -122.25297194,
    "zone_id": "west",
    "access": "community",
    "source": "Mapped building footprint 476176244 in src/data/buildings.json; simulated participant placement, not a real resident location"
  },
  {
    "id": "drill-point-5",
    "label": "West community position 5",
    "lat": 37.8450654,
    "lng": -122.25297797,
    "zone_id": "west",
    "access": "community",
    "source": "Mapped building footprint 476176567 in src/data/buildings.json; simulated participant placement, not a real resident location"
  },
  {
    "id": "drill-point-6",
    "label": "West community position 6",
    "lat": 37.84413049,
    "lng": -122.25001565,
    "zone_id": "west",
    "access": "community",
    "source": "Mapped building footprint 476176900 in src/data/buildings.json; simulated participant placement, not a real resident location"
  },
  {
    "id": "drill-point-7",
    "label": "West community position 7",
    "lat": 37.8482276,
    "lng": -122.2503832,
    "zone_id": "west",
    "access": "community",
    "source": "Mapped building footprint 476176216 in src/data/buildings.json; simulated participant placement, not a real resident location"
  },
  {
    "id": "drill-point-8",
    "label": "East community position 8",
    "lat": 37.845866,
    "lng": -122.24684842,
    "zone_id": "east",
    "access": "community",
    "source": "Mapped building footprint 476176774 in src/data/buildings.json; simulated participant placement, not a real resident location"
  },
  {
    "id": "drill-point-9",
    "label": "West community position 9",
    "lat": 37.84662562,
    "lng": -122.25224776,
    "zone_id": "west",
    "access": "community",
    "source": "Mapped building footprint 220799468 in src/data/buildings.json; simulated participant placement, not a real resident location"
  },
  {
    "id": "drill-point-10",
    "label": "East community position 10",
    "lat": 37.84730785,
    "lng": -122.2485087,
    "zone_id": "east",
    "access": "community",
    "source": "Mapped building footprint 476176097 in src/data/buildings.json; simulated participant placement, not a real resident location"
  },
  {
    "id": "drill-point-11",
    "label": "East community position 11",
    "lat": 37.84503108,
    "lng": -122.24840448,
    "zone_id": "east",
    "access": "community",
    "source": "Mapped building footprint 476176730 in src/data/buildings.json; simulated participant placement, not a real resident location"
  },
  {
    "id": "drill-point-12",
    "label": "West community position 12",
    "lat": 37.8475898,
    "lng": -122.25152685,
    "zone_id": "west",
    "access": "community",
    "source": "Mapped building footprint 476176229 in src/data/buildings.json; simulated participant placement, not a real resident location"
  },
  {
    "id": "drill-point-13",
    "label": "West community position 13",
    "lat": 37.84729348,
    "lng": -122.24994355,
    "zone_id": "west",
    "access": "community",
    "source": "Mapped building footprint 1043822788 in src/data/buildings.json; simulated participant placement, not a real resident location"
  },
  {
    "id": "drill-point-14",
    "label": "East community position 14",
    "lat": 37.84822359,
    "lng": -122.24806555,
    "zone_id": "east",
    "access": "community",
    "source": "Mapped building footprint 476176056 in src/data/buildings.json; simulated participant placement, not a real resident location"
  },
  {
    "id": "drill-point-15",
    "label": "East community position 15",
    "lat": 37.8473174,
    "lng": -122.24731612,
    "zone_id": "east",
    "access": "community",
    "source": "Mapped building footprint 476176036 in src/data/buildings.json; simulated participant placement, not a real resident location"
  },
  {
    "id": "drill-point-16",
    "label": "East community position 16",
    "lat": 37.84418038,
    "lng": -122.24795071,
    "zone_id": "east",
    "access": "community",
    "source": "Mapped building footprint 476176799 in src/data/buildings.json; simulated participant placement, not a real resident location"
  },
  {
    "id": "drill-point-17",
    "label": "West community position 17",
    "lat": 37.84649505,
    "lng": -122.2511151,
    "zone_id": "west",
    "access": "community",
    "source": "Mapped building footprint 476176167 in src/data/buildings.json; simulated participant placement, not a real resident location"
  },
  {
    "id": "drill-point-18",
    "label": "West community position 18",
    "lat": 37.8472774,
    "lng": -122.25301149,
    "zone_id": "west",
    "access": "community",
    "source": "Mapped building footprint 476176251 in src/data/buildings.json; simulated participant placement, not a real resident location"
  },
  {
    "id": "drill-point-19",
    "label": "West community position 19",
    "lat": 37.84601622,
    "lng": -122.2530132,
    "zone_id": "west",
    "access": "community",
    "source": "Mapped building footprint 476176661 in src/data/buildings.json; simulated participant placement, not a real resident location"
  },
  {
    "id": "drill-point-20",
    "label": "East community position 20",
    "lat": 37.8450144,
    "lng": -122.24681727,
    "zone_id": "east",
    "access": "community",
    "source": "Mapped building footprint 476176832 in src/data/buildings.json; simulated participant placement, not a real resident location"
  }
]

/** Fictional access graph, not a claim about actual roads or people's whereabouts. */
export const EVACUATION_DRILL: Scenario = {
  title: 'Rockridge community evacuation drill', drill: true,
  context: 'This is a fictional wildfire drill. Do not direct actual travel. Participants choose their imagined circumstances. Confirm or correct their supplied fictional starting position; positions come from mapped neighborhood geometry but are not their real whereabouts. Directory coordinates are not their current location. Community routes listed here are simulation assumptions, not live road guidance. Never invent travel times.',
  locations: [
    { id: 'west', label: 'West community pickup point', lat: 37.8462, lng: -122.2499, access: 'community' },
    { id: 'east', label: 'East community pickup point', lat: 37.8464, lng: -122.2472, access: 'community' },
    ...DRILL_STARTING_LOCATIONS,
    { id: 'ridge', label: 'Ridge restricted area', lat: 37.853, lng: -122.245, access: 'specialist' },
  ],
  community_routes: [['west','west'],['east','east'],['west','east']],
  destination: 'the fictional community reception center', follow_up_ms: 60000, max_tasks_per_person: 12,
}
export const SIMULATED_NEIGHBORS: { name: string; facts: Facts }[] = [
  { name: 'Helen Cho', facts: { ...emptyFacts(), location_id:'drill-point-12', needs_transport:true,party_size:1,wheelchair:true,pets:false } },
  { name: 'Daniel Ruiz', facts: { ...emptyFacts(), location_id:'drill-point-13',needs_transport:false,can_help:true,seats:2,wheelchair_space:true,pets_allowed:true } },
  { name: 'Priya Shah', facts: { ...emptyFacts(),location_id:'ridge',needs_transport:true,party_size:1,wheelchair:false,pets:false } },
  { name: 'Grace Park', facts: { ...emptyFacts(),location_id:'drill-point-11',needs_transport:false,can_help:false,seats:0,wheelchair_space:false,pets_allowed:false } },
  { name: 'Omar Ali', facts: { ...emptyFacts(),location_id:'drill-point-14',needs_transport:true,party_size:2,wheelchair:false,pets:true } },
  { name: 'Maya Chen', facts: { ...emptyFacts(),location_id:'drill-point-17',needs_transport:false,can_help:true,seats:3,wheelchair_space:false,pets_allowed:true } },
  { name: 'Luis Romero', facts: { ...emptyFacts(),location_id:'drill-point-15',needs_transport:false,can_help:true,seats:1,wheelchair_space:false,pets_allowed:false } },
  { name: 'Nora Davis', facts: { ...emptyFacts(),location_id:'drill-point-18',needs_transport:true,party_size:2,wheelchair:false,pets:false } },
  { name: 'Sam Patel', facts: { ...emptyFacts(),location_id:'ridge',needs_transport:true,party_size:1,wheelchair:false,pets:false } },
  { name: 'Ava Reed', facts: { ...emptyFacts(),location_id:'drill-point-16',needs_transport:false,can_help:false,seats:0,wheelchair_space:false,pets_allowed:false } },
  { name: 'Ben Lewis', facts: { ...emptyFacts(),location_id:'drill-point-19',needs_transport:false,can_help:true,seats:2,wheelchair_space:false,pets_allowed:false } },
  { name: 'Iris Kim', facts: { ...emptyFacts(),location_id:'drill-point-20',needs_transport:true,party_size:1,wheelchair:false,pets:false } },
]
