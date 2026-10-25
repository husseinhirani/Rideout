import { person, matchReasons, requiresInformationReview } from './assistance-eligibility';
export { person, matchReasons, requiresInformationReview } from './assistance-eligibility';
import { spatialMatching } from './spatial';
import { informationGaps } from './voice-mission';
/** Shared incident coordination contract. People and locations are data, never role rules. */
export type Facts = {
  location_id: string | null; needs_transport: boolean | null; party_size: number | null;
  wheelchair: boolean | null; pets: boolean | null; can_help: boolean | null;
  seats: number | null; wheelchair_space: boolean | null; pets_allowed: boolean | null;
};
export const emptyFacts = (): Facts => ({ location_id: null, needs_transport: null, party_size: null, wheelchair: null, pets: null, can_help: null, seats: null, wheelchair_space: null, pets_allowed: null });
export type Location = { id: string; label: string; lat: number; lng: number; access: 'community' | 'specialist' | 'unknown'; zone_id?: string; source?: string };
export type Scenario = { title: string; drill: boolean; context: string; locations: Location[]; community_routes: [string, string][]; destination: string; follow_up_ms: number; max_tasks_per_person: number };
export type Participant = { profile_id: number; name: string; mode: 'real' | 'simulated'; start_location_id?: string; facts: Facts; sources: Partial<Record<keyof Facts, string>>; consent: boolean; contact_blocked?: string | null; review_reason?: string; simulation?: Facts; unreachable: boolean };
export type TaskKind = 'assess' | 'needs' | 'location' | 'capability' | 'helper_accept' | 'recipient_confirm' | 'pickup' | 'arrival';
export type MissionUpdate = { task_id: string; objective: string; reason: string; evidence_ids: string[]; focus_fields: (keyof Facts)[] };
export type CoordinatorBrief = Omit<MissionUpdate, 'task_id'> & { revision: number; issued_at: number };
export type Task = { review_reopened?: boolean; coordinator_brief?: CoordinatorBrief; id: string; profile_id: number; kind: TaskKind; arrangement_id: string | null; reason: string; status: 'pending' | 'delivered' | 'completed' | 'cancelled' | 'blocked'; attempt_id: number | null; created_at: number; delivered_at: number | null; call_count: number; completed_revision?: number; due_at: number; result: string; };
export type Arrangement = { id: string; recipient_id: number; helper_id: number; evidence_ids: string[]; reason: string; status: 'proposed' | 'approved' | 'accepted' | 'confirmed' | 'picked_up' | 'completed' | 'cancelled'; helper_accepted: boolean; recipient_confirmed: boolean; pickup_confirmations: number[]; arrival_confirmations: number[]; reconsiderable?: boolean; created_at: number; updated_at: number; };
export type Finding = { id: string; profile_id: number; attempt_id: number; text: string; changes: Partial<Facts>; human_review?: string; mission_revision?: number; at: number };
export type CoordinatorMessage = { id: string; from: 'lead' | 'facilitator'; text: string; at: number; kind: 'update' | 'decision' | 'review' | 'chat' };
export type AssistanceInboundReport = { id: string; request_id: number; request_revision: number; support_case_id: number; profile_id: number; source: 'automatic_update' | 'operator_attach' | 'intake'; verification: 'phone_association_only'; text: string; at: number };
export type AssistanceState = { case_id: number; revision: number; planned_revision: number; paused: boolean; scenario: Scenario; people: Participant[]; findings: Finding[]; inbound_reports?: AssistanceInboundReport[]; tasks: Task[]; arrangements: Arrangement[]; messages: CoordinatorMessage[]; review: string | null; planning_error?: { kind: 'billing' | 'authentication' | 'rate_limit' | 'network' | 'invalid_plan' | 'service' | 'unknown'; message: string; blocked: boolean }; failure_count: number; retry_at: number; error: string; processed_reports: number[]; missing_report_attempts?: number[]; closing_attempts?: number[]; };
export type AssistancePlan = { mission_updates?: MissionUpdate[]; summary: string; questions: { profile_id: number; kind: 'needs' | 'location' | 'capability'; reason: string; evidence_ids: string[] }[]; proposals: { recipient_id: number; helper_id: number; reason: string; evidence_ids: string[] }[]; cancel_task_ids: string[]; review: string | null };
export type VoiceUpdate = { sequence: number; text: string; facts: Partial<Facts>; task_id?: string; result?: 'answered' | 'declined' | 'unknown'; confirmation?: 'accepted' | 'declined' | 'picked_up' | 'arrived'; finished?: boolean; do_not_call?: boolean; mission_revision?: number; human_review?: string };

export function parseFacts(value: unknown, scenario: Scenario): Partial<Facts> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Facts must be an object');
  const result: Partial<Facts> = {};
  for (const [key, v] of Object.entries(value)) {
    if (!Object.prototype.hasOwnProperty.call(emptyFacts(), key)) throw new Error('Unknown fact: ' + key);
    if (key === 'location_id') {
      if (v !== null && !scenario.locations.some(l => l.id === v)) throw new Error('Choose a supplied location or leave it unknown');
    } else if (key === 'party_size' || key === 'seats') {
      if (v !== null && (!Number.isInteger(v) || Number(v) < (key === 'party_size' ? 1 : 0) || Number(v) > 20)) throw new Error('Invalid passenger count');
    } else if (v !== null && typeof v !== 'boolean') throw new Error('Invalid fact: ' + key);
    Object.assign(result, { [key]: v });
  }
  return result;
}
export function addMessage(s: AssistanceState, text: string, now: number, kind: CoordinatorMessage['kind'] = 'update', from: CoordinatorMessage['from'] = 'facilitator') {
  const id = 'message:' + s.case_id + ':' + (s.messages.length + 1);
  s.messages.push({ id, from, text, at: now, kind });
}
export function touch(s: AssistanceState) { s.revision++; if (!s.planning_error?.blocked) { s.failure_count = 0; s.retry_at = 0; s.error = ''; } }
const reserved = (a: Arrangement) => ['proposed','approved','accepted','confirmed','picked_up'].includes(a.status);
const taskKinds: TaskKind[] = ['assess','needs','location','capability','helper_accept','recipient_confirm','pickup','arrival'];
const activeTask = (t: Task) => t.status === 'pending' || t.status === 'delivered';
const validId = (id: unknown): id is number => Number.isSafeInteger(id) && Number(id) > 0;
function boundedText(value: unknown, name: string, max: number, empty = false): asserts value is string {
  if (typeof value !== 'string' || value.length > max || (!empty && !value.trim())) throw new Error('Invalid ' + name);
}
function objectValue(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function requiredMatchSources(s: AssistanceState, recipientId: number, helperId: number): string[] {
  const r = person(s,recipientId), h = person(s,helperId);
  const recipientKeys: (keyof Facts)[] = ['location_id','needs_transport','party_size','wheelchair','pets'];
  const helperKeys: (keyof Facts)[] = ['location_id','needs_transport','can_help','seats'];
  if (r.facts.wheelchair) helperKeys.push('wheelchair_space');
  if (r.facts.pets) helperKeys.push('pets_allowed');
  const refs: string[] = [];
  for (const [p, keys] of [[r,recipientKeys],[h,helperKeys]] as const) for (const key of keys) {
    const source = p.sources[key], finding = s.findings.find(f => f.id === source && f.profile_id === p.profile_id);
    if (!source || !finding || !Object.prototype.hasOwnProperty.call(finding.changes,key) || finding.changes[key] !== p.facts[key]) throw new Error('A proposed match needs attributed current evidence for ' + p.name + ': ' + key);
    refs.push(source);
  }
  return [...new Set(refs)];
}
function milestone(s: AssistanceState, task: Task): Arrangement {
  const a = s.arrangements.find(a => a.id === task.arrangement_id);
  if (!a || !reserved(a) || !activeTask(task)) throw new Error('Arrangement is not authorized for this task');
  const participant = task.profile_id;
  const isParty = participant === a.recipient_id || participant === a.helper_id;
  const allowed = task.kind === 'helper_accept' ? participant === a.helper_id && a.status === 'approved' && !a.helper_accepted
    : task.kind === 'recipient_confirm' ? participant === a.recipient_id && a.status === 'accepted' && a.helper_accepted && !a.recipient_confirmed
    : task.kind === 'pickup' ? isParty && a.status === 'confirmed' && a.helper_accepted && a.recipient_confirmed && !a.pickup_confirmations.includes(participant)
    : task.kind === 'arrival' ? isParty && a.status === 'picked_up' && [a.recipient_id,a.helper_id].every(id => a.pickup_confirmations.includes(id)) && !a.arrival_confirmations.includes(participant)
    : false;
  if (!allowed) throw new Error('Task does not match the authorized participant and current milestone');
  return a;
}
export function addTask(s: AssistanceState, profileId: number, kind: TaskKind, now: number, reason: string, arrangementId: string | null = null, due = now): Task | null {
  const p = person(s, profileId);
  if (!taskKinds.includes(kind) || !Number.isFinite(now) || !Number.isFinite(due)) throw new Error('Invalid task');
  boundedText(reason,'task reason',2000);
  if (!p.consent || p.contact_blocked || requiresInformationReview(s,p.profile_id)) { s.review = p.name + ' cannot be contacted; human review is required.'; return null; }
  if (s.tasks.some(t => t.profile_id === profileId && t.kind === kind && t.arrangement_id === arrangementId && activeTask(t))) return null;
  if (s.tasks.filter(t => t.profile_id === profileId).length >= s.scenario.max_tasks_per_person) {
    s.review = p.name + ' has reached the task limit. Human review is required.'; return null;
  }
  const task: Task = { id: 'task:' + s.case_id + ':' + (s.tasks.length + 1), profile_id: profileId, kind, arrangement_id: arrangementId, reason, status: 'pending', attempt_id: null, created_at: now, delivered_at: null, call_count: 0, due_at: due, result: '' };
  if (['helper_accept','recipient_confirm','pickup','arrival'].includes(kind)) milestone(s,task);
  else if (arrangementId !== null) throw new Error('Information tasks cannot carry an arrangement');
  s.tasks.push(task); return task;
}
export function taskInstruction(s: AssistanceState, task: Task): string {
  if (!activeTask(task) || !person(s,task.profile_id).consent || person(s,task.profile_id).contact_blocked || requiresInformationReview(s,task.profile_id)) throw new Error('Task is no longer available');
  const prefix = s.scenario.drill ? 'This is a fictional drill; do not instruct actual travel. ' : '';
  if (task.kind === 'assess') return prefix + 'Understand whether this person needs evacuation assistance or could help someone else, and gather enough attributed information for the coordinator to compare suitable assistance. Resolve relevant gaps naturally; the participant may decline or not know.';
  if (task.kind === 'location') return prefix + 'Establish a participant-reported scenario location for geographic comparison. Supplied starting points are unconfirmed scenario context. A different or unknown location is a valid answer; never substitute directory coordinates.';
  if (task.kind === 'needs') return prefix + 'Understand the person’s current assistance needs well enough to evaluate suitable help. Follow changed circumstances rather than an assumed role, and preserve needs outside the structured fields in the account for human review.';
  if (task.kind === 'capability') return prefix + 'Determine whether this person is willing and able to help, and what assistance their available vehicle capacity could support. This gathers options; it does not commit them to an arrangement. If their circumstances changed, establish their current needs instead.';
  const a = milestone(s,task), r = person(s,a.recipient_id), h = person(s,a.helper_id);
  const reasons = matchReasons(s,a.recipient_id,a.helper_id,a.id);
  if (reasons.length) throw new Error('Arrangement needs review: ' + reasons.join('; '));
  const location = s.scenario.locations.find(l => l.id === r.facts.location_id)?.label ?? 'unconfirmed location';
  if (task.kind === 'helper_accept') return prefix + 'The human approved asking you about this proposed pickup: help ' + r.name + ' (' + r.facts.party_size + ' passenger(s)) at ' + location + ' reach ' + s.scenario.destination + '. Ask for explicit acceptance or refusal. It is not accepted until they agree. Requirements: wheelchair=' + r.facts.wheelchair + ', pets=' + r.facts.pets + '.';
  if (task.kind === 'recipient_confirm') return prefix + h.name + ' accepted the proposed pickup at ' + location + ' for ' + s.scenario.destination + '. Confirm whether this arrangement works for the recipient. Do not invent an arrival time or say the helper has arrived.';
  if (task.kind === 'pickup') return prefix + 'Ask whether the agreed pickup involving ' + r.name + ' and ' + h.name + ' has actually happened in the scenario. Acceptance alone is not pickup. Accept uncertainty.';
  return prefix + 'Ask whether the agreed journey involving ' + r.name + ' and ' + h.name + ' has arrived at ' + s.scenario.destination + '. Pickup alone is not arrival. Accept uncertainty.';
}
export function cancelArrangement(s: AssistanceState, a: Arrangement, reason: string, now: number, reconsiderable = false) {
  if (['cancelled','completed'].includes(a.status)) return;
  a.status = 'cancelled'; a.updated_at = now; a.reconsiderable = reconsiderable;
  for (const t of s.tasks.filter(t => t.arrangement_id === a.id && activeTask(t))) { t.status = 'cancelled'; t.result = reason; }
  s.review = 'Arrangement for ' + person(s,a.recipient_id).name + ' was withdrawn: ' + reason + '. No replacement is confirmed.';
  addMessage(s,s.review,now,'review');
}
export function applyFinding(s: AssistanceState, profileId: number, attemptId: number, updateId: string, update: VoiceUpdate, now: number) {
  // Keep malformed updates atomic even for consumers outside a database reducer.
  const draft = JSON.parse(JSON.stringify(s)) as AssistanceState;
  applyFindingToDraft(draft,profileId,attemptId,updateId,update,now);
  Object.assign(s,draft);
}
function applyFindingToDraft(s: AssistanceState, profileId: number, attemptId: number, updateId: string, update: VoiceUpdate, now: number) {
  if (!validId(attemptId) || !Number.isFinite(now)) throw new Error('Invalid attempt or timestamp');
  boundedText(updateId,'update ID',300);
  if (!objectValue(update) || !Number.isSafeInteger(update.sequence) || update.sequence < 1 || update.sequence > 1000) throw new Error('Invalid update');
  boundedText(update.text,'update text',6000,true);
  if (update.result !== undefined && !['answered','declined','unknown'].includes(update.result)) throw new Error('Invalid task result');
  if (update.confirmation !== undefined && !['accepted','declined','picked_up','arrived'].includes(update.confirmation)) throw new Error('Invalid confirmation');
  if (update.do_not_call !== undefined && typeof update.do_not_call !== 'boolean') throw new Error('Invalid consent update');
  if (update.finished !== undefined && typeof update.finished !== 'boolean') throw new Error('Invalid finish flag');
  if (update.human_review !== undefined) boundedText(update.human_review,'human review reason',2000,true);
  if (update.mission_revision !== undefined && (!Number.isSafeInteger(update.mission_revision) || update.mission_revision < 0)) throw new Error('Invalid mission revision');
  const p = person(s,profileId), facts = parseFacts(update.facts ?? {},s.scenario);
  const duplicate = s.findings.find(f => f.id === updateId);
  if (duplicate) {
    if (duplicate.profile_id !== profileId || duplicate.attempt_id !== attemptId || duplicate.text !== update.text || JSON.stringify(duplicate.changes) !== JSON.stringify(facts) || (duplicate.human_review ?? '') !== (update.human_review?.trim() ?? '') || duplicate.mission_revision !== update.mission_revision) throw new Error('Update ID conflicts with another finding');
    return;
  }
  const task = update.task_id ? s.tasks.find(t => t.id === update.task_id) : update.finished ? (s.tasks.find(t=>t.profile_id===profileId && t.attempt_id===attemptId && t.status==='delivered') ?? s.tasks.filter(t=>t.profile_id===profileId && t.attempt_id===attemptId && t.status==='completed').slice(-1)[0]) : undefined;
  if (update.task_id && (!task || task.profile_id !== profileId || task.attempt_id !== attemptId)) throw new Error('Task belongs to another call or is no longer bound; fetch current instructions');
  if ((update.result || update.confirmation) && !task) throw new Error('A task result requires an assigned task');
  let stale = task && task.status !== 'delivered';
  let arrangement: Arrangement | undefined;
  if (task && !stale && task.arrangement_id) arrangement = milestone(s,task);
  if (update.confirmation && !stale) {
    if (!arrangement || !task) throw new Error('No authorized arrangement confirmation task');
    const expected = ['helper_accept','recipient_confirm'].includes(task.kind) ? 'accepted' : task.kind === 'pickup' ? 'picked_up' : 'arrived';
    if (update.confirmation !== 'declined' && update.confirmation !== expected) throw new Error('Confirmation does not match the current milestone');
    if (update.result && update.result !== 'answered' && !(update.result === 'declined' && update.confirmation === 'declined')) throw new Error('Contradictory task result and confirmation');
  }
  if ((Object.keys(facts).length || update.result || update.confirmation) && !update.text.trim()) throw new Error('A finding needs the participant account supporting it');
  const previousFacts = { ...p.facts };
  s.findings.push({id:updateId,profile_id:profileId,attempt_id:attemptId,text:update.text,changes:facts,...(update.mission_revision!==undefined?{mission_revision:update.mission_revision}:{}),...(update.human_review?.trim()?{human_review:update.human_review.trim()}:{}),at:now});
  Object.assign(p.facts,facts); for (const key of Object.keys(facts) as (keyof Facts)[]) p.sources[key] = updateId;
  // A correction during this same open conversation can change what the mission needs.
  // Never revive a blocked/refused task, a milestone, or a call already finishing.
  if (task?.status === 'completed' && !task.arrangement_id && Object.keys(facts).some(key=>!Object.is(previousFacts[key as keyof Facts],p.facts[key as keyof Facts]))
    && informationGaps(task.kind,p.facts).length && !s.paused && p.consent && !p.contact_blocked && !update.do_not_call && !update.finished && !s.closing_attempts?.includes(attemptId)) {
    task.status='delivered'; task.result=''; delete task.completed_revision; stale=false;
  }
  if (update.human_review?.trim()) p.review_reason=update.human_review.trim();
  if (update.do_not_call || update.confirmation==='declined' || Object.keys(facts).some(key=>!Object.is(previousFacts[key as keyof Facts],p.facts[key as keyof Facts]))) {
    for(const proposal of s.arrangements.filter(a=>a.status==='proposed')) cancelArrangement(s,proposal,'New participant information requires a fresh comparison',now,true);
  }
  if (update.text.trim() || Object.keys(facts).length) p.unreachable = false;
  if (update.do_not_call) p.consent = false;
  if (stale && (update.result || update.confirmation)) {
    s.review = 'A late update from ' + p.name + ' was saved, but its task is no longer active. The reported outcome needs review.';
    addMessage(s,s.review,now,'review');
  }
  // Apply a valid pickup confirmation before rechecking availability: occupied seats
  // and no longer needing a pickup are expected once the pickup has happened.
  if (task && !stale && arrangement && update.confirmation === 'picked_up') arrangement.pickup_confirmations = [...new Set([...arrangement.pickup_confirmations,profileId])];
  for (const a of s.arrangements.filter(a => reserved(a) && (a.helper_id === profileId || a.recipient_id === profileId))) {
    // An explicit refusal must never become an automatically reconsiderable pairing,
    // even when the same report also corrects its pickup details.
    const declined = !stale && arrangement?.id === a.id && (update.confirmation === 'declined' || update.result === 'declined');
    if (declined) { cancelArrangement(s,a,p.name + ' declined or can no longer continue',now); continue; }
    const materialKeys: (keyof Facts)[] = a.recipient_id === profileId
      ? ['location_id','party_size','wheelchair','pets'] : ['location_id'];
    const changedKeys = materialKeys.filter(key => Object.prototype.hasOwnProperty.call(facts,key) && !Object.is(previousFacts[key],p.facts[key]));
    if (['proposed','approved','accepted','confirmed'].includes(a.status) && a.pickup_confirmations.length === 0 && changedKeys.length) {
      cancelArrangement(s,a,p.name + ' changed the proposed pickup details (' + changedKeys.join(', ') + '). A fresh proposal and human approval are required',now,true);
      continue;
    }
    const reasons = matchReasons(s,a.recipient_id,a.helper_id,a.id);
    if (reasons.length) cancelArrangement(s,a,reasons.join('; '),now);
  }
  if (task && task.status === 'delivered' && (update.result || update.confirmation || update.finished || update.human_review?.trim())) {
    const a = arrangement;
    if (!a) {
      const gaps = informationGaps(task.kind,p.facts);
      const humanReview = update.human_review?.trim();
      const briefPending = Boolean(task.coordinator_brief && update.mission_revision !== task.coordinator_brief.revision);
      const unresolved = update.result === 'declined' || update.result === 'unknown' || Boolean(humanReview) || (update.finished && (gaps.length > 0 || briefPending));
      // A premature "answered" preserves discoveries and the active mission. It must not
      // turn a useful live conversation into either a callback or a permanent review hold.
      task.status = unresolved ? 'blocked' : gaps.length === 0 && !briefPending ? 'completed' : 'delivered';
      task.result = task.status === 'delivered' ? '' : unresolved ? (update.result === 'declined' ? 'declined' : 'unknown') : 'answered';
      if (task.status === 'completed') task.completed_revision = s.revision + 1;
      if (task.status === 'blocked') {
        s.review = p.name + ': ' + (humanReview || (update.result === 'declined' ? 'The participant declined further information gathering' : briefPending ? 'The latest coordinator clarification was not resolved before the call finished' : gaps.length ? 'Information remains unresolved: ' + gaps.map(g=>g.field).join(', ') : 'The participant could not resolve the requested information')) + '. Findings are saved; human review is needed.';
        addMessage(s,s.review,now,'review');
      }
    } else if (update.confirmation === 'declined' || update.result === 'declined') {
      task.status = 'completed'; task.completed_revision = s.revision + 1; task.result = 'declined'; cancelArrangement(s,a,p.name + ' declined or can no longer continue',now);
    } else if (!update.confirmation) {
      task.status = 'blocked'; task.result = update.result ?? 'unknown';
      s.review = 'The outcome of ' + task.kind + ' with ' + p.name + ' remains unconfirmed.';
      addMessage(s,s.review,now,'review');
    } else {
      task.status = 'completed'; task.completed_revision = s.revision + 1; task.result = update.confirmation;
      if (task.kind === 'helper_accept') {
        a.helper_accepted = true; a.status = 'accepted';
        addTask(s,a.recipient_id,'recipient_confirm',now,'Confirm the accepted pickup with the recipient',a.id);
      } else if (task.kind === 'recipient_confirm') {
        a.recipient_confirmed = true; a.status = 'confirmed';
        for (const id of [a.recipient_id,a.helper_id]) addTask(s,id,'pickup',now,'Check pickup separately from acceptance',a.id,now+s.scenario.follow_up_ms);
      } else if (task.kind === 'pickup') {
        if ([a.recipient_id,a.helper_id].every(id => a.pickup_confirmations.includes(id))) {
          a.status = 'picked_up'; for (const id of [a.recipient_id,a.helper_id]) addTask(s,id,'arrival',now,'Confirm arrival separately from pickup',a.id,now+s.scenario.follow_up_ms);
        }
      } else if (task.kind === 'arrival') {
        a.arrival_confirmations = [...new Set([...a.arrival_confirmations,profileId])];
        if ([a.recipient_id,a.helper_id].every(id => a.arrival_confirmations.includes(id))) a.status = 'completed';
      }
      a.updated_at = now;
      addMessage(s,'Arrangement for ' + person(s,a.recipient_id).name + ': ' + a.status.replace('_',' ') + '.',now);
    }
  }
  if (update.finished && task?.status === 'completed' && !task.arrangement_id && informationGaps(task.kind,p.facts).length) {
    task.status='blocked'; task.result='Final findings leave unresolved information'; delete task.completed_revision;
    s.review=p.name+': final findings are saved, but assistance information remains unresolved. Human review is needed; no automatic callback is authorized.';
    addMessage(s,s.review,now,'review');
  }
  if (update.human_review?.trim() && (!task || task.arrangement_id || task.status !== 'blocked')) {
    if (task && !task.arrangement_id && ['pending','delivered','completed'].includes(task.status)) {task.status='blocked';task.result='Human review requested';delete task.completed_revision}
    s.review = p.name + ': ' + update.human_review.trim() + '. Human review is needed.';
    addMessage(s,s.review,now,'review');
  }
  if (update.text.trim()) addMessage(s,p.name + ' reports: ' + update.text,now);
  touch(s);
}
export function applyPlan(s: AssistanceState, plan: AssistancePlan, now: number) {
  const draft = JSON.parse(JSON.stringify(s)) as AssistanceState;
  applyPlanToDraft(draft,plan,now);
  Object.assign(s,draft);
}
function applyPlanToDraft(s: AssistanceState, plan: AssistancePlan, now: number) {
  if (!objectValue(plan) || !Number.isFinite(now)) throw new Error('Invalid coordinator plan');
  boundedText(plan.summary,'plan summary',5000);
  if (!Array.isArray(plan.questions) || plan.questions.length > 6 || !Array.isArray(plan.proposals) || plan.proposals.length > 6 || !Array.isArray(plan.cancel_task_ids) || plan.cancel_task_ids.length > 30) throw new Error('Invalid plan collections');
  if (plan.review !== null) boundedText(plan.review,'review',2000);
  const updates = plan.mission_updates ?? [];
  if (!Array.isArray(updates) || updates.length > 6) throw new Error('Invalid mission updates');
  const evidence = new Set(s.findings.map(f => f.id));
  for (const action of [...plan.questions,...plan.proposals,...updates]) {
    if (!objectValue(action) || !Array.isArray(action.evidence_ids) || action.evidence_ids.length > 60 || action.evidence_ids.some(id => typeof id !== 'string' || !evidence.has(id)) || new Set(action.evidence_ids).size !== action.evidence_ids.length) throw new Error('Plan must reference known, distinct evidence IDs');
    boundedText(action.reason,'action reason',2000);
  }
  if (new Set(plan.cancel_task_ids).size !== plan.cancel_task_ids.length) throw new Error('Duplicate task cancellation');
  for (const id of plan.cancel_task_ids) {
    if (typeof id !== 'string') throw new Error('Invalid cancellation task ID');
    const task = s.tasks.find(t => t.id === id);
    if (!task || task.arrangement_id || !activeTask(task)) throw new Error('Only pending information tasks may be cancelled by a plan');
    task.status = 'cancelled'; task.result = 'Coordinator reconsidered the question';
  }
  const updatedTasks = new Set<string>();
  for (const update of updates) {
    boundedText(update.task_id,'mission task ID',300);
    boundedText(update.objective,'mission objective',2000);
    if (updatedTasks.has(update.task_id)) throw new Error('Duplicate mission update');
    updatedTasks.add(update.task_id);
    if (!Array.isArray(update.focus_fields) || update.focus_fields.length > Object.keys(emptyFacts()).length
      || update.focus_fields.some(field=>typeof field !== 'string' || !Object.prototype.hasOwnProperty.call(emptyFacts(),field))
      || new Set(update.focus_fields).size !== update.focus_fields.length) throw new Error('Invalid mission focus fields');
    const task=s.tasks.find(t=>t.id===update.task_id);
    if (!task || !activeTask(task) || task.arrangement_id || !['assess','needs','location','capability'].includes(task.kind)) throw new Error('Only active information missions can be revised');
    const participant=person(s,task.profile_id);
    if (!participant.consent || participant.contact_blocked || participant.unreachable || requiresInformationReview(s,participant.profile_id)) throw new Error('Mission participant is unavailable or needs human review');
    if (task.attempt_id !== null && s.closing_attempts?.includes(task.attempt_id)) throw new Error('Cannot revise a finishing conversation');
    const brief={objective:update.objective,reason:update.reason,evidence_ids:[...update.evidence_ids],focus_fields:[...update.focus_fields]};
    const old=task.coordinator_brief;
    if (old && old.objective===brief.objective && old.reason===brief.reason && JSON.stringify(old.evidence_ids)===JSON.stringify(brief.evidence_ids) && JSON.stringify(old.focus_fields)===JSON.stringify(brief.focus_fields)) continue;
    task.coordinator_brief={...brief,revision:(old?.revision??0)+1,issued_at:now};
    addMessage(s,'Updated the conversation mission for '+participant.name+': '+brief.objective,now,'decision');
  }
  const seenQuestions = new Set<string>();
  for (const q of plan.questions) {
    if (!validId(q.profile_id) || !['needs','location','capability'].includes(q.kind)) throw new Error('Unsupported question type or participant');
    const key = q.profile_id + ':' + q.kind;
    if (seenQuestions.has(key)) throw new Error('Duplicate question in plan');
    seenQuestions.add(key);
    const p = person(s,q.profile_id);
    if (p.unreachable || !p.consent || p.contact_blocked || requiresInformationReview(s,p.profile_id)) continue;
    if (s.tasks.some(t=>t.profile_id===q.profile_id && !t.arrangement_id && activeTask(t))) continue;
    // Unknown/refused answers require review. A later correction can reopen an
    // answered question only when its relevant facts have become incomplete.
    if (s.tasks.some(t => t.profile_id === q.profile_id && t.kind === q.kind && (
      ['pending','delivered','blocked'].includes(t.status)
      || (t.status === 'completed' && (s.revision <= (t.completed_revision ?? s.revision) || informationGaps(q.kind,p.facts).length === 0))
    ))) continue;
    addTask(s,q.profile_id,q.kind,now,q.reason);
  }
  const matching=spatialMatching(s);
  if(plan.proposals.length && matching.waiting)throw new Error('Wait for pending information tasks before proposing geographic matches');
  for (const proposal of plan.proposals) {
    if(!matching.recommended.some(pair=>pair.recipient_id===proposal.recipient_id&&pair.helper_id===proposal.helper_id))throw new Error('Proposal must use the current maximum-coverage, minimum-distance comparison');
    if (!validId(proposal.recipient_id) || !validId(proposal.helper_id)) throw new Error('Invalid arrangement participant');
    const reasons = matchReasons(s,proposal.recipient_id,proposal.helper_id);
    if (reasons.length) throw new Error('Ineligible arrangement: ' + reasons.join('; '));
    const required = requiredMatchSources(s,proposal.recipient_id,proposal.helper_id);
    if (!required.every(id => proposal.evidence_ids.includes(id))) throw new Error('Proposal must cite all current findings supporting need, suitability, capacity and locations');
    const a: Arrangement = { id:'arrangement:' + s.case_id + ':' + (s.arrangements.length+1),recipient_id:proposal.recipient_id,helper_id:proposal.helper_id,evidence_ids:[...proposal.evidence_ids],reason:proposal.reason,status:'proposed',helper_accepted:false,recipient_confirmed:false,pickup_confirmations:[],arrival_confirmations:[],created_at:now,updated_at:now };
    s.arrangements.push(a);
  }
  // A summary must not hide unresolved tasks or unreachable participants already recorded.
  const unresolved = s.tasks.find(t => t.status === 'blocked'), unreachable = s.people.find(p => p.unreachable);
  s.review = plan.review ?? (unresolved ? person(s,unresolved.profile_id).name + ': ' + (unresolved.result || 'A task remains unresolved') : unreachable ? unreachable.name + ' was not reached; human follow-up is needed.' : s.review);
  s.planned_revision = s.revision; s.failure_count = 0; s.error = '';
  addMessage(s,plan.summary,now,plan.review ? 'review' : 'decision');
}
