import { useEffect, useId, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { Arrangement, AssistanceState } from '../server/shared/assistance';
import { distanceMeters, participantLocation } from '../server/shared/spatial';
import { COMPASS, DEFAULT_WIND, ZONES, fireModel, type MultiPolygon, type Wind, type ZoneId } from './wildfire';
import streets from './data/streets.json';
import buildings from './data/buildings.json';

export function formatDistance(meters: number): string {
  return meters < 1000 ? Math.round(meters) + ' m' : (meters / 1000).toFixed(1) + ' km';
}
export function arrangementDistance(session: AssistanceState, arrangement: Arrangement): number | null {
  const helper = session.people.find(p => p.profile_id === arrangement.helper_id);
  const recipient = session.people.find(p => p.profile_id === arrangement.recipient_id);
  if (!helper || !recipient) return null;
  const a = participantLocation(session, helper), b = participantLocation(session, recipient);
  return a.confirmed && b.confirmed && a.location && b.location ? distanceMeters(a.location, b.location) : null;
}

const ZONE_COLOR: Record<ZoneId, string> = { fire: '#9e2a1b', now: '#e5483b', warning: '#f29b38', ready: '#f2cf4a' };
const ZONE_LABEL: Record<ZoneId, string> = { fire: 'Inside fire perimeter', ...Object.fromEntries(ZONES.map(zone => [zone.id, zone.label])) as Record<Exclude<ZoneId, 'fire'>, string> };
const BUILDING_FILL: Record<ZoneId, string> = { fire: '#c9897b', now: '#eab3a6', warning: '#efcfa7', ready: '#ece2b4' };
const SPEEDS = [10, 25, 40];
const MAX_ZOOM = 8;
const SMOKE = [{ meters: 90, opacity: .2 }, { meters: 220, opacity: .13 }, { meters: 380, opacity: .08 }];

/** Geographic positions stay at their source coordinates; lines are arrangements, never invented routes. */
export function IncidentMap({ session, selectedId, onSelect, compact = false }: {
  session: AssistanceState; selectedId?: number | null; onSelect?: (id: number) => void; compact?: boolean;
}) {
  const [wholeIncident, setWholeIncident] = useState(false);
  const [localSelected, setLocalSelected] = useState<number | null>(null);
  const [wind, setWind] = useState<Wind>(DEFAULT_WIND);
  const [view, setView] = useState({ k: 1, x: 0, y: 0 });
  const svgRef = useRef<SVGSVGElement>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const dragged = useRef(false);
  const moved = useRef(0);
  const selected = selectedId ?? localSelected;
  const select = (id: number) => { if (dragged.current) return; setLocalSelected(id); onSelect?.(id); };
  const uid = useId().replace(/:/g, '');
  const clipId = 'incident-' + uid, smokeId = 'smoke-' + uid;
  const fire = useMemo(() => fireModel(wind), [wind]);
  const located = session.people.map((person, index) => ({ person, index: index + 1, ...participantLocation(session, person) }));
  const participantPoints = located.flatMap(p => p.location ? [p.location] : []);
  const points = (wholeIncident || !participantPoints.length ? [...session.scenario.locations, ...participantPoints] : participantPoints)
    .filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lng));
  const north = points.length ? Math.max(...points.map(p => p.lat)) : 1;
  const south = points.length ? Math.min(...points.map(p => p.lat)) : 0;
  const west = points.length ? Math.min(...points.map(p => p.lng)) : 0;
  const east = points.length ? Math.max(...points.map(p => p.lng)) : 1;
  const middleLat = (north + south) / 2;
  const cosine = Math.max(.01, Math.cos(middleLat * Math.PI / 180));
  const width = 760, height = compact ? 330 : 480, padding = 40;
  const xSpan = Math.max((east - west) * cosine, .001), ySpan = Math.max(north - south, .001);
  const scale = Math.min((width - padding * 2) / xSpan, (height - padding * 2) / ySpan);
  const project = (lng: number, lat: number) => ({ x: width / 2 + (lng - (west + east) / 2) * cosine * scale, y: height / 2 - (lat - middleLat) * scale });
  const path = (coordinates: number[][]) => coordinates.map(([lng, lat], index) => {
    const p = project(lng, lat); return (index ? 'L' : 'M') + p.x.toFixed(2) + ',' + p.y.toFixed(2);
  }).join(' ');
  const area = (shape: MultiPolygon) => shape.flatMap(polygon => polygon.map(ring => path(ring) + ' Z')).join(' ');
  const arrangements = session.arrangements.filter(a => a.status !== 'cancelled');
  const chosen = located.find(p => p.person.profile_id === selected);
  const areaLocations = session.scenario.locations.filter(l => !l.zone_id || l.zone_id === l.id);
  const zoneOf = (location: { lat: number; lng: number }) => fire.zoneAt(location.lng, location.lat);
  const scaleMeters = Math.max(10, Math.round(distanceMeters({lat: middleLat, lng: west}, {lat: middleLat, lng: east}) / view.k / 4 / 10) * 10);
  const scaleWidth = scaleMeters / 111195 * scale * view.k;
  // Smoke drifts downwind of the burning perimeter.
  const toward = (wind.from + 180) * Math.PI / 180;
  const drift = (meters: number) => ({ x: meters * Math.sin(toward) / 111195 * scale, y: -meters * Math.cos(toward) / 111195 * scale });
  const k = view.k, unscale = `scale(${1 / k})`;

  // Zoom keeps the map covering the frame: no zooming out past the whole map, no panning off its edge.
  const fit = (next: { k: number; x: number; y: number }) => {
    const zoom = Math.min(MAX_ZOOM, Math.max(1, next.k));
    return { k: zoom, x: Math.min(0, Math.max(width - width * zoom, next.x)), y: Math.min(0, Math.max(height - height * zoom, next.y)) };
  };
  const zoomAbout = (factor: number, at = { x: width / 2, y: height / 2 }) => setView(current => {
    const zoom = Math.min(MAX_ZOOM, Math.max(1, current.k * factor));
    return fit({ k: zoom, x: at.x - (at.x - current.x) * zoom / current.k, y: at.y - (at.y - current.y) * zoom / current.k });
  });
  const toMap = (clientX: number, clientY: number) => {
    const matrix = svgRef.current?.getScreenCTM();
    if (!matrix) return { x: width / 2, y: height / 2 };
    const point = new DOMPoint(clientX, clientY).matrixTransform(matrix.inverse());
    return { x: point.x, y: point.y };
  };
  const zoomRef = useRef({ zoomAbout, toMap });
  zoomRef.current = { zoomAbout, toMap };
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    // Zoom about the cursor: the spot under it stays put.
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      zoomRef.current.zoomAbout(Math.exp(-event.deltaY * .0025), zoomRef.current.toMap(event.clientX, event.clientY));
    };
    svg.addEventListener('wheel', onWheel, { passive: false });
    return () => svg.removeEventListener('wheel', onWheel);
  }, []);
  useEffect(() => setView({ k: 1, x: 0, y: 0 }), [wholeIncident, height]);

  const onPointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.current.size === 1) { moved.current = 0; dragged.current = false; }
  };
  const onPointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    const before = pointers.current.get(event.pointerId);
    if (!before) return;
    const after = { x: event.clientX, y: event.clientY };
    if (pointers.current.size === 2) {
      // Pinch: zoom by how far the two fingers spread, about the point between them.
      const other = [...pointers.current.entries()].find(([id]) => id !== event.pointerId)![1];
      const spread = Math.hypot(after.x - other.x, after.y - other.y) / Math.max(1, Math.hypot(before.x - other.x, before.y - other.y));
      pointers.current.set(event.pointerId, after);
      dragged.current = true;
      zoomAbout(spread, toMap((after.x + other.x) / 2, (after.y + other.y) / 2));
      return;
    }
    pointers.current.set(event.pointerId, after);
    moved.current += Math.abs(after.x - before.x) + Math.abs(after.y - before.y);
    if (moved.current < 5) return;
    if (!dragged.current) event.currentTarget.setPointerCapture(event.pointerId);
    dragged.current = true;
    const unit = width / Math.max(1, event.currentTarget.getBoundingClientRect().width);
    setView(current => fit({ ...current, x: current.x + (after.x - before.x) * unit, y: current.y + (after.y - before.y) * unit }));
  };
  const onPointerEnd = (event: ReactPointerEvent<SVGSVGElement>) => {
    pointers.current.delete(event.pointerId);
    // Let the click that ends a drag pass without selecting anyone.
    if (dragged.current && !pointers.current.size) window.setTimeout(() => { dragged.current = false; }, 0);
  };
  const turnWind = (steps: number) => setWind(current => ({ ...current, from: (current.from + steps * 45 + 360) % 360 }));

  return <section className={'incident-geography' + (compact ? ' compact' : '')} aria-label="Incident locations and proposed help">
    <header><div><h3>People and nearby help</h3><p>{session.scenario.drill ? 'Neighborhood geography · Wildfire drill' : 'Incident geography'}</p></div><div className="incident-map-tools"><button type="button" onClick={() => setWholeIncident(value => !value)}>{wholeIncident ? "Focus people" : "Whole incident"}</button><span className="incident-north" aria-label="North is up">↑ N</span></div></header>
    <div className="incident-map-frame">
      <svg ref={svgRef} className="incident-geography-map" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Geographic map with a simulated wildfire and evacuation zones. Scroll or pinch to zoom, drag to pan. Numbered markers identify participants listed below; dashed lines show proposed help, not road routes."
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerEnd} onPointerCancel={onPointerEnd}>
        <defs>
          <clipPath id={clipId}><rect width={width} height={height} rx="18" /></clipPath>
          <filter id={smokeId} x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="14" /></filter>
        </defs>
        <g clipPath={`url(#${clipId})`}>
          <rect width={width} height={height} fill="#f1f1e9" />
          <g transform={`translate(${view.x} ${view.y}) scale(${k})`}>
            <g className="incident-zones">{[...fire.zones].reverse().map(zone => <path key={zone.id} d={area(zone.area)} fill={ZONE_COLOR[zone.id]} fillOpacity=".2" fillRule="evenodd" stroke={ZONE_COLOR[zone.id]} strokeOpacity=".7" strokeWidth="1.5" vectorEffect="non-scaling-stroke"><title>{zone.label}: fire could arrive within about {zone.minutes / 60} h in this simulation</title></path>)}</g>
            <g stroke="#d7d9ca" strokeWidth=".7" vectorEffect="non-scaling-stroke">{buildings.features.map((feature, index) => {
              const zone = fire.buildingZones[index];
              return <path key={index} d={path(feature.geometry.coordinates[0]) + ' Z'} fill={zone ? BUILDING_FILL[zone] : '#e2e3d7'} />;
            })}</g>
            <g fill="none" stroke="#fff" strokeWidth={5 / Math.sqrt(k)}>{streets.streets.map((street, index) => <path key={index} d={path(street.line)}><title>{street.name || 'Mapped street'} · access not verified</title></path>)}</g>
            <g filter={`url(#${smokeId})`} fill="#6b625a">{SMOKE.map(puff => {
              const offset = drift(puff.meters);
              return <path key={puff.meters} d={area(fire.fire)} transform={`translate(${offset.x} ${offset.y})`} fillOpacity={puff.opacity} />;
            })}</g>
            <path className="incident-fire" d={area(fire.fire)} fill={ZONE_COLOR.fire} fillOpacity=".6" fillRule="evenodd" stroke="#ff6a2b" strokeWidth="2.5" vectorEffect="non-scaling-stroke"><title>Simulated fire perimeter</title></path>
            {areaLocations.map(location => {
              const p = project(location.lng, location.lat), community = location.access === 'community';
              return <g key={location.id} transform={`translate(${p.x} ${p.y}) ${unscale}`} className="incident-place">
                <rect x="-6" y="-6" width="12" height="12" transform="rotate(45)" fill={community ? '#778054' : '#b06437'} stroke="#fff" strokeWidth="2" />
                {k >= 2 && <text x="11" y="4" fontSize="11" fontWeight="650" fill="#3e4334" stroke="#fff" strokeWidth="3" paintOrder="stroke">{location.label}</text>}
                <title>{location.label}: {community ? 'community access in supplied incident data' : location.access === 'specialist' ? 'specialist only' : 'access unknown'}</title>
              </g>;
            })}
            {arrangements.map(arrangement => {
              const from = located.find(p => p.person.profile_id === arrangement.helper_id), to = located.find(p => p.person.profile_id === arrangement.recipient_id);
              if (!from?.confirmed || !to?.confirmed || !from.location || !to.location) return null;
              const a = project(from.location.lng, from.location.lat), b = project(to.location.lng, to.location.lat);
              return <line key={arrangement.id} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={arrangement.status === 'proposed' ? '#bf6c30' : '#4c6d24'} strokeWidth="4" vectorEffect="non-scaling-stroke" strokeDasharray={arrangement.status === 'proposed' ? '7 6' : undefined}><title>{from.person.name} → {to.person.name}: {arrangement.status.replace('_', ' ')} · {formatDistance(distanceMeters(from.location, to.location))} straight line</title></line>;
            })}
            {located.filter(p => p.location).map(p => {
              const point = project(p.location!.lng, p.location!.lat), isSelected = selected === p.person.profile_id, zone = zoneOf(p.location!);
              return <g key={p.person.profile_id} transform={`translate(${point.x} ${point.y}) ${unscale}`} role="button" tabIndex={0} aria-label={p.person.name + ': ' + (p.confirmed ? 'reported location' : 'unconfirmed assigned drill position') + (zone ? ', ' + ZONE_LABEL[zone] : '')} onClick={() => select(p.person.profile_id)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); select(p.person.profile_id); } }} className="incident-person-marker">
                {isSelected && <circle r="24" fill="none" stroke="#111214" strokeWidth="2" />}
                {zone && <circle r="19" fill="none" stroke={ZONE_COLOR[zone]} strokeWidth="4" />}
                <circle r="16" fill={p.confirmed ? p.person.facts.needs_transport ? '#ffb59f' : '#d5f45c' : '#fff'} stroke="#22251d" strokeWidth="2" strokeDasharray={p.confirmed ? undefined : '3 3'} />
                <text textAnchor="middle" dominantBaseline="central" fontSize="13" fontWeight="700" fill="#151714">{p.index}</text>
                <title>{p.person.name} · {p.location!.label} · {p.confirmed ? 'reported during call' : 'assigned drill position, awaiting confirmation'}{zone ? ' · ' + ZONE_LABEL[zone] : ''}</title>
              </g>;
            })}
          </g>
        </g>
        <g transform={`translate(25 ${height - 20})`} stroke="#575e4a"><path d={`M0,-5 V0 H${scaleWidth} V-5`} fill="none" /><text x="0" y="-10" stroke="none" fill="#575e4a" fontSize="11">{formatDistance(scaleMeters)}</text></g>
      </svg>
      <div className="incident-wind" role="group" aria-label="Simulated wind">
        <svg viewBox="-12 -12 24 24" aria-hidden="true"><circle r="11" fill="none" stroke="currentColor" strokeOpacity=".25" /><path d="M0,-8 L4,4 L0,1.5 L-4,4 Z" transform={`rotate(${(wind.from + 180) % 360})`} fill="currentColor" /></svg>
        <div><strong>Wind from {COMPASS[Math.round(wind.from / 45) % 8]}</strong><span>{wind.mph} mph{wind.from === 45 && wind.mph >= 25 ? ' · Diablo' : ''}</span></div>
        <div className="incident-wind-turn"><button type="button" onClick={() => turnWind(-1)} aria-label="Turn wind counterclockwise">↺</button><button type="button" onClick={() => turnWind(1)} aria-label="Turn wind clockwise">↻</button></div>
        <div className="incident-wind-speed">{SPEEDS.map(mph => <button type="button" key={mph} className={wind.mph === mph ? 'on' : ''} aria-pressed={wind.mph === mph} onClick={() => setWind(current => ({ ...current, mph }))}>{mph}</button>)}</div>
      </div>
      <div className="incident-zoom" role="group" aria-label="Zoom">
        <button type="button" onClick={() => zoomAbout(1.5)} disabled={k >= MAX_ZOOM} aria-label="Zoom in">+</button>
        <button type="button" onClick={() => zoomAbout(1 / 1.5)} disabled={k <= 1} aria-label="Zoom out">−</button>
        <button type="button" onClick={() => setView({ k: 1, x: 0, y: 0 })} disabled={k === 1} aria-label="Reset zoom">⤢</button>
      </div>
    </div>
    <div className="incident-map-key">
      <span><i className="zone fire" />Burning</span>
      {ZONES.map(zone => <span key={zone.id}><i className={'zone ' + zone.id} />{zone.label} · ≤{zone.minutes / 60} h</span>)}
      <span><i className="start" />Unconfirmed start</span><span><i className="reported" />Reported location</span><span><i className="proposal" />Proposed help</span><span><i className="agreed" />Approved arrangement</span>
    </div>
    <div className="incident-person-list">{located.map(p => {
      const zone = p.location ? zoneOf(p.location) : null;
      return <button type="button" key={p.person.profile_id} className={selected === p.person.profile_id ? 'selected' : ''} onClick={() => select(p.person.profile_id)}>
        <b style={zone ? { boxShadow: `0 0 0 3px ${ZONE_COLOR[zone]}` } : undefined}>{p.index}</b><span><strong>{p.person.name}</strong><small>{p.location ? p.confirmed ? 'Reported: ' + p.location.label : 'Assigned drill position · awaiting confirmation' : 'Location unknown · not placed on map'}{zone ? ' · ' + ZONE_LABEL[zone] : ''}</small></span>
      </button>;
    })}</div>
    {chosen && <p className="incident-selected-location"><b>{chosen.person.name}:</b> {chosen.location ? `${chosen.location.label} · ${chosen.location.lat.toFixed(5)}, ${chosen.location.lng.toFixed(5)} · ${chosen.confirmed ? 'participant-reported' : 'assigned drill position, not yet confirmed'}` : 'Current location is unknown. Earlier starting coordinates are not used for matching.'}</p>}
    {chosen?.location?.source && <p className="incident-map-note">Location source: {chosen.location.source.replace(" in src/data/buildings.json", "").replace("simulated participant placement", "assigned drill position")}</p>}
    <p className="incident-map-note">{wholeIncident ? "Showing all supplied incident locations." : "Map focused on participant positions. Choose Whole incident to include every supplied location."} Scroll or pinch to zoom; drag to pan.</p>
    <div className="incident-access-key">{areaLocations.map(location => <span key={location.id}><b>{location.label}</b> · {location.access === 'community' ? 'Community access' : location.access === 'specialist' ? 'Specialist only' : 'Access unknown'}</span>)}</div>
    <p className="incident-map-note">Fire spread and evacuation zones come from a simulated wind-and-fuel model for this drill (woods burn fastest; land near woods is warned earlier). They are not an official evacuation order or forecast and do not change matching. Distances and connecting lines are straight-line comparisons, not driving routes or travel times. Street geometry does not establish safe access. © OpenStreetMap contributors.</p>
  </section>;
}
