import { CONFIG, ROUTES, type RouteLeg } from '../data/scenario'
import type { CandidateEval, Helper, Hotspot, Resident } from '../types'
import { distanceM, pathClearanceM, type LatLng } from './geo'

/**
 * Who should pick this person up?
 *
 * Hard rules first (safe route, room in the car, the car fits the need), then rank by how
 * little it costs the helper — the Berkeley evacuation surveys found people share rides when
 * it fits their own route and timing. Claude writes the explanation; the rules make the call,
 * so a model mistake can't send someone toward the fire.
 */

const AVG_SPEED_MPS = 6.5 // ~15 mph through hill streets

function straightLeg(a: LatLng, b: LatLng): RouteLeg {
  const d = distanceM(a, b) * 1.35
  return { durationS: Math.round(d / AVG_SPEED_MPS), distanceM: Math.round(d), path: [a, b] }
}

/** Precomputed road routes when we have them, a rough estimate for people registered live. */
export function legs(helper: Helper, resident: Resident) {
  const evac = ROUTES.evac
  return {
    direct: ROUTES.direct[helper.id] ?? straightLeg(helper.home, evac),
    toPickup: ROUTES.toPickup[helper.id]?.[resident.id] ?? straightLeg(helper.pos, resident.pos),
    toEvac: ROUTES.toEvac[resident.id] ?? straightLeg(resident.pos, evac),
  }
}

export function boardingS(resident: Resident): number {
  const b = CONFIG.boardingS
  let s = b.base
  if (resident.needs.includes('wheelchair')) s += b.wheelchair
  else if (resident.needs.includes('walker')) s += b.walker
  if (resident.needs.includes('oxygen')) s += b.oxygen
  return s
}

export function evaluateCandidates(
  resident: Resident,
  helpers: Helper[],
  hotspots: Hotspot[],
  excluded: Set<string>,
): CandidateEval[] {
  const fire = hotspots.map((h) => h.pos)

  return helpers
    .map((h): CandidateEval => {
      const reasons: string[] = []
      let eligible = true
      const fail = (r: string) => {
        eligible = false
        reasons.push('✕ ' + r)
      }
      const ok = (r: string) => reasons.push('✓ ' + r)

      const { direct, toPickup, toEvac } = legs(h, resident)
      const via = [...toPickup.path, ...toEvac.path]
      const clearanceM = fire.length ? pathClearanceM(via, fire) : Infinity
      const detourS = Math.max(0, toPickup.durationS + toEvac.durationS - direct.durationS) + boardingS(resident)
      const detourMin = Math.max(1, Math.round(detourS / 60))
      const pickupEtaMin = Math.max(1, Math.round((CONFIG.helperPrepS + toPickup.durationS) / 60))
      const dist = distanceM(h.home, resident.pos)

      if (excluded.has(h.id)) fail('Already asked for this pickup')
      if (h.status !== 'leaving') {
        fail(
          h.status === 'standby'
            ? 'Has not been warned yet'
            : h.status === 'evacuated'
              ? 'Already out of the zone'
              : 'Busy with another pickup',
        )
      }
      if (clearanceM < CONFIG.safetyBufferM) {
        fail(`Route passes ${Math.round(clearanceM)} m from active fire`)
      } else {
        ok(`Route stays ${(clearanceM / 1000).toFixed(1)} km from fire`)
      }
      if (h.vehicle.seats < 1) fail('No free seats')
      else ok(`${h.vehicle.seats} free seat${h.vehicle.seats > 1 ? 's' : ''}`)
      if (resident.needs.includes('wheelchair')) {
        if (h.vehicle.wheelchair) ok(`${h.vehicle.make} fits a folding wheelchair`)
        else fail(`${h.vehicle.make} can't take a wheelchair`)
      } else if (resident.needs.includes('walker')) {
        ok(`Walker fits in the ${h.vehicle.make}`)
      }
      if (resident.needs.includes('pets')) {
        if (h.vehicle.petsOk) ok('OK with pets')
        else fail('Can’t take pets')
      }
      ok(`+${detourMin} min on the way out`)

      const languageMatch = resident.language === 'en' || h.languages.includes(resident.language)
      if (resident.language !== 'en' && languageMatch) ok('Speaks the same language')

      // Lower is better. Detour dominates; closeness breaks ties; language is a small bonus.
      const score = detourS / 60 + dist / 1000 + (languageMatch ? 0 : 0.5)

      return { helperId: h.id, eligible, detourMin, pickupEtaMin, clearanceM, distanceM: dist, reasons, score }
    })
    .sort((a, b) => Number(b.eligible) - Number(a.eligible) || a.score - b.score)
}

/** Why nobody could be matched, in one line for the responder card. */
export function noMatchReason(evals: CandidateEval[], resident: Resident): string {
  if (evals.length === 0) return 'No registered helpers in the zone'
  const fireBlocked = evals.filter((e) => e.clearanceM < CONFIG.safetyBufferM).length
  if (fireBlocked === evals.length) return `No safe pickup route — every route passes within ${CONFIG.safetyBufferM} m of the fire`
  if (resident.needs.includes('wheelchair') && evals.every((e) => !e.eligible))
    return 'No available wheelchair-accessible vehicle'
  if (fireBlocked > evals.length / 2) return 'Fire blocks most pickup routes; remaining helpers unavailable'
  return 'No available helper accepted in time'
}
