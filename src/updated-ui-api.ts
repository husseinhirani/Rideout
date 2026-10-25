import type { CreateInformationInput } from '../server/shared/information';
import { api as backend, ApiError, type BackendState, type IntakeResult } from './api';

// Translate the original UI's actions into revisioned generic investigation commands.
const pending = new Map<string, Promise<{ body: unknown; path: string }>>();
async function post<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(15000) });
  const result = await response.json();
  if (!response.ok) throw new ApiError(response.status, result.error || `Request failed (${response.status})`);
  return result as T;
}
async function command<T>(key: string, prepare: (state: BackendState) => { path: string; body: object }, commandId?: string): Promise<T> {
  let request = pending.get(key);
  if (!request) {
    request = backend.state().then(state => {
      const prepared = prepare(state);
      return { ...prepared, body: { ...prepared.body, command_id: commandId ?? crypto.randomUUID() } };
    }).catch(error => { pending.delete(key); throw error; });
    pending.set(key, request);
  }
  try {
    const prepared = await request;
    const result = await post<T>(prepared.path, prepared.body);
    pending.delete(key);
    return result;
  } catch (error) {
    if (error instanceof ApiError && error.status < 500) pending.delete(key);
    throw error;
  }
}
function revision(state: BackendState, id: number) {
  const row = state.cases.find(c => c.id === id && c.kind === 'information');
  if (!row) throw new Error('Choose an information investigation.');
  return row.input_revision ?? 0;
}
type IncidentInput = { text: string } | { type: string; lat: number; lng: number; radius_m: number };
type IntakeInput = { event_key: string; reporter_profile_id: number | null; child: { name: string; description: string; last_seen_location_id: string; last_seen_time: string }; reporter: { name: string; relationship: string } };
function creation(state: BackendState, text: string, objective: string, area?: { lat: number; lng: number; radius_m: number }): Omit<CreateInformationInput, 'command_id'> {
  const defaults = state.information_intake_configuration;
  return { text, objective, scope: area ? { radius: area } : defaults?.default_scope ?? { profile_ids: [] }, area,
    policy: defaults?.policy, coordination_enabled: state.adaptive_planning_available === true && defaults?.coordination_enabled === true,
    disclosure_facts: defaults?.disclosure_facts ?? [] };
}
export const api = {
  incident: async (input: IncidentInput) => {
    const result = await command<{ incident_id: number; support_case_id: number }>('incident:' + JSON.stringify(input), state => {
      const text = 'text' in input ? input.text : input.type;
      const area = 'text' in input ? undefined : { lat: input.lat, lng: input.lng, radius_m: input.radius_m };
      return { path: '/incidents', body: creation(state, text, 'Collect current information about this incident, who needs assistance and what remains uncertain. ' + text, area) };
    });
    return { incident_id: result.incident_id, case_ids: [result.support_case_id], reason: 'Investigation saved. Calls use the configured coordination settings, permitted scope and recorded contact consent.' };
  },
  intake: async (input: IntakeInput): Promise<IntakeResult> => {
    const questions = [
      ['child.name', input.child.name, "What is the child's name?"],
      ['child.description', input.child.description, 'What description can the reporter provide?'],
      ['child.last_seen_location_id', input.child.last_seen_location_id, 'Where were they last seen?'],
      ['child.last_seen_time', input.child.last_seen_time, 'When were they last seen?'],
      ['reporter.name', input.reporter.name, "What is the reporter's name?"],
      ['reporter.relationship', input.reporter.relationship, 'What is their relationship?'],
    ].filter(([, value]) => !value.trim()).map(([field, , question]) => ({ field, question }));
    if (questions.length) return { status: 'needs_clarification', questions };
    const result = await command<{ support_case_id: number }>('intake:' + input.event_key, state => {
      const location = state.locations?.find(l => l.id === input.child.last_seen_location_id);
      const text = `Reporter ${input.reporter.name} (${input.reporter.relationship}) reports ${input.child.name} missing. Description: ${input.child.description}. Last seen: ${location?.label ?? input.child.last_seen_location_id}, ${input.child.last_seen_time}. Reporter profile: ${input.reporter_profile_id ?? 'not supplied'}. This is an unverified report.`;
      return { path: '/incidents', body: creation(state, text, `Collect information relevant to locating ${input.child.name}; preserve uncertainty and relay findings to the organizer.`) };
    }, input.event_key);
    return { status: 'recorded', support_case_id: result.support_case_id };
  },
  caseInput: async (id: number, text: string) => {
    const result = await command<{ support_case_id: number }>(`input:${id}:${text}`, state => ({ path: `/cases/${id}/input`, body: { text, expected_input_revision: revision(state, id) } }));
    return { ...result, planned: 0, reason: 'The coordinator reconsiders saved input when automatic coordination is enabled and the investigation is not paused.' };
  },
  closeCase: (id: number) => command(`close:${id}`, state => ({ path: `/cases/${id}/close`, body: { expected_input_revision: revision(state, id), reason: 'Organizer closed the investigation from the map.' } })),
  cancel: async (id: number) => {
    await command(`cancel:${id}`, state => {
      const attempt = state.attempts.find(a => a.id === id);
      if (!attempt) throw new Error('Attempt not found.');
      return { path: `/attempts/${id}/cancel`, body: { expected_input_revision: revision(state, attempt.support_case_id), reason: 'Organizer cancelled unsent outreach.' } };
    });
    return { reason: 'Unsent call cancelled.' };
  },
  report: (attempt_id: number, answer: string, concern: string) => backend.simulationReport(attempt_id, answer, concern),
  checkIn: async (incident_id: number, profile_id: number, result: 'safe' | 'victim') => {
    const state = await backend.state();
    if (!state.demo_mode.simulate) throw new Error('Simulation controls are disabled in live mode.');
    const row = state.cases.find(c => c.incident_id === incident_id && c.kind === 'information');
    if (!row) throw new Error('This check-in belongs to an older workflow. Open an information investigation to record it.');
    return api.caseInput(row.id, `Simulated check-in from profile #${profile_id}: ${result === 'safe' ? 'reports being safe' : 'reports needing assistance'}. Unverified simulation input.`);
  },
  inbound: (from_phone: string, text: string, provider_call_id: string) => post<{ status: string; reply: string }>('/simulation/incoming', { ...(from_phone.startsWith('profile:') ? { profile_id: Number(from_phone.slice(8)) } : { from_phone }), text, provider_call_id, direction: 'inbound' }),
  register: (body: { name: string; phone: string; lat: number; lng: number; contact_profile_ids: number[] }) => post<{ profile_id: number }>('/profiles', body),
};

export function presentationState(state: BackendState): BackendState {
  return { ...state, cases: state.cases.map(row => {
    if (row.kind !== 'information') return row;
    const decision = [...(state.information_decisions ?? [])].filter(d => d.support_case_id === row.id).sort((a,b) => b.based_on_revision - a.based_on_revision)[0];
    return decision ? { ...row, brief: JSON.stringify({ summary: `${decision.based_on_revision === row.input_revision ? '' : 'Earlier decision: '}${decision.plan.summary}`, suggestions: decision.plan.open_questions }) } : row;
  }) };
}

export function savedConversation(state: BackendState | null, caseId: number | null) {
  if (!state || caseId === null) return [];
  return [
    ...state.notes.filter(n => n.support_case_id === caseId && ['organizer', 'dispatcher'].includes(n.source)).map(n => ({ id: `note-${n.id}`, from: 'lead' as const, text: n.text, at: Date.parse(n.at) })),
    ...(state.information_decisions ?? []).filter(d => d.support_case_id === caseId).map(d => ({ id: `decision-${d.id}`, from: 'facilitator' as const, text: d.plan.summary, at: Date.parse(d.created_at) })),
  ].sort((a,b) => a.at - b.at);
}

export function directoryEdges(state: BackendState, caseId: number | null) {
  const ids = new Set(state.profiles.map(p => p.id));
  const edges: { a: number; b: number; kind: 'call' | 'near' | 'match' }[] = [];
  const seen = new Set<string>();
  for (const attempt of state.attempts.filter(a => a.support_case_id === caseId)) {
    if (!ids.has(attempt.profile_id) || seen.has(`call:${attempt.profile_id}`)) continue;
    seen.add(`call:${attempt.profile_id}`);
    edges.push({ a: -1, b: attempt.profile_id, kind: 'call' });
  }
  for (const profile of state.profiles) for (const contact of profile.contact_profile_ids) {
    const key = [profile.id, contact].sort((a,b) => a-b).join(':');
    if (!ids.has(contact) || contact === profile.id || seen.has(key)) continue;
    seen.add(key); edges.push({ a: profile.id, b: contact, kind: 'near' });
  }
  return edges;
}
