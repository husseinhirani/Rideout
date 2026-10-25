import type { Arrangement, AssistanceState, Facts, Finding, Location, Participant, Task } from './assistance';
/** Deterministic evacuation ledger. Every number shown to the human comes from here,
 * never from model text. Statuses are participant reports, not verified safety. */
export type EvacStatus = 'arrived' | 'in_transit' | 'help_arranged' | 'self_evacuating' | 'needs_help' | 'unknown' | 'unreachable';
/** two_party: both people in an arrangement reported the milestone. single_report: one person's own account. */
export type EvidenceTier = 'two_party' | 'single_report' | 'none';
export type District = { id: string; label: string; access: Location['access'] | 'unknown'; location_ids: string[] };
export type PersonStatus = { profile_id: number; name: string; district_id: string; seeded_district_id: string | null; status: EvacStatus; tier: EvidenceTier; evidence_ids: string[]; last_heard_at: number | null; stale: boolean };
export type Disagreement = { id: string; district_id: string; profile_ids: number[]; evidence_ids: string[]; text: string };
export type DistrictTally = { district: District; total: number; by_status: Record<EvacStatus, number[]>; by_tier: Record<EvidenceTier, number>; unaccounted: number; stale: number; last_heard_at: number | null };
export type Ledger = { revision: number; computed_at: number; people: PersonStatus[]; districts: DistrictTally[]; disagreements: Disagreement[]; totals: { people: number; arrived: number; in_progress: number; needs_help: number; unaccounted: number } };

export const UNASSIGNED = 'unassigned';
export const EVAC_STATUSES: EvacStatus[] = ['arrived','in_transit','help_arranged','self_evacuating','needs_help','unknown','unreachable'];
export const UNACCOUNTED: EvacStatus[] = ['unknown','unreachable'];
export const STATUS_LABEL: Record<EvacStatus,string> = { arrived:'reported arrived', in_transit:'in transit', help_arranged:'help arranged', self_evacuating:'leaving on their own', needs_help:'needs a ride', unknown:'situation unknown', unreachable:'not reached' };
const STALE_FOLLOW_UPS = 5;

/** Top-level scenario areas, matching the map: a location with no parent zone, or its own zone. */
export function districts(s: AssistanceState): District[] {
  const top = s.scenario.locations.filter(l => !l.zone_id || l.zone_id === l.id);
  return [
    ...top.map(l => ({ id:l.id, label:l.label, access:l.access, location_ids:s.scenario.locations.filter(c => c.id === l.id || c.zone_id === l.id).map(c => c.id) })),
    { id:UNASSIGNED, label:'No confirmed location', access:'unknown' as const, location_ids:[] },
  ];
}
function districtOf(s: AssistanceState, locationId: string | null | undefined): string | null {
  const l = s.scenario.locations.find(l => l.id === locationId);
  return l ? l.zone_id ?? l.id : null;
}
/** Only a confirmed location places someone in a district; a seeded starting point is a hint. */
export function personDistrict(s: AssistanceState, p: Participant): { district_id: string; seeded_district_id: string | null } {
  const confirmed = p.facts.location_id !== null ? districtOf(s,p.facts.location_id) : null;
  return { district_id: confirmed ?? UNASSIGNED, seeded_district_id: confirmed ? null : districtOf(s,p.start_location_id) };
}
/** Findings a participant gave while working on one task. */
function taskFindings(s: AssistanceState, t: Task): Finding[] {
  return s.findings.filter(f => f.attempt_id === t.attempt_id && f.profile_id === t.profile_id && f.at >= (t.delivered_at ?? 0));
}
function milestoneEvidence(s: AssistanceState, a: Arrangement, kind: Task['kind']): string[] {
  return s.tasks.filter(t => t.arrangement_id === a.id && t.kind === kind && t.status === 'completed').flatMap(t => taskFindings(s,t).slice(-1).map(f => f.id));
}
const rank: Record<Arrangement['status'], number> = { cancelled:0, proposed:1, approved:2, accepted:3, confirmed:4, picked_up:5, completed:6 };

export function evacStatus(s: AssistanceState, p: Participant): Pick<PersonStatus,'status'|'tier'|'evidence_ids'> {
  const mine = s.arrangements.filter(a => a.status !== 'cancelled' && a.status !== 'proposed' && (a.recipient_id === p.profile_id || a.helper_id === p.profile_id)).sort((a,b) => rank[b.status]-rank[a.status])[0];
  if (mine) {
    const arrived = mine.arrival_confirmations, pickedUp = mine.pickup_confirmations;
    if (arrived.length) return { status:'arrived', tier: mine.status === 'completed' ? 'two_party' : 'single_report', evidence_ids:[mine.id,...milestoneEvidence(s,mine,'arrival')] };
    if (mine.status === 'picked_up') return { status:'in_transit', tier:'two_party', evidence_ids:[mine.id,...milestoneEvidence(s,mine,'pickup')] };
    if (pickedUp.length) return { status:'in_transit', tier:'single_report', evidence_ids:[mine.id,...milestoneEvidence(s,mine,'pickup')] };
    if (mine.recipient_id === p.profile_id) return { status:'help_arranged', tier: mine.recipient_confirmed ? 'two_party' : 'single_report', evidence_ids:[mine.id,...milestoneEvidence(s,mine,'helper_accept'),...milestoneEvidence(s,mine,'recipient_confirm')] };
  }
  if (p.unreachable) return { status:'unreachable', tier:'none', evidence_ids:[] };
  const source = p.sources.needs_transport;
  if (p.facts.needs_transport === false) return { status:'self_evacuating', tier:'single_report', evidence_ids: source ? [source] : [] };
  if (p.facts.needs_transport === true) return { status:'needs_help', tier:'single_report', evidence_ids: source ? [source] : [] };
  return { status:'unknown', tier:'none', evidence_ids:[] };
}

/** A later report that changes a value an earlier report already set. */
function reversals(s: AssistanceState, p: Participant, district_id: string): Disagreement[] {
  const seen: Partial<Record<keyof Facts,Finding>> = {}, out: Disagreement[] = [];
  for (const f of s.findings.filter(f => f.profile_id === p.profile_id).sort((a,b) => a.at-b.at)) {
    for (const [key,value] of Object.entries(f.changes) as [keyof Facts, Facts[keyof Facts]][]) {
      const earlier = seen[key];
      if (earlier && earlier.changes[key] !== null && value !== null && earlier.changes[key] !== value)
        out.push({ id:'reversal:'+f.id+':'+key, district_id, profile_ids:[p.profile_id], evidence_ids:[earlier.id,f.id], text:p.name+' changed '+key.replace('_',' ')+' from '+String(earlier.changes[key])+' to '+String(value)+'.' });
      seen[key] = f;
    }
  }
  return out;
}
/** One party reported a milestone the other could not confirm. */
function milestoneConflicts(s: AssistanceState, a: Arrangement, district_id: string): Disagreement[] {
  const out: Disagreement[] = [];
  for (const kind of ['pickup','arrival'] as const) {
    const done = s.tasks.filter(t => t.arrangement_id === a.id && t.kind === kind && t.status === 'completed');
    const blocked = s.tasks.filter(t => t.arrangement_id === a.id && t.kind === kind && t.status === 'blocked');
    if (done.length && blocked.length) out.push({ id:'milestone:'+a.id+':'+kind, district_id, profile_ids:[a.recipient_id,a.helper_id], evidence_ids:[a.id,...[...done,...blocked].flatMap(t => taskFindings(s,t).map(f => f.id))], text:'Only one person confirmed '+kind+' for the ride to '+s.scenario.destination+'.' });
  }
  return out;
}

export function districtLedger(s: AssistanceState, now: number): Ledger {
  const ds = districts(s), staleAfter = STALE_FOLLOW_UPS * s.scenario.follow_up_ms;
  const people: PersonStatus[] = s.people.map(p => {
    const heard = s.findings.filter(f => f.profile_id === p.profile_id).reduce<number|null>((max,f) => Math.max(max ?? 0,f.at), null);
    const status = evacStatus(s,p);
    return { profile_id:p.profile_id, name:p.name, ...personDistrict(s,p), ...status, last_heard_at:heard, stale: status.status !== 'arrived' && heard !== null && now - heard > staleAfter };
  });
  const districtFor = (id: number) => people.find(p => p.profile_id === id)?.district_id ?? UNASSIGNED;
  const disagreements = [
    ...s.people.flatMap(p => reversals(s,p,districtFor(p.profile_id))),
    ...s.arrangements.flatMap(a => milestoneConflicts(s,a,districtFor(a.recipient_id))),
  ];
  const tallies = ds.map(district => {
    const members = people.filter(p => p.district_id === district.id);
    const by_status = Object.fromEntries(EVAC_STATUSES.map(st => [st, members.filter(p => p.status === st).map(p => p.profile_id)])) as Record<EvacStatus,number[]>;
    const by_tier = { two_party:0, single_report:0, none:0 };
    for (const p of members) by_tier[p.tier]++;
    return { district, total:members.length, by_status, by_tier, unaccounted:UNACCOUNTED.reduce((n,st) => n + by_status[st].length,0), stale:members.filter(p => p.stale).length, last_heard_at:members.reduce<number|null>((max,p) => p.last_heard_at === null ? max : Math.max(max ?? 0,p.last_heard_at),null) };
  }).filter(t => t.total > 0 || t.district.id !== UNASSIGNED);
  const count = (...st: EvacStatus[]) => people.filter(p => st.includes(p.status)).length;
  return { revision:s.revision, computed_at:now, people, districts:tallies, disagreements,
    totals:{ people:people.length, arrived:count('arrived'), in_progress:count('in_transit','help_arranged','self_evacuating'), needs_help:count('needs_help'), unaccounted:count(...UNACCOUNTED) } };
}

/** Numbers a statement about this district may truthfully contain. */
export function districtFigures(t: DistrictTally): Set<number> {
  return new Set([0, t.total, t.unaccounted, t.stale, ...Object.values(t.by_tier), ...Object.values(t.by_status).map(ids => ids.length),
    t.total - t.unaccounted, t.by_status.arrived.length + t.by_status.in_transit.length]);
}
export function ledgerFigures(l: Ledger): Set<number> {
  return new Set([...Object.values(l.totals), l.totals.people - l.totals.unaccounted, l.districts.length, l.disagreements.length, ...l.districts.flatMap(t => [...districtFigures(t)])]);
}
