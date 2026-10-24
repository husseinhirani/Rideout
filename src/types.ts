import type { LatLng } from './lib/geo'

export type Need = 'walker' | 'wheelchair' | 'oxygen' | 'pets' | 'hearing' | 'vision' | 'no_car'

export type Language = 'en' | 'es' | 'vi' | 'zh'

export type ResidentStatus =
  | 'registered' // nothing has happened yet
  | 'calling' // AI check-in call is ringing / in progress
  | 'no_answer' // call went unanswered, will retry
  | 'safe' // can leave on their own / has a ride
  | 'needs_help' // can't leave, waiting for a match
  | 'matching' // a helper is being asked
  | 'helper_assigned' // a helper accepted and is on the way
  | 'picked_up'
  | 'evacuated'
  | 'escalated' // handed off to responders

export type HelperStatus =
  | 'standby' // registered, no fire yet
  | 'leaving' // evacuating now, available to pick someone up
  | 'asked' // has an open request
  | 'en_route' // driving to a pickup
  | 'carrying' // has the resident in the car
  | 'evacuated'

export type Speaker = 'agent' | 'resident' | 'system'

export interface CallTurn {
  speaker: Speaker
  text: string
  /** English gloss when the line is in another language. */
  translation?: string
  at: number
}

/** What the language model pulled out of a free-form answer. */
export interface Interpretation {
  canLeave: boolean | null
  hasRide: boolean
  needs: Need[]
  summary: string
  confidence: number
  /** Short quoted phrases the decision is based on. */
  evidence: string[]
}

export interface Resident {
  id: string
  name: string
  age: number
  address: string
  pos: LatLng
  phone: string
  language: Language
  needs: Need[]
  livesAlone: boolean
  notes?: string
  registeredBy: string
  /** Driven by a teammate's phone during the demo rather than the script. */
  live?: boolean

  status: ResidentStatus
  callAttempts: number
  callState?: 'ringing' | 'connected' | 'ended'
  callStartedAt?: number
  nextCallAt?: number
  /** Already asked a clarifying question on this call. */
  clarified?: boolean
  transcript: CallTurn[]
  interpretation?: Interpretation
  helperId?: string
  /** Sim time the resident started waiting for help. */
  waitingSince?: number
  etaAt?: number
  escalation?: { reason: string; at: number; acknowledged?: boolean }
}

export interface Vehicle {
  make: string
  color: string
  seats: number
  wheelchair: boolean
  petsOk: boolean
}

export interface Helper {
  id: string
  name: string
  address: string
  home: LatLng
  pos: LatLng
  phone: string
  languages: Language[]
  vehicle: Vehicle
  live?: boolean

  status: HelperStatus
  offerId?: string
  /** Active trip: get out the door, drive to the pickup, board, drive to the evacuation point. */
  trip?: {
    residentId: string
    leg1: LatLng[]
    leg2: LatLng[]
    startedAt: number
    prepS: number
    leg1S: number
    boardS: number
    leg2S: number
  }
}

export type OfferStatus = 'pending' | 'accepted' | 'declined' | 'expired'

export interface CandidateEval {
  helperId: string
  eligible: boolean
  detourMin: number
  pickupEtaMin: number
  clearanceM: number
  distanceM: number
  reasons: string[]
  score: number
}

export interface Offer {
  id: string
  residentId: string
  helperId: string
  status: OfferStatus
  createdAt: number
  expiresAt: number
  detourMin: number
  pickupEtaMin: number
  message: string
  reasoning: string
}

export interface Hotspot {
  id: string
  pos: LatLng
  /** FIRMS-style fire radiative power, just for sizing the dot. */
  frp: number
  detectedAt: number
}

export type Phase = 'idle' | 'monitoring' | 'activated' | 'resolved'

export type LogKind = 'fire' | 'call' | 'ai' | 'match' | 'helper' | 'escalate' | 'safe' | 'system'

export interface LogEntry {
  id: string
  at: number
  kind: LogKind
  text: string
  residentId?: string
  helperId?: string
}

export interface SimState {
  phase: Phase
  running: boolean
  /** Sim seconds elapsed since the scenario started. */
  t: number
  speed: number
  autopilot: boolean
  activatedAt?: number
  residents: Record<string, Resident>
  helpers: Record<string, Helper>
  offers: Record<string, Offer>
  hotspots: Hotspot[]
  log: LogEntry[]
}
