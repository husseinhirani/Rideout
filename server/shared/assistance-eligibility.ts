import type { AssistanceState, Participant, Arrangement } from './assistance';

export function person(s: AssistanceState, id: number): Participant {
  if (!Number.isSafeInteger(id) || id < 1) throw new Error('Invalid participant ID');
  const p = s.people.find(p => p.profile_id === id); if (!p) throw new Error('Person is outside this incident'); return p;
}
const reserved = (a: Arrangement) => ['proposed','approved','accepted','confirmed','picked_up'].includes(a.status);
/** Arrangement-only sessions stop outreach once both parties agree; no travel is implied. */
export function arrangementScopeResolved(s: AssistanceState, profileId: number): boolean {
  return s.scenario.follow_through === 'arrangement' && s.arrangements.some(a =>
    ['confirmed','picked_up','completed'].includes(a.status) && [a.recipient_id,a.helper_id].includes(profileId));
}
export function requiresInformationReview(s: AssistanceState, profileId: number): boolean {
  return Boolean(s.people.find(p=>p.profile_id===profileId)?.review_reason) || s.tasks.some(t=>t.profile_id===profileId && ['assess','needs','location','capability'].includes(t.kind) && t.status==='blocked');
}
/** Eligibility is deterministic; a model can only propose a pair that passes this gate. */
export function matchReasons(s: AssistanceState, recipientId: number, helperId: number, excludeId?: string): string[] {
  const r = person(s, recipientId), h = person(s, helperId), reasons: string[] = [];
  const continuation = excludeId ? s.arrangements.find(a => a.id === excludeId && a.recipient_id === recipientId && a.helper_id === helperId) : undefined;
  // After a reported pickup, empty seats / an ongoing transport need need not remain true.
  // Access, consent and the actual milestone confirmations still gate continuation.
  const pickupStarted = !!continuation && (continuation.status === 'picked_up' || continuation.pickup_confirmations.length > 0);
  if (s.arrangements.some(a => a.recipient_id === recipientId && a.helper_id === helperId && a.status === 'cancelled' && a.reconsiderable !== true)) reasons.push('This pairing was withdrawn; choose another option or request human review');
  if (!continuation && s.arrangements.some(a => a.recipient_id === recipientId && a.status === 'completed')) reasons.push('The recipient already has a completed arrangement in this incident');
  if (recipientId === helperId) reasons.push('A person cannot be their own helper');
  if (!r.consent || !h.consent) reasons.push('Contact consent is withdrawn');
  for (const p of [r,h]) if (p.contact_blocked) reasons.push(p.name + ': ' + p.contact_blocked);
  if ([r,h].some(p=>requiresInformationReview(s,p.profile_id))) reasons.push('A participant needs human review after an unresolved information task');
  if (s.tasks.some(t=>t.review_reopened && [recipientId,helperId].includes(t.profile_id) && ['pending','delivered','blocked'].includes(t.status))) reasons.push('A dispatcher-requested reassessment is not yet resolved');
  if (r.unreachable || h.unreachable) reasons.push('A participant has not been reached');
  if (!pickupStarted) {
    if (r.facts.needs_transport !== true) reasons.push('Transport need is unconfirmed');
    if (h.facts.needs_transport !== false || h.facts.can_help !== true) reasons.push('Helper independence or willingness is unconfirmed');
    if (!r.facts.party_size || h.facts.seats === null) reasons.push('Passenger count or capacity is unknown');
    if ((r.facts.party_size ?? Infinity) > (h.facts.seats ?? 0)) reasons.push('Not enough seats');
    if (r.facts.wheelchair === null || r.facts.pets === null) reasons.push('Recipient vehicle requirements are unknown');
    if (r.facts.wheelchair && h.facts.wheelchair_space !== true) reasons.push('Wheelchair capacity is unconfirmed');
    if (r.facts.pets && h.facts.pets_allowed !== true) reasons.push('Pet transport is unconfirmed');
  }
  const other = s.arrangements.filter(a => a.id !== excludeId && reserved(a));
  if (other.some(a => a.recipient_id === recipientId || a.helper_id === recipientId)) reasons.push('Recipient already has a proposed or active arrangement');
  // One simultaneous pickup per helper for this first coordination slice.
  if (other.some(a => a.helper_id === helperId || a.recipient_id === helperId)) reasons.push('Helper already has a reserved pickup');
  const from = s.scenario.locations.find(l => l.id === h.facts.location_id), to = s.scenario.locations.find(l => l.id === r.facts.location_id);
  if (!from || !to) reasons.push('Current scenario locations are unconfirmed');
  else if (from.access !== 'community' || to.access !== 'community' || [from,to].some(l=>l.zone_id && s.scenario.locations.find(zone=>zone.id===l.zone_id)?.access!=='community')) reasons.push('Location requires specialist review or has unknown access');
  else if (!s.scenario.community_routes.some(([a,b]) => (a === (from.zone_id??from.id) && b === (to.zone_id??to.id)) || (a === (to.zone_id??to.id) && b === (from.zone_id??from.id)))) reasons.push('No approved community route in the supplied incident data');
  return [...new Set(reasons)];
}
