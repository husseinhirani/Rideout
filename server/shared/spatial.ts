import { matchReasons, requiresInformationReview } from './assistance-eligibility'
import { informationGaps } from './voice-mission'
import type { AssistanceState, Location, Participant } from './assistance'

type Coordinates = { lat: number; lng: number }
export type SpatialCandidate = { recipient_id: number; helper_id: number; distance_m: number | null; reasons: string[] }
export type SpatialMatch = { recipient_id: number; helper_id: number; distance_m: number }
export type SpatialMatching = { waiting: boolean; waiting_reason: string | null; candidates: SpatialCandidate[]; recommended: SpatialMatch[]; total_distance_m: number }

const radians = (degrees: number) => degrees * Math.PI / 180
function validCoordinates(point: Coordinates) {
  return Number.isFinite(point.lat) && Math.abs(point.lat) <= 90 && Number.isFinite(point.lng) && Math.abs(point.lng) <= 180
}
/** Geographic separation only. This is neither a drivable route nor a travel-time estimate. */
export function distanceMeters(a: Coordinates, b: Coordinates): number {
  if (!validCoordinates(a) || !validCoordinates(b)) return NaN
  const latitude = radians(b.lat - a.lat), longitude = radians(b.lng - a.lng)
  const chord = Math.sin(latitude / 2) ** 2 + Math.cos(radians(a.lat)) * Math.cos(radians(b.lat)) * Math.sin(longitude / 2) ** 2
  return 6_371_008.8 * 2 * Math.atan2(Math.sqrt(Math.min(1, chord)), Math.sqrt(Math.max(0, 1 - chord)))
}

/** A starting marker is an explicit simulation assumption, never confirmed whereabouts. */
export function participantLocation(state: AssistanceState, participant: Participant): { location: Location | null; confirmed: boolean } {
  if (participant.facts.location_id !== null) {
    return { location: state.scenario.locations.find(location => location.id === participant.facts.location_id) ?? null, confirmed: true }
  }
  // An explicit correction to unknown must remove the marker rather than revive its old seed.
  if (Object.prototype.hasOwnProperty.call(participant.sources, 'location_id')) return { location: null, confirmed: false }
  return { location: state.scenario.locations.find(location => location.id === participant.start_location_id) ?? null, confirmed: false }
}

type Edge = { to: number; reverse: number; capacity: number; cost: number; match?: SpatialMatch }
/** Successive shortest augmenting paths: maximize served recipients, then minimize total distance. */
function assign(candidates: SpatialCandidate[]): SpatialMatch[] {
  const eligible = candidates.filter((candidate): candidate is SpatialCandidate & { distance_m: number } => candidate.reasons.length === 0 && candidate.distance_m !== null)
  const recipients = [...new Set(eligible.map(candidate => candidate.recipient_id))].sort((a,b) => a-b)
  const helpers = [...new Set(eligible.map(candidate => candidate.helper_id))].sort((a,b) => a-b)
  const source = 0, helperOffset = 1 + recipients.length, sink = helperOffset + helpers.length
  const graph: Edge[][] = Array.from({ length: sink + 1 }, () => [])
  function edge(from: number, to: number, cost: number, match?: SpatialMatch) {
    graph[from].push({ to, reverse: graph[to].length, capacity: 1, cost, match })
    graph[to].push({ to: from, reverse: graph[from].length - 1, capacity: 0, cost: -cost })
  }
  recipients.forEach((_, index) => edge(source, index + 1, 0))
  helpers.forEach((_, index) => edge(helperOffset + index, sink, 0))
  eligible.sort((a,b) => a.recipient_id-b.recipient_id || a.helper_id-b.helper_id).forEach(candidate => {
    edge(recipients.indexOf(candidate.recipient_id) + 1, helperOffset + helpers.indexOf(candidate.helper_id), candidate.distance_m,
      { recipient_id: candidate.recipient_id, helper_id: candidate.helper_id, distance_m: candidate.distance_m })
  })
  while (true) {
    const distances = Array(graph.length).fill(Infinity) as number[]
    const previous: ({ from: number; index: number } | null)[] = Array(graph.length).fill(null)
    distances[source] = 0
    // Residual reverse edges have negative costs; Bellman-Ford also permits reassigning an earlier match.
    for (let pass = 0; pass < graph.length - 1; pass++) {
      let changed = false
      for (let from = 0; from < graph.length; from++) {
        if (!Number.isFinite(distances[from])) continue
        graph[from].forEach((item, index) => {
          if (item.capacity && distances[from] + item.cost < distances[item.to] - 1e-8) {
            distances[item.to] = distances[from] + item.cost; previous[item.to] = { from, index }; changed = true
          }
        })
      }
      if (!changed) break
    }
    if (!previous[sink]) break
    for (let to = sink; to !== source;) {
      const step = previous[to]!
      const item = graph[step.from][step.index]
      item.capacity--; graph[to][item.reverse].capacity++; to = step.from
    }
  }
  return graph.flatMap(edges => edges.filter(item => item.match && item.capacity === 0).map(item => item.match!))
}

export function spatialMatching(state: AssistanceState): SpatialMatching {
  const pendingInformation = state.tasks.filter(task => ['assess','needs','location','capability'].includes(task.kind)
    && ['pending','delivered'].includes(task.status)
    && state.people.some(person => person.profile_id === task.profile_id && person.consent && !person.contact_blocked && !person.unreachable && !requiresInformationReview(state,person.profile_id)))
  const candidates: SpatialCandidate[] = state.people.filter(person => person.facts.needs_transport === true).flatMap(recipient =>
    state.people.filter(helper => helper.profile_id !== recipient.profile_id).map(helper => {
      const reasons = matchReasons(state, recipient.profile_id, helper.profile_id)
      // Never substitute assigned starting points when comparing eligible matches.
      const from = state.scenario.locations.find(location => location.id === helper.facts.location_id)
      const to = state.scenario.locations.find(location => location.id === recipient.facts.location_id)
      const distance = from && to ? distanceMeters(from, to) : NaN
      if (from && to && !Number.isFinite(distance)) reasons.push('Reported location coordinates are invalid')
      return { recipient_id: recipient.profile_id, helper_id: helper.profile_id, distance_m: Number.isFinite(distance) ? distance : null, reasons }
    }))
  const incompletePeople = state.people.filter(participant => {
    if (!participant.consent || participant.contact_blocked || participant.unreachable || requiresInformationReview(state,participant.profile_id)) return false
    if (state.arrangements.some(arrangement => (['proposed','approved','accepted','confirmed','picked_up'].includes(arrangement.status) && [arrangement.recipient_id, arrangement.helper_id].includes(participant.profile_id)) || (arrangement.status === 'completed' && arrangement.recipient_id === participant.profile_id))) return false
    return informationGaps('assess',participant.facts).length > 0
  })
  const waiting = pendingInformation.length > 0 || incompletePeople.length > 0
  const recommended = waiting ? [] : assign(candidates)
  return { waiting, waiting_reason: waiting ? 'Waiting for outstanding needs, capability or location reports before comparing the available participants together. Ask about missing relevant facts unless the person declined, was not reached, or their information task is already blocked for human review.' : null,
    candidates, recommended, total_distance_m: recommended.reduce((sum, match) => sum + match.distance_m, 0) }
}
