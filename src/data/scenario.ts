import type { LatLng } from '../lib/geo'
import type { Helper, Hotspot, Language, Need, Resident } from '../types'
import routes from './routes.json'

/**
 * The demo scenario: one neighborhood (Claremont hills, Berkeley), one simulated fire,
 * and a handful of residents and helpers. Road routes were precomputed with OSRM
 * (see scripts/gen-routes.mjs) so the map draws real streets without a routing API.
 * Everyone here is fictional.
 */

export interface RouteLeg {
  durationS: number
  distanceM: number
  path: LatLng[]
}

interface RouteTable {
  evac: LatLng
  direct: Record<string, RouteLeg>
  toEvac: Record<string, RouteLeg>
  toPickup: Record<string, Record<string, RouteLeg>>
}

export const ROUTES = routes as unknown as RouteTable

export const ZONE = {
  id: 'BRK-E041',
  name: 'Claremont Hills',
  center: [37.8618, -122.2392] as LatLng,
  /** Map view: nudged east so the fire is on screen alongside the homes. */
  view: [37.8632, -122.2338] as LatLng,
  polygon: [
    [37.8705, -122.2475],
    [37.8705, -122.2370],
    [37.8680, -122.2300],
    [37.8615, -122.2295],
    [37.8550, -122.2310],
    [37.8550, -122.2490],
  ] as LatLng[],
}

export const EVAC_POINT = {
  name: 'Civic Center Park',
  detail: 'Red Cross evacuation point',
  pos: ROUTES.evac,
}

export const CONFIG = {
  /** Zone activates when a satellite hotspot is detected this close to its center. */
  triggerKm: 1.8,
  /** A pickup route must stay at least this far from every active hotspot. */
  safetyBufferM: 500,
  /** How long a helper has to answer before we move on (sim seconds). */
  offerTimeoutS: 150,
  /** Retry an unanswered check-in call after this long; escalate after maxCallAttempts. */
  callRetryS: 60,
  maxCallAttempts: 2,
  /** Time for a helper to get out the door before they start driving. */
  helperPrepS: 150,
  boardingS: { base: 60, walker: 120, wheelchair: 240, oxygen: 60 } as Record<string, number>,
  /** The sim clock starts at 2:07 AM — the hour official guidance stops working. */
  clockStart: { h: 2, m: 7 },
}

type Seed<T> = Omit<T, 'status' | 'callAttempts' | 'transcript' | 'pos'> & { pos?: LatLng }

const residentSeeds: Seed<Resident>[] = [
  {
    id: 'margaret',
    name: 'Margaret Chen',
    age: 84,
    address: '2814 Gravatt Dr',
    phone: '(510) 555-0142',
    language: 'en',
    needs: ['walker', 'no_car'],
    livesAlone: true,
    notes: 'Daughter (Grace) lives in Oakland and has the car on weeknights.',
    registeredBy: 'Daughter · Grace Chen',
    live: true,
  },
  {
    id: 'harold',
    name: 'Harold Kim',
    age: 91,
    address: '3011 Stonewall Rd',
    phone: '(510) 555-0177',
    language: 'en',
    needs: ['wheelchair', 'no_car'],
    livesAlone: true,
    notes: 'Home aide visits 9 AM – 5 PM. Folding wheelchair.',
    registeredBy: 'North Berkeley Senior Center',
  },
  {
    id: 'linh',
    name: 'Linh Tran',
    age: 73,
    address: '6 Oak Ridge Rd',
    phone: '(510) 555-0119',
    language: 'vi',
    needs: ['no_car'],
    livesAlone: false,
    notes: 'Son commutes to San Jose. Prefers Vietnamese.',
    registeredBy: 'Self (by phone)',
  },
  {
    id: 'walter',
    name: 'Walter Price',
    age: 88,
    address: '1290 Gelston St',
    phone: '(510) 555-0163',
    language: 'en',
    needs: ['pets', 'no_car'],
    livesAlone: true,
    notes: 'Will not leave without his dog, Biscuit.',
    registeredBy: 'Neighbor · Tom Becker',
  },
  {
    id: 'rosa',
    name: 'Rosa Martínez',
    age: 77,
    address: '2947 Belrose Ave',
    phone: '(510) 555-0188',
    language: 'es',
    needs: ['oxygen'],
    livesAlone: false,
    notes: 'Portable oxygen concentrator. Son nearby.',
    registeredBy: 'Son · Luis Martínez',
  },
  {
    id: 'james',
    name: 'James Okafor',
    age: 68,
    address: '18 Evergreen Ln',
    phone: '(510) 555-0105',
    language: 'en',
    needs: ['vision'],
    livesAlone: true,
    notes: 'Low vision, does not drive at night.',
    registeredBy: 'Self (by phone)',
  },
  {
    id: 'esther',
    name: 'Esther Goldberg',
    age: 80,
    address: '2730 Dwight Way',
    phone: '(510) 555-0131',
    language: 'en',
    needs: ['hearing', 'pets'],
    livesAlone: true,
    notes: 'Hard of hearing — speak slowly. Has a cat.',
    registeredBy: 'Self (web)',
  },
]

const helperSeeds: Seed<Helper>[] = [
  {
    id: 'daniel',
    name: 'Daniel Reyes',
    address: '2860 Gravatt Dr',
    home: [0, 0],
    phone: '(510) 555-0210',
    languages: ['en', 'es'],
    vehicle: { make: 'Honda CR-V', color: 'gray', seats: 3, wheelchair: false, petsOk: true },
    live: true,
  },
  {
    id: 'priya',
    name: 'Priya Shah',
    address: '3150 Claremont Ave',
    home: [0, 0],
    phone: '(510) 555-0233',
    languages: ['en'],
    vehicle: { make: 'Toyota Sienna', color: 'white', seats: 4, wheelchair: true, petsOk: true },
  },
  {
    id: 'sofia',
    name: 'Sofia Alvarez',
    address: '40 Alvarado Rd',
    home: [0, 0],
    phone: '(510) 555-0251',
    languages: ['en', 'es'],
    vehicle: { make: 'Kia Soul', color: 'green', seats: 2, wheelchair: false, petsOk: false },
  },
  {
    id: 'aisha',
    name: 'Aisha Bello',
    address: '95 Vicente Rd',
    home: [0, 0],
    phone: '(510) 555-0274',
    languages: ['en'],
    vehicle: { make: 'Toyota Prius', color: 'red', seats: 3, wheelchair: false, petsOk: true },
  },
  {
    id: 'tom',
    name: 'Tom Becker',
    address: '12 Perth Pl',
    home: [0, 0],
    phone: '(510) 555-0296',
    languages: ['en'],
    vehicle: { make: 'Subaru Outback', color: 'blue', seats: 2, wheelchair: false, petsOk: true },
  },
  {
    id: 'marcus',
    name: 'Marcus Lee',
    address: '210 West View Dr',
    home: [0, 0],
    phone: '(510) 555-0218',
    languages: ['en', 'zh'],
    vehicle: { make: 'Ford F-150', color: 'black', seats: 1, wheelchair: false, petsOk: true },
  },
]

const residentPos = (routes as unknown as { residents: Record<string, LatLng> }).residents
const helperPos = (routes as unknown as { helpers: Record<string, LatLng> }).helpers

export function initialResidents(): Record<string, Resident> {
  return Object.fromEntries(
    residentSeeds.map((s) => [
      s.id,
      { ...s, pos: residentPos[s.id], status: 'registered', callAttempts: 0, transcript: [] } as Resident,
    ]),
  )
}

export function initialHelpers(): Record<string, Helper> {
  return Object.fromEntries(
    helperSeeds.map((s) => [
      s.id,
      { ...s, home: helperPos[s.id], pos: helperPos[s.id], status: 'standby' } as Helper,
    ]),
  )
}

/* ---------- Scripted behaviour for everyone not played by a teammate ---------- */

export interface ResidentScript {
  /** Sim seconds after the call starts before they answer; null = never picks up. */
  answerAfterS: number | null
  reply: string
  translation?: string
}

export const RESIDENT_SCRIPTS: Record<string, ResidentScript> = {
  margaret: {
    answerAfterS: 25,
    reply: "I use a walker and my daughter has the car. I can't get out on my own.",
  },
  harold: {
    answerAfterS: 35,
    reply: "I'm in a wheelchair. My aide went home at five. I can't get down the stairs by myself.",
  },
  linh: {
    answerAfterS: 40,
    reply: 'Tôi không có xe. Con trai tôi đi làm ở San Jose.',
    translation: "I don't have a car. My son is at work in San Jose.",
  },
  walter: {
    answerAfterS: 55,
    reply: "I can't drive anymore. And I'm not going anywhere without Biscuit.",
  },
  rosa: {
    answerAfterS: 30,
    reply: 'Sí, mi hijo ya viene por mí. Llega en diez minutos.',
    translation: 'Yes, my son is already coming for me. He arrives in ten minutes.',
  },
  james: { answerAfterS: null, reply: '' },
  esther: {
    answerAfterS: 45,
    reply: "What? Oh — yes, yes, I'm putting the cat in the car now. I'm going.",
  },
}

export interface HelperScript {
  /** Sim seconds to respond to a pickup request. */
  respondAfterS: number
  /** Residents this helper says no to, with the reason they give. */
  declines?: Record<string, string>
}

export const HELPER_SCRIPTS: Record<string, HelperScript> = {
  daniel: { respondAfterS: 40 },
  priya: { respondAfterS: 55 },
  sofia: { respondAfterS: 45, declines: { linh: 'Car is full — I have my two kids and my mom.' } },
  aisha: { respondAfterS: 50 },
  tom: { respondAfterS: 40 },
  marcus: { respondAfterS: 60 },
}

/** Order the AI agent works through the call list (priority set by the county from registration data). */
export const CALL_ORDER = ['margaret', 'harold', 'linh', 'rosa', 'walter', 'james', 'esther']
export const CALL_STAGGER_S = 12

/* ---------- Simulated satellite detections (shaped like NASA FIRMS VIIRS points) ---------- */

function mulberry32(seed: number) {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export interface ScheduledHotspot extends Omit<Hotspot, 'detectedAt'> {
  appearAt: number
}

export const HOTSPOT_SCHEDULE: ScheduledHotspot[] = (() => {
  const rand = mulberry32(41)
  const out: ScheduledHotspot[] = []
  const n = 44
  for (let i = 0; i < n; i++) {
    const appearAt = i * 20
    // The fire starts up-canyon to the east and its western edge creeps toward the homes.
    const front = -122.2165 - 0.015 * (1 - Math.exp(-appearAt / 160))
    const lng = front + rand() * 0.003
    const lat = 37.8655 + rand() * 0.0045
    out.push({ id: `fh${i}`, pos: [+lat.toFixed(5), +lng.toFixed(5)], frp: 4 + Math.round(rand() * 40), appearAt })
  }
  return out
})()

/* ---------- Display helpers ---------- */

export const LANGUAGE_LABEL: Record<Language, string> = {
  en: 'English',
  es: 'Spanish',
  vi: 'Vietnamese',
  zh: 'Cantonese',
}

export const NEED_LABEL: Record<Need, string> = {
  walker: 'Walker',
  wheelchair: 'Wheelchair',
  oxygen: 'Oxygen',
  pets: 'Pet',
  hearing: 'Hard of hearing',
  vision: 'Low vision',
  no_car: 'No car',
}
