import { useId, useMemo, useState } from 'react';
import type { Arrangement, AssistanceState } from '../server/shared/assistance';
import { distanceMeters, participantLocation } from '../server/shared/spatial';
import streets from './data/streets.json';
import buildings from './data/buildings.json';
import { assignHouses } from './telemetry';

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
/** Geographic positions stay at their source coordinates; lines are arrangements, never invented routes. */
export function IncidentMap({ session, selectedId, onSelect, compact = false }: {
  session: AssistanceState; selectedId?: number | null; onSelect?: (id: number) => void; compact?: boolean;
}) {
  const [wholeIncident, setWholeIncident] = useState(false);
  const [localSelected, setLocalSelected] = useState<number | null>(null);
  const selected = selectedId ?? localSelected;
  const select = (id: number) => { setLocalSelected(id); onSelect?.(id); };
  const clipId = 'incident-' + useId().replace(/:/g, '');
  const located = session.people.map((person, index) => ({ person, index: index + 1, ...participantLocation(session, person) }));
  const backgroundNeighbors = useMemo(() => assignHouses(), []);
  const visualOnlyNeighbors = session.scenario.drill && session.people.every(person => person.mode === 'real') ? backgroundNeighbors : [];
  const participantPoints = located.flatMap(p => p.location ? [p.location] : []);
  const points = (wholeIncident || !participantPoints.length ? [...session.scenario.locations, ...participantPoints, ...visualOnlyNeighbors] : [...participantPoints, ...visualOnlyNeighbors])
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
  const arrangements = session.arrangements.filter(a => a.status !== 'cancelled');
  const chosen = located.find(p => p.person.profile_id === selected);
  const areaLocations = session.scenario.locations.filter(l => !l.zone_id || l.zone_id === l.id);
  const scaleMeters = Math.max(10, Math.round(distanceMeters({lat: middleLat, lng: west}, {lat: middleLat, lng: east}) / 4 / 10) * 10);
  const scaleWidth = scaleMeters / 111195 * scale;

  return <section className={'incident-geography' + (compact ? ' compact' : '')} aria-label="Incident locations and proposed help">
    <header><div><h3>People and nearby help</h3><p>{session.scenario.drill ? 'Neighborhood geography · Wildfire drill' : 'Incident geography'}</p></div><div className="incident-map-tools"><button type="button" onClick={() => setWholeIncident(value => !value)}>{wholeIncident ? "Focus people" : "Whole incident"}</button><span className="incident-north" aria-label="North is up">↑ N</span></div></header>
    <svg className="incident-geography-map" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Geographic map. Numbered markers identify participants listed below; dashed lines show proposed help, not road routes.">
      <defs><clipPath id={clipId}><rect width={width} height={height} rx="18" /></clipPath></defs>
      <g clipPath={`url(#${clipId})`}>
        <rect width={width} height={height} fill="#f1f1e9" />
        <g fill="#e2e3d7" stroke="#d7d9ca" strokeWidth=".7">{buildings.features.map((feature, index) => <path key={index} d={path(feature.geometry.coordinates[0]) + ' Z'} />)}</g>
        <g fill="none" stroke="#fff" strokeWidth="5">{streets.streets.map((street, index) => <path key={index} d={path(street.line)}><title>{street.name || 'Mapped street'} · access not verified</title></path>)}</g>
        {areaLocations.map(location => {
          const p = project(location.lng, location.lat);
          return <g key={location.id} transform={`translate(${p.x} ${p.y})`}><circle r="14" fill="none" stroke={location.access === 'community' ? '#778054' : '#b06437'} strokeDasharray="3 4" /><title>{location.label}: {location.access === 'community' ? 'community access in supplied incident data' : location.access === 'specialist' ? 'specialist only' : 'access unknown'}</title></g>;
        })}
        {arrangements.map(arrangement => {
          const from = located.find(p => p.person.profile_id === arrangement.helper_id), to = located.find(p => p.person.profile_id === arrangement.recipient_id);
          if (!from?.confirmed || !to?.confirmed || !from.location || !to.location) return null;
          const a = project(from.location.lng, from.location.lat), b = project(to.location.lng, to.location.lat);
          return <line key={arrangement.id} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={arrangement.status === 'proposed' ? '#bf6c30' : '#4c6d24'} strokeWidth="4" strokeDasharray={arrangement.status === 'proposed' ? '7 6' : undefined}><title>{from.person.name} → {to.person.name}: {arrangement.status.replace('_', ' ')} · {formatDistance(distanceMeters(from.location, to.location))} straight line</title></line>;
        })}
        {visualOnlyNeighbors.map(neighbor => {
          const point = project(neighbor.lng, neighbor.lat);
          return <circle key={neighbor.id} cx={point.x} cy={point.y} r="5" fill="#aeb4aa" stroke="#fff" strokeWidth="1.5"><title>{neighbor.name} · simulated map context only; no call or coordination task</title></circle>;
        })}
        {located.filter(p => p.location).map(p => {
          const point = project(p.location!.lng, p.location!.lat), isSelected = selected === p.person.profile_id;
          return <g key={p.person.profile_id} transform={`translate(${point.x} ${point.y})`} role="button" tabIndex={0} aria-label={p.person.name + ': ' + (p.confirmed ? 'reported location' : 'unconfirmed assigned drill position')} onClick={() => select(p.person.profile_id)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); select(p.person.profile_id); } }} className="incident-person-marker">
            {isSelected && <circle r="22" fill="none" stroke="#111214" strokeWidth="2" />}
            <circle r="16" fill={p.confirmed ? p.person.facts.needs_transport ? '#ffb59f' : '#d5f45c' : '#fff'} stroke="#22251d" strokeWidth="2" strokeDasharray={p.confirmed ? undefined : '3 3'} />
            <text textAnchor="middle" dominantBaseline="central" fontSize="13" fontWeight="700" fill="#151714">{p.index}</text>
            <title>{p.person.name} · {p.location!.label} · {p.confirmed ? 'reported during call' : 'assigned drill position, awaiting confirmation'}</title>
          </g>;
        })}
      </g>
      <g transform={`translate(25 ${height - 20})`} stroke="#575e4a"><path d={`M0,-5 V0 H${scaleWidth} V-5`} fill="none" /><text x="0" y="-10" stroke="none" fill="#575e4a" fontSize="11">{formatDistance(scaleMeters)}</text></g>
    </svg>
    <div className="incident-map-key"><span><i className="start" />Unconfirmed start</span><span><i className="reported" />Reported location</span><span><i className="proposal" />Proposed help</span><span><i className="agreed" />Approved arrangement</span>{visualOnlyNeighbors.length > 0 && <span>Gray dots: simulated neighbors, display only</span>}</div>
    <div className="incident-person-list">{located.map(p => <button type="button" key={p.person.profile_id} className={selected === p.person.profile_id ? 'selected' : ''} onClick={() => select(p.person.profile_id)}>
      <b>{p.index}</b><span><strong>{p.person.name}</strong><small>{p.location ? p.confirmed ? 'Reported: ' + p.location.label : 'Assigned drill position · awaiting confirmation' : 'Location unknown · not placed on map'}</small></span>
    </button>)}</div>
    {chosen && <p className="incident-selected-location"><b>{chosen.person.name}:</b> {chosen.location ? `${chosen.location.label} · ${chosen.location.lat.toFixed(5)}, ${chosen.location.lng.toFixed(5)} · ${chosen.confirmed ? 'participant-reported' : 'assigned drill position, not yet confirmed'}` : 'Current location is unknown. Earlier starting coordinates are not used for matching.'}</p>}
    {chosen?.location?.source && <p className="incident-map-note">Location source: {chosen.location.source.replace(" in src/data/buildings.json", "").replace("simulated participant placement", "assigned drill position")}</p>}
    <p className="incident-map-note">{wholeIncident ? "Showing all supplied incident locations." : "Map focused on participant positions. Choose Whole incident to include every supplied location."}</p>
    <div className="incident-access-key">{areaLocations.map(location => <span key={location.id}><b>{location.label}</b> · {location.access === 'community' ? 'Community access' : location.access === 'specialist' ? 'Specialist only' : 'Access unknown'}</span>)}</div>
    <p className="incident-map-note">Distances and connecting lines are straight-line comparisons, not driving routes or travel times. Street geometry does not establish safe access. © OpenStreetMap contributors.</p>
  </section>;
}
