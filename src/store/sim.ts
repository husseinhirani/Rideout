import {
  CALL_ORDER,
  CALL_STAGGER_S,
  CONFIG,
  EVAC_POINT,
  HELPER_SCRIPTS,
  HOTSPOT_SCHEDULE,
  NEED_LABEL,
  RESIDENT_SCRIPTS,
  ZONE,
  initialHelpers,
  initialResidents,
} from '../data/scenario'
import { agent, interpret } from '../lib/ai'
import { alongPath, blocksAway, distanceM, type LatLng } from '../lib/geo'
import { boardingS, evaluateCandidates, legs, noMatchReason } from '../lib/matcher'
import type { Helper, LogKind, Need, Offer, Resident, SimState, Speaker } from '../types'

/**
 * All state transitions for the demo. Every function mutates a draft `SimState` in place;
 * the store clones before calling. These map one-to-one onto backend mutations
 * (Convex/SpacetimeDB) when the real backend replaces the in-browser engine.
 */

export function initialState(prev?: Pick<SimState, 'speed' | 'autopilot'>): SimState {
  return {
    phase: 'idle',
    running: false,
    t: 0,
    speed: prev?.speed ?? 6,
    autopilot: prev?.autopilot ?? false,
    residents: initialResidents(),
    helpers: initialHelpers(),
    offers: {},
    hotspots: [],
    log: [],
  }
}

let seq = 0
const uid = (p: string) => `${p}_${Date.now().toString(36)}_${(seq++).toString(36)}`
const first = (name: string) => name.split(' ')[0]

function log(s: SimState, kind: LogKind, text: string, refs: { residentId?: string; helperId?: string } = {}) {
  s.log.push({ id: uid('l'), at: s.t, kind, text, ...refs })
  if (s.log.length > 250) s.log.splice(0, s.log.length - 250)
}

function say(s: SimState, r: Resident, speaker: Speaker, line: { text: string; translation?: string }) {
  r.transcript.push({ speaker, text: line.text, translation: line.translation, at: s.t })
}

const isScripted = (s: SimState, who: { live?: boolean }) => !who.live || s.autopilot

/* ---------------------------------- controls ---------------------------------- */

export function start(s: SimState) {
  if (s.phase === 'idle') {
    s.phase = 'monitoring'
    log(s, 'system', `Monitoring NASA FIRMS satellite detections around zone ${ZONE.id} (${ZONE.name}). Fire is SIMULATED.`)
  }
  s.running = true
}

export function reset(s: SimState) {
  const fresh = initialState(s)
  for (const k of Object.keys(s) as (keyof SimState)[]) delete s[k]
  Object.assign(s, fresh)
}

export function pause(s: SimState) {
  s.running = false
}

export function setSpeed(s: SimState, speed: number) {
  s.speed = speed
}

export function setAutopilot(s: SimState, on: boolean) {
  s.autopilot = on
}

/* ---------------------------------- the clock ---------------------------------- */

export function tick(s: SimState, dt: number) {
  if (!s.running) return
  s.t += dt

  updateFire(s)
  if (s.phase === 'monitoring') maybeActivate(s)
  if (s.phase === 'activated' || s.phase === 'resolved') {
    for (const r of Object.values(s.residents)) stepResident(s, r)
    for (const o of Object.values(s.offers)) stepOffer(s, o)
    for (const h of Object.values(s.helpers)) stepHelper(s, h)
    checkResolved(s)
  }
}

function updateFire(s: SimState) {
  const before = s.hotspots.length
  for (const h of HOTSPOT_SCHEDULE) {
    if (h.appearAt <= s.t && !s.hotspots.some((x) => x.id === h.id)) {
      s.hotspots.push({ id: h.id, pos: h.pos, frp: h.frp, detectedAt: s.t })
    }
  }
  const added = s.hotspots.length - before
  if (added > 0 && (before === 0 || s.hotspots.length % 8 === 0)) {
    const nearest = nearestFireM(s, ZONE.center)
    log(
      s,
      'fire',
      before === 0
        ? `New VIIRS hotspot detected in Claremont Canyon, ${(nearest / 1000).toFixed(1)} km from the zone.`
        : `${s.hotspots.length} active hotspots. Nearest is ${(nearest / 1000).toFixed(1)} km from the zone center.`,
    )
  }
}

export function nearestFireM(s: SimState, p: LatLng) {
  let min = Infinity
  for (const h of s.hotspots) min = Math.min(min, distanceM(h.pos, p))
  return min
}

function maybeActivate(s: SimState) {
  const d = nearestFireM(s, ZONE.center)
  if (d > CONFIG.triggerKm * 1000) return
  s.phase = 'activated'
  s.activatedAt = s.t
  log(s, 'fire', `Fire within ${CONFIG.triggerKm} km of ${ZONE.name}. Zone ${ZONE.id} ACTIVATED.`)

  const helpers = Object.values(s.helpers)
  for (const h of helpers) h.status = 'leaving'
  log(s, 'helper', `Evacuation warning pushed to ${helpers.length} registered helpers — all are leaving now.`)

  const order = [...CALL_ORDER, ...Object.keys(s.residents).filter((id) => !CALL_ORDER.includes(id))]
  order.forEach((id, i) => {
    const r = s.residents[id]
    if (r) r.nextCallAt = s.t + 4 + i * CALL_STAGGER_S
  })
  log(s, 'call', `Check-in calls queued for ${order.length} residents in priority order.`)
}

/* --------------------------------- residents --------------------------------- */

function stepResident(s: SimState, r: Resident) {
  // Place a call when it's due.
  if ((r.status === 'registered' || r.status === 'no_answer') && r.nextCallAt !== undefined && s.t >= r.nextCallAt) {
    r.status = 'calling'
    r.callState = 'ringing'
    r.callStartedAt = s.t
    r.nextCallAt = undefined
    r.callAttempts += 1
    r.clarified = false
    say(s, r, 'system', { text: r.callAttempts > 1 ? `Calling again (attempt ${r.callAttempts})…` : 'Calling…' })
    log(s, 'call', `Calling ${r.name}${r.callAttempts > 1 ? ` (attempt ${r.callAttempts})` : ''}.`, { residentId: r.id })
    return
  }

  if (r.status === 'calling' && r.callStartedAt !== undefined) {
    const elapsed = s.t - r.callStartedAt
    const script = RESIDENT_SCRIPTS[r.id]
    if (r.callState === 'ringing') {
      const picksUp = isScripted(s, r) && script?.answerAfterS != null && elapsed >= 8
      if (picksUp) answerCall(s, r.id)
      else if (!r.live && (!script || script.answerAfterS === null) && elapsed >= 45) missedCall(s, r)
    } else if (r.callState === 'connected' && isScripted(s, r) && script) {
      const lastResident = r.transcript.some((x) => x.speaker === 'resident')
      if (!lastResident && elapsed >= (script.answerAfterS ?? 0)) {
        residentSays(s, r.id, script.reply, script.translation)
      }
    }
  }

  if (r.status === 'needs_help') tryMatch(s, r)
}

function missedCall(s: SimState, r: Resident) {
  r.callState = 'ended'
  say(s, r, 'system', { text: 'No answer.' })
  if (r.callAttempts < CONFIG.maxCallAttempts) {
    r.status = 'no_answer'
    r.nextCallAt = s.t + CONFIG.callRetryS
    log(s, 'call', `${r.name} didn't answer. Retrying in ${Math.round(CONFIG.callRetryS / 60)} min.`, { residentId: r.id })
  } else {
    escalate(s, r, `No answer after ${r.callAttempts} calls — ${r.needs.map((n) => NEED_LABEL[n].toLowerCase()).join(', ') || 'status unknown'}`)
  }
}

export function answerCall(s: SimState, id: string) {
  const r = s.residents[id]
  if (!r || r.status !== 'calling' || r.callState !== 'ringing') return
  r.callState = 'connected'
  say(s, r, 'agent', agent.greeting(first(r.name), r.language))
}

export function residentSays(s: SimState, id: string, text: string, translation?: string) {
  const r = s.residents[id]
  if (!r || r.callState !== 'connected' || !text.trim()) return
  r.transcript.push({ speaker: 'resident', text, translation, at: s.t })

  const result = interpret(text)
  r.interpretation = result
  const pct = Math.round(result.confidence * 100)

  if (result.canLeave === null && !r.clarified) {
    r.clarified = true
    log(s, 'ai', `Claude couldn't tell if ${r.name} can leave (${pct}% confidence). Asking again.`, { residentId: r.id })
    say(s, r, 'agent', agent.clarify(r.language))
    return
  }

  r.needs = [...new Set<Need>([...r.needs, ...result.needs])]
  r.callState = 'ended'

  if (result.canLeave) {
    r.status = 'safe'
    log(s, 'safe', `${r.name}: ${result.summary} (${pct}% confidence)`, { residentId: r.id })
    say(s, r, 'agent', agent.safe(r.language))
  } else {
    // An unclear second answer is treated as "needs help" — sending a neighbor costs minutes, not lives.
    if (result.canLeave === null) result.summary = 'Still unclear after asking twice — treating as needs help.'
    r.status = 'needs_help'
    r.waitingSince = s.t
    log(s, 'ai', `${r.name}: ${result.summary} (${pct}% confidence)`, { residentId: r.id })
    say(s, r, 'agent', agent.needsHelp(r.language, r.needs))
  }
}

/* ---------------------------------- matching ---------------------------------- */

function excludedFor(s: SimState, residentId: string) {
  return new Set(
    Object.values(s.offers)
      .filter((o) => o.residentId === residentId && (o.status === 'declined' || o.status === 'expired'))
      .map((o) => o.helperId),
  )
}

export function candidatesFor(s: SimState, r: Resident) {
  return evaluateCandidates(r, Object.values(s.helpers), s.hotspots, excludedFor(s, r.id))
}

function tryMatch(s: SimState, r: Resident) {
  const evals = candidatesFor(s, r)
  const best = evals.find((e) => e.eligible)
  if (!best) {
    // If the only problem is that good helpers are mid-request, give them a moment before escalating.
    const waitingOnBusy = evals.some((e) => {
      const fails = e.reasons.filter((x) => x.startsWith('✕'))
      return fails.length > 0 && fails.every((x) => x.includes('Busy'))
    })
    if (waitingOnBusy && s.t - (r.waitingSince ?? s.t) < CONFIG.offerTimeoutS * 2) return
    escalate(s, r, noMatchReason(evals, r))
    return
  }
  const h = s.helpers[best.helperId]
  const dist = distanceM(h.home, r.pos)
  const needBits = r.needs.filter((n) => n !== 'no_car').map((n) => NEED_LABEL[n].toLowerCase())
  const message =
    `Your neighbor ${blocksAway(dist)}, ${r.age}, can't ${r.needs.includes('no_car') ? 'drive' : 'leave alone'}` +
    `${needBits.length ? ` (${needBits.join(', ')})` : ''}. It's on your way out, about ${best.detourMin} extra minute${best.detourMin > 1 ? 's' : ''}. ` +
    `Can you pick up ${first(r.name)}?`
  const skipped = evals.filter((e) => !e.eligible && e.clearanceM < CONFIG.safetyBufferM).length
  const reasoning =
    `${first(h.name)} is leaving now and ${first(r.name)}'s home is ${best.detourMin <= 3 ? 'right on' : 'near'} the route out (+${best.detourMin} min). ` +
    best.reasons.filter((x) => x.startsWith('✓') && !x.includes('min on the way')).map((x) => x.slice(2)).join('. ') +
    '.' +
    (skipped ? ` Skipped ${skipped} helper${skipped > 1 ? 's' : ''} whose route would pass near the fire.` : '')

  const offer: Offer = {
    id: uid('o'),
    residentId: r.id,
    helperId: h.id,
    status: 'pending',
    createdAt: s.t,
    expiresAt: s.t + CONFIG.offerTimeoutS,
    detourMin: best.detourMin,
    pickupEtaMin: best.pickupEtaMin,
    message,
    reasoning,
  }
  s.offers[offer.id] = offer
  r.status = 'matching'
  h.status = 'asked'
  h.offerId = offer.id
  log(s, 'match', `Asking ${h.name} to pick up ${r.name} (+${best.detourMin} min detour).`, { residentId: r.id, helperId: h.id })
}

function stepOffer(s: SimState, o: Offer) {
  if (o.status !== 'pending') return
  const h = s.helpers[o.helperId]
  const script = HELPER_SCRIPTS[h.id]
  if (isScripted(s, h) && script && s.t - o.createdAt >= script.respondAfterS) {
    const decline = script.declines?.[o.residentId]
    respondToOffer(s, o.id, !decline, decline)
    return
  }
  if (s.t >= o.expiresAt) {
    o.status = 'expired'
    releaseHelper(h)
    const r = s.residents[o.residentId]
    r.status = 'needs_help'
    log(s, 'match', `${h.name} didn't answer in ${Math.round(CONFIG.offerTimeoutS / 60)} min. Trying the next neighbor.`, {
      residentId: r.id,
      helperId: h.id,
    })
  }
}

function releaseHelper(h: Helper) {
  h.status = 'leaving'
  h.offerId = undefined
}

export function respondToOffer(s: SimState, offerId: string, accept: boolean, reason?: string) {
  const o = s.offers[offerId]
  if (!o || o.status !== 'pending') return
  const h = s.helpers[o.helperId]
  const r = s.residents[o.residentId]

  if (!accept) {
    o.status = 'declined'
    releaseHelper(h)
    r.status = 'needs_help'
    log(s, 'match', `${h.name} can't take ${first(r.name)}${reason ? `: “${reason}”` : '.'} Trying the next neighbor.`, {
      residentId: r.id,
      helperId: h.id,
    })
    return
  }

  o.status = 'accepted'
  const { toPickup, toEvac } = legs(h, r)
  h.status = 'en_route'
  h.offerId = undefined
  h.trip = {
    residentId: r.id,
    leg1: toPickup.path,
    leg2: toEvac.path,
    startedAt: s.t,
    prepS: CONFIG.helperPrepS,
    leg1S: toPickup.durationS,
    boardS: boardingS(r),
    leg2S: toEvac.durationS,
  }
  h.vehicle.seats -= 1
  r.status = 'helper_assigned'
  r.helperId = h.id
  r.etaAt = s.t + CONFIG.helperPrepS + toPickup.durationS
  const eta = Math.max(1, Math.round((r.etaAt - s.t) / 60))
  log(s, 'helper', `${h.name} accepted. ${first(r.name)} hears who's coming — ETA ${eta} min.`, { residentId: r.id, helperId: h.id })

  // Close the loop: call the resident back.
  say(s, r, 'system', { text: 'RideOut called back.' })
  say(s, r, 'agent', agent.helperComing(first(r.name), first(h.name), h.vehicle, eta, r.language))
}

/* ---------------------------------- helpers ---------------------------------- */

function stepHelper(s: SimState, h: Helper) {
  const trip = h.trip
  if (!trip) return
  const e = s.t - trip.startedAt
  const r = s.residents[trip.residentId]
  const t1 = trip.prepS
  const t2 = t1 + trip.leg1S
  const t3 = t2 + trip.boardS
  const t4 = t3 + trip.leg2S

  if (e < t1) h.pos = trip.leg1[0]
  else if (e < t2) h.pos = alongPath(trip.leg1, (e - t1) / trip.leg1S)
  else if (e < t3) {
    h.pos = trip.leg1[trip.leg1.length - 1]
    if (r.status === 'helper_assigned') {
      log(s, 'helper', `${h.name} arrived at ${r.address}. Helping ${first(r.name)} into the car.`, { residentId: r.id, helperId: h.id })
      r.status = 'picked_up'
      r.etaAt = undefined
      say(s, r, 'agent', agent.pickedUp(r.language))
    }
  } else if (e < t4) {
    h.status = 'carrying'
    h.pos = alongPath(trip.leg2, (e - t3) / trip.leg2S)
  } else {
    h.pos = trip.leg2[trip.leg2.length - 1]
    h.status = 'evacuated'
    h.trip = undefined
    r.status = 'evacuated'
    r.pos = EVAC_POINT.pos
    log(s, 'safe', `${r.name} and ${h.name} reached ${EVAC_POINT.name}.`, { residentId: r.id, helperId: h.id })
  }
}

/* --------------------------------- escalation --------------------------------- */

function escalate(s: SimState, r: Resident, reason: string) {
  r.status = 'escalated'
  r.escalation = { reason, at: s.t }
  if (r.waitingSince === undefined) r.waitingSince = s.t
  if (r.callState !== 'ringing' && r.transcript.some((x) => x.speaker === 'resident')) {
    say(s, r, 'agent', agent.escalated(first(r.name), r.language))
  }
  log(s, 'escalate', `Escalated ${r.name} to responders: ${reason}.`, { residentId: r.id })
}

export function acknowledgeEscalation(s: SimState, id: string) {
  const r = s.residents[id]
  if (!r?.escalation || r.escalation.acknowledged) return
  r.escalation.acknowledged = true
  log(s, 'escalate', `Alameda County OES acknowledged ${r.name} — unit dispatched to ${r.address}.`, { residentId: r.id })
}

function checkResolved(s: SimState) {
  if (s.phase !== 'activated') return
  const done = Object.values(s.residents).every(
    (r) => r.status === 'safe' || r.status === 'evacuated' || (r.status === 'escalated' && r.escalation?.acknowledged),
  )
  if (done) {
    s.phase = 'resolved'
    log(s, 'system', 'Every registered resident in the zone is accounted for.')
  }
}

/* -------------------------------- registration -------------------------------- */

export function registerResident(s: SimState, r: Omit<Resident, 'status' | 'callAttempts' | 'transcript'>) {
  s.residents[r.id] = { ...r, status: 'registered', callAttempts: 0, transcript: [] }
  if (s.phase === 'activated') s.residents[r.id].nextCallAt = s.t + 3
  log(s, 'system', `${r.name} registered (${r.registeredBy}).`, { residentId: r.id })
}

export function registerHelper(s: SimState, h: Omit<Helper, 'status' | 'pos'>) {
  s.helpers[h.id] = { ...h, pos: h.home, status: s.phase === 'activated' ? 'leaving' : 'standby' }
  log(s, 'helper', `${h.name} signed up as a helper (${h.vehicle.color} ${h.vehicle.make}, ${h.vehicle.seats} seats).`, {
    helperId: h.id,
  })
}

export const reducers = {
  start,
  pause,
  reset,
  setSpeed,
  setAutopilot,
  tick,
  answerCall,
  residentSays,
  respondToOffer,
  acknowledgeEscalation,
  registerResident,
  registerHelper,
}

export type ReducerName = keyof typeof reducers
