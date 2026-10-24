import L from 'leaflet'
import { Fragment, useEffect, useMemo } from 'react'
import { Circle, MapContainer, Marker, Polygon, Polyline, Tooltip, useMap } from 'react-leaflet'
import { CONFIG, EVAC_POINT, ZONE } from '../data/scenario'
import { convexHull, slicePathFrom, type LatLng } from '../lib/geo'
import { useSim, useStore } from '../store/store'
import type { Helper, Resident } from '../types'
import BaseTiles from './BaseTiles'
import { HELPER_STATUS, RESIDENT_STATUS } from './ui'

const iconCache = new Map<string, L.DivIcon>()
function cached(key: string, make: () => L.DivIcon) {
  let icon = iconCache.get(key)
  if (!icon) {
    icon = make()
    iconCache.set(key, icon)
  }
  return icon
}

function residentIcon(r: Resident, selected: boolean) {
  const meta = RESIDENT_STATUS[r.status]
  const initial = r.name[0]
  return cached(`r:${r.status}:${selected}:${initial}`, () =>
    L.divIcon({
      className: '',
      iconSize: [40, 40],
      iconAnchor: [20, 20],
      html: `<div class="ro-pin ${selected ? 'selected' : ''}" style="--c:${meta.color}">${
        meta.urgent ? '<span class="pulse"></span>' : ''
      }<span class="dot">${initial}</span></div>`,
    }),
  )
}

const CAR_SVG =
  '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.4 2.9A3.7 3.7 0 0 0 2 12v4c0 .6.4 1 1 1h2"/><circle cx="7" cy="17" r="2"/><path d="M9 17h6"/><circle cx="17" cy="17" r="2"/></svg>'

function helperIcon(h: Helper) {
  const color = HELPER_STATUS[h.status].color
  return cached(`h:${h.status}`, () =>
    L.divIcon({
      className: '',
      iconSize: [32, 32],
      iconAnchor: [16, 16],
      html: `<div class="ro-car" style="--c:${color}"><div class="body">${CAR_SVG}</div></div>`,
    }),
  )
}

function fireIcon(frp: number) {
  const size = Math.round(14 + Math.min(frp, 44) * 0.45)
  return cached(`f:${size}`, () =>
    L.divIcon({ className: '', iconSize: [size, size], iconAnchor: [size / 2, size / 2], html: `<div class="ro-fire" style="width:${size}px;height:${size}px"></div>` }),
  )
}

const evacIcon = L.divIcon({
  className: '',
  iconSize: [30, 30],
  iconAnchor: [15, 15],
  html: `<div style="width:30px;height:30px;border-radius:8px;background:#22c55e;border:2px solid #0b0d10;box-shadow:0 0 0 1.5px #22c55e,0 2px 10px rgba(0,0,0,.6);display:grid;place-items:center;color:#0b0d10"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" x2="4" y1="22" y2="15"/></svg></div>`,
})

/** Where along its trip a helper is, so the map draws only the road still ahead. */
function remainingTrip(h: Helper, t: number): { toPickup: LatLng[]; toEvac: LatLng[] } | null {
  const trip = h.trip
  if (!trip) return null
  const e = t - trip.startedAt
  const t1 = trip.prepS
  const t2 = t1 + trip.leg1S
  const t3 = t2 + trip.boardS
  if (e < t1) return { toPickup: trip.leg1, toEvac: trip.leg2 }
  if (e < t2) return { toPickup: slicePathFrom(trip.leg1, (e - t1) / trip.leg1S), toEvac: trip.leg2 }
  if (e < t3) return { toPickup: [], toEvac: trip.leg2 }
  return { toPickup: [], toEvac: slicePathFrom(trip.leg2, (e - t3) / trip.leg2S) }
}

function FitTo({ points, padding = 40, maxZoom = 16 }: { points: LatLng[]; padding?: number; maxZoom?: number }) {
  const map = useMap()
  const key = points.map((p) => p.join(',')).join('|')
  useEffect(() => {
    if (points.length === 0) return
    if (points.length === 1) map.setView(points[0], maxZoom)
    else map.fitBounds(L.latLngBounds(points), { padding: [padding, padding], maxZoom })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  return null
}

interface Props {
  variant?: 'full' | 'compact' | 'phone'
  /** Phone maps: frame just this helper and resident. */
  focus?: { helperId?: string; residentId?: string }
  className?: string
}

export default function MapView({ variant = 'full', focus, className = '' }: Props) {
  const residents = useSim((s) => s.residents)
  const helpers = useSim((s) => s.helpers)
  const offers = useSim((s) => s.offers)
  const hotspots = useSim((s) => s.hotspots)
  const phase = useSim((s) => s.phase)
  const t = useSim((s) => s.t)
  const selectedId = useStore((s) => s.selectedResidentId)
  const select = useStore((s) => s.select)

  const hull = useMemo(() => convexHull(hotspots.map((h) => h.pos)), [hotspots])
  const pendingOffers = Object.values(offers).filter((o) => o.status === 'pending')
  const isPhone = variant === 'phone'

  const focusPoints = useMemo(() => {
    if (!focus) return []
    const pts: LatLng[] = []
    if (focus.helperId && helpers[focus.helperId]) pts.push(helpers[focus.helperId].home)
    if (focus.residentId && residents[focus.residentId]) pts.push(residents[focus.residentId].pos)
    return pts
    // Re-frame only when who we're focused on changes, not every tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus?.helperId, focus?.residentId])

  const visibleResidents = Object.values(residents).filter((r) => !isPhone || r.id === focus?.residentId)
  const visibleHelpers = Object.values(helpers).filter((h) => !isPhone || h.id === focus?.helperId)

  return (
    <MapContainer
      center={ZONE.view}
      zoom={variant === 'full' ? 15 : 14.6}
      zoomSnap={0.1}
      zoomControl={!isPhone}
      attributionControl={!isPhone}
      className={`h-full w-full ${className}`}
    >
      <BaseTiles />
      {focusPoints.length > 0 && <FitTo points={focusPoints} padding={isPhone ? 36 : 60} />}

      {!isPhone && (
        <Polygon
          positions={ZONE.polygon}
          pathOptions={{
            color: phase === 'idle' || phase === 'monitoring' ? '#5d6775' : '#ffb020',
            weight: 1.5,
            dashArray: '6 6',
            fillColor: phase === 'idle' || phase === 'monitoring' ? '#5d6775' : '#ffb020',
            fillOpacity: phase === 'idle' || phase === 'monitoring' ? 0.03 : 0.06,
          }}
        >
          <Tooltip className="ro-label" direction="bottom" permanent position={[37.8548, -122.2400]}>
            Zone {ZONE.id} · {ZONE.name}
          </Tooltip>
        </Polygon>
      )}

      {!isPhone && phase === 'monitoring' && (
        <Circle
          center={ZONE.center}
          radius={CONFIG.triggerKm * 1000}
          pathOptions={{ color: '#ff5a1f', weight: 1, opacity: 0.45, dashArray: '2 8', fill: false }}
        />
      )}

      {/* Fire: safety buffer, approximate perimeter, then the satellite detections themselves. */}
      {hotspots.map((h) => (
        <Circle
          key={`b-${h.id}`}
          center={h.pos}
          radius={CONFIG.safetyBufferM}
          pathOptions={{ stroke: false, fillColor: '#ff5a1f', fillOpacity: 0.035 }}
        />
      ))}
      {hull.length >= 3 && (
        <Polygon
          positions={hull}
          pathOptions={{ color: '#ff5a1f', weight: 1.5, fillColor: '#ff5a1f', fillOpacity: 0.22 }}
        />
      )}
      {hotspots.map((h) => (
        <Marker key={h.id} position={h.pos} icon={fireIcon(h.frp)} interactive={false} />
      ))}

      <Marker position={EVAC_POINT.pos} icon={evacIcon}>
        <Tooltip className="ro-tip" direction="top" offset={[0, -14]}>
          <b>{EVAC_POINT.name}</b>
          <br />
          {EVAC_POINT.detail}
        </Tooltip>
      </Marker>

      {/* Requests in flight: who's being asked to get whom. */}
      {pendingOffers.map((o) => {
        const h = helpers[o.helperId]
        const r = residents[o.residentId]
        if (!h || !r || (isPhone && h.id !== focus?.helperId)) return null
        return (
          <Polyline
            key={o.id}
            positions={[h.pos, r.pos]}
            pathOptions={{ color: '#f59e0b', weight: 2.5, dashArray: '4 7', className: 'ro-route-active' }}
          />
        )
      })}

      {visibleHelpers.map((h) => {
        const rest = remainingTrip(h, t)
        if (!rest) return null
        return (
          <Fragment key={`trip-${h.id}`}>
            {rest.toEvac.length > 1 && (
              <Polyline positions={rest.toEvac} pathOptions={{ color: '#3b82f6', weight: 3, opacity: 0.35 }} />
            )}
            {rest.toPickup.length > 1 && (
              <Polyline
                positions={rest.toPickup}
                pathOptions={{ color: '#60a5fa', weight: 4.5, opacity: 0.95, className: 'ro-route-active' }}
              />
            )}
          </Fragment>
        )
      })}

      {visibleHelpers.map((h) => (
        <Marker key={h.id} position={h.pos} icon={helperIcon(h)} zIndexOffset={500}>
          <Tooltip className="ro-tip" direction="top" offset={[0, -14]}>
            <b>{h.name}</b> · helper
            <br />
            {h.vehicle.color} {h.vehicle.make} · {h.vehicle.seats} seat{h.vehicle.seats === 1 ? '' : 's'} free
            <br />
            <span style={{ color: HELPER_STATUS[h.status].color }}>{HELPER_STATUS[h.status].label}</span>
          </Tooltip>
        </Marker>
      ))}

      {visibleResidents.map((r) => (
        <Marker
          key={r.id}
          position={r.pos}
          icon={residentIcon(r, r.id === selectedId)}
          zIndexOffset={RESIDENT_STATUS[r.status].urgent ? 1000 : 800}
          eventHandlers={isPhone ? undefined : { click: () => select(r.id) }}
        >
          {variant !== 'phone' && (
            <Tooltip className="ro-label" direction="right" offset={[12, 0]} permanent>
              {r.name.split(' ')[0]}
            </Tooltip>
          )}
        </Marker>
      ))}
    </MapContainer>
  )
}
