import type { Arrangement, AssistanceState } from './assistance'

export type RouteEdge = { from: string; to: string; duration_seconds: number; source: string; valid_until?: number }
export type RouteEstimate = { approach_seconds: number; pickup_on_route: boolean | null; source: string[]; location_ids: string[]; signature: string }
export type ArrangementRouteContext = { route: Omit<RouteEstimate, 'signature'> | null; accepted_at: number | null; estimated_pickup_at: number | null }

function routingInputs(state: AssistanceState, recipientId: number, helperId: number) {
  return {
    from: state.people.find(p => p.profile_id === helperId)?.facts.location_id,
    pickup: state.people.find(p => p.profile_id === recipientId)?.facts.location_id,
    destination: state.scenario.destination_location_id,
    locations: state.scenario.locations,
    routes: state.scenario.community_routes,
    edges: state.scenario.route_edges,
  }
}

/** Supplied directed travel times only. Map distance cannot supply a travel estimate. */
export function routeEstimate(state: AssistanceState, recipientId: number, helperId: number, now = Date.now()): RouteEstimate | null {
  const input = routingInputs(state, recipientId, helperId)
  if (!input.from || !input.pickup || !input.edges?.length) return null
  const allowedLocation = (id: string) => {
    const location = state.scenario.locations.find(l => l.id === id)
    return location?.access === 'community' && (!location.zone_id || state.scenario.locations.find(l => l.id === location.zone_id)?.access === 'community')
  }
  const edges = input.edges.filter(edge => {
    if (!allowedLocation(edge.from) || !allowedLocation(edge.to) || !Number.isFinite(edge.duration_seconds) || edge.duration_seconds <= 0 || !edge.source?.trim()) return false
    if (edge.valid_until !== undefined && (!Number.isFinite(edge.valid_until) || edge.valid_until <= now)) return false
    const from = state.scenario.locations.find(l => l.id === edge.from)!, to = state.scenario.locations.find(l => l.id === edge.to)!
    return state.scenario.community_routes.some(([a,b]) => (a === (from.zone_id ?? from.id) && b === (to.zone_id ?? to.id)) || (b === (from.zone_id ?? from.id) && a === (to.zone_id ?? to.id)))
  })
  function shortest(from: string, to: string): { seconds: number; edges: RouteEdge[] } | null {
    if (!allowedLocation(from) || !allowedLocation(to)) return null
    const best = new Map<string, { seconds: number; edges: RouteEdge[] }>([[from, { seconds: 0, edges: [] }]])
    const visited = new Set<string>()
    while (true) {
      const next = [...best.entries()].filter(([id]) => !visited.has(id)).sort((a,b) => a[1].seconds-b[1].seconds)[0]
      if (!next) return null
      const [id, path] = next
      if (id === to) return path
      visited.add(id)
      for (const edge of edges.filter(edge => edge.from === id)) {
        const seconds = path.seconds + edge.duration_seconds
        if (seconds < (best.get(edge.to)?.seconds ?? Infinity)) best.set(edge.to, { seconds, edges: [...path.edges, edge] })
      }
    }
  }
  const approach = shortest(input.from, input.pickup)
  if (!approach || !approach.edges.length) return null
  const onward = input.destination ? shortest(input.pickup, input.destination) : null
  const direct = input.destination ? shortest(input.from, input.destination) : null
  return {
    approach_seconds: approach.seconds,
    pickup_on_route: onward && direct ? Math.abs(approach.seconds + onward.seconds - direct.seconds) < 1e-6 : null,
    source: [...new Set([...approach.edges, ...(onward && direct ? [...onward.edges,...direct.edges] : [])].map(edge => edge.source))],
    location_ids: [input.from, ...approach.edges.map(edge => edge.to)],
    signature: JSON.stringify(input),
  }
}

/** Spoken clock time for the incident's area, e.g. "8:05 AM". Falls back to a fixed Pacific offset where Intl time zones are unavailable. */
export function localTime(ms: number, timeZone = 'America/Los_Angeles'): string {
  try {
    return new Date(ms).toLocaleTimeString('en-US', { timeZone, hour: 'numeric', minute: '2-digit' })
  } catch {
    const d = new Date(ms - 7 * 3600_000), h = d.getUTCHours(), m = d.getUTCMinutes()
    return ((h % 12) || 12) + ':' + String(m).padStart(2, '0') + (h < 12 ? ' AM' : ' PM')
  }
}

/** Acceptance anchors a fictional departure assumption, never a report of movement. */
export function arrangementRouteContext(state: AssistanceState, arrangement: Arrangement, now = Date.now()): ArrangementRouteContext {
  const current = routeEstimate(state, arrangement.recipient_id, arrangement.helper_id, now)
  const acceptedAt = arrangement.helper_accepted_at ?? null
  const unchanged = current && arrangement.accepted_route && JSON.stringify(current) === JSON.stringify(arrangement.accepted_route)
  const route = ['cancelled','picked_up','completed'].includes(arrangement.status) ? null : arrangement.helper_accepted ? unchanged ? current : null : current
  const estimate = route && acceptedAt !== null ? acceptedAt + route.approach_seconds * 1000 : null
  const publicRoute = route ? { approach_seconds: route.approach_seconds, pickup_on_route: route.pickup_on_route, source: route.source, location_ids: route.location_ids } : null
  return { route: publicRoute, accepted_at: acceptedAt, estimated_pickup_at: estimate !== null && estimate > now ? estimate : null }
}

export function routeInstruction(state: AssistanceState, arrangement: Arrangement, now = Date.now()): string {
  const context = arrangementRouteContext(state, arrangement, now)
  if (!context.route) return ' No current supplied route estimate is available; do not invent an ETA or say the pickup is on the way.'
  const route = context.route
  const provenance = ' Supplied route source: ' + route.source.join('; ') + '.'
  const duration = ' The supplied route models about ' + Math.ceil(route.approach_seconds / 60) + ' minutes from the helper’s reported starting location to pickup.'
  const onRoute = route.pickup_on_route === true ? ' The pickup lies along a modeled shortest route to the destination; this does not establish that the helper has departed.' : ''
  const eta = context.estimated_pickup_at !== null ? ' The pickup estimate is around ' + localTime(context.estimated_pickup_at) + ' local time, assuming departure when the helper accepted at ' + localTime(context.accepted_at!) + '. Keep that original estimate; do not restart the travel clock in this callback.' : arrangement.helper_accepted ? ' There is no current pickup ETA. Do not restart the travel clock or infer arrival from elapsed time.' : ' This duration is an estimate assuming departure after acceptance, not a commitment or a report of movement.'
  return duration + onRoute + eta + provenance
}
