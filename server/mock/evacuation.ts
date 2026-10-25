import { emptyFacts, type Scenario, type Facts } from '../shared/assistance'

/** Fictional access graph, not a claim about actual roads or people's whereabouts. */
export const EVACUATION_DRILL: Scenario = {
  title: 'Rockridge community evacuation drill', drill: true,
  context: 'This is a fictional wildfire drill. Do not direct actual travel. Participants choose their imagined circumstances and one of the supplied scenario locations. Directory coordinates are not their current location. Community routes listed here are simulation assumptions, not live road guidance. Never invent travel times.',
  locations: [
    { id: 'west', label: 'West community pickup point', lat: 37.8462, lng: -122.2499, access: 'community' },
    { id: 'east', label: 'East community pickup point', lat: 37.8464, lng: -122.2459, access: 'community' },
    { id: 'ridge', label: 'Ridge restricted area', lat: 37.853, lng: -122.245, access: 'specialist' },
  ],
  community_routes: [['west','west'],['east','east'],['west','east']],
  destination: 'the fictional community reception center', follow_up_ms: 60000, max_tasks_per_person: 12,
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
