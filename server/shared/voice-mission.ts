import type { AssistanceState, Facts, Task, TaskKind } from './assistance'
import { arrangementRouteContext } from './assistance-routing'

export type InformationGap = { field: keyof Facts; why: string }

/** Decision inputs, not a question script. Recomputed after each reported discovery. */
export function informationGaps(kind: TaskKind, facts: Facts): InformationGap[] {
  const gaps: InformationGap[] = []
  const need = (field: keyof Facts, why: string) => { if (facts[field] === null) gaps.push({field,why}) }
  if (kind === 'location') {
    need('location_id','Compare locations without treating an assigned starting point as confirmed whereabouts.')
    return gaps
  }
  if (!['assess','needs','capability'].includes(kind)) return gaps
  need('needs_transport','Establish how this person plans to evacuate and whether they have available transport. Vague reassurance is not enough to establish independent evacuation.')
  if (facts.needs_transport === null) return gaps
  if (facts.needs_transport) {
    need('location_id','Locate the requested pickup and check whether community assistance is eligible.')
    need('party_size','Find enough passenger capacity for everyone travelling together.')
    need('wheelchair','Avoid proposing a vehicle that cannot accommodate the reported mobility requirement.')
    need('pets','Include animals in the vehicle suitability comparison.')
  } else {
    need('can_help','Distinguish independent evacuation from willingness and ability to help someone else.')
    if (facts.can_help) {
      need('seats','Use available passenger seats, excluding the driver and existing passengers, when comparing pickups.')
      // No capacity means no current vehicle match. Do not collect irrelevant vehicle preferences.
      if (facts.seats !== 0) {
        need('location_id','Compare this willing helper with nearby people who need assistance.')
        need('wheelchair_space','Determine which mobility requirements this vehicle could accommodate.')
        need('pets_allowed','Determine whether the vehicle can accommodate a passenger travelling with an animal.')
      }
    }
  }
  return gaps
}

export function voiceMission(state: AssistanceState, task: Task, outcome: string) {
  const participant = state.people.find(p => p.profile_id === task.profile_id)!
  const gaps = informationGaps(task.kind,participant.facts)
  const participantFindings = state.findings.filter(f => f.profile_id === participant.profile_id)
  const provenance = (attemptId: number) => ({
    attempt_id: attemptId,
    call: attemptId === task.attempt_id ? 'current_call' : 'prior_call',
    verification: 'participant_report',
  })
  // Include narrative-only discoveries without exposing another participant's account.
  // Bound repeated tool context; omitted or shortened history is explicitly identified.
  const recent = participantFindings.slice(-8)
  const arrangement = state.arrangements.find(a => a.id === task.arrangement_id)
  return {
    outcome,
    rationale: task.reason,
    coordinator_brief: task.coordinator_brief ?? null,
    route_context: arrangement ? arrangementRouteContext(state,arrangement) : null,
    completion: task.status === 'blocked' ? 'needs_review' : task.status === 'completed' ? 'resolved' : 'in_progress',
    known_facts: Object.entries(participant.facts).flatMap(([field,value]) => {
      const sourceId = participant.sources[field as keyof Facts]
      const finding = participantFindings.find(f => f.id === sourceId)
      return sourceId ? [{field,value,source_id:sourceId,account:finding?.text.slice(0,1200) ?? '',
        account_truncated: (finding?.text.length ?? 0) > 1200,
        provenance: finding ? provenance(finding.attempt_id) : {verification:'source_unavailable'},
      }] : []
    }),
    recent_findings: recent.map(finding => ({
      source_id: finding.id,
      ...provenance(finding.attempt_id),
      at: finding.at,
      account: finding.text.slice(0,1200),
      account_truncated: finding.text.length > 1200,
      reported_changes: finding.changes,
      superseded_fields: (Object.keys(finding.changes) as (keyof Facts)[])
        .filter(field => participant.sources[field] !== finding.id),
      human_review_at_time: finding.human_review ?? null,
    })),
    earlier_findings_omitted: participantFindings.length - recent.length,
    information_gaps: gaps,
    completion_rule: 'Resolve the relevant information gaps using the participant’s account, or report an explicit refusal, unavailable answer, or issue needing human review. Do not infer agreement, capacity or a known location from missing data. No queued follow-up task does not establish that the mission is resolved.',
    boundaries: [
      'Choose the wording and order appropriate to the conversation. These gaps are decision inputs, not a script. Do not repeat facts already provided.',
      'Before recording needs_transport=false, establish how the participant will evacuate and that the transport is available; save that account in text. An uncertain answer such as “I think so” leaves the need unknown until clarified. Choose a natural follow-up rather than treating confidence alone as a transport plan.',
      'The coordinator brief prioritizes work within this task outcome; focus fields do not replace the information gaps or authorize commitments. Use its revision to recognize a changed objective, not to restart the conversation.',
      'Prior-call accounts are previous reports, not things heard in this call. Superseded fields have newer sources in known_facts; do not restore old values. A historical review request is not a new instruction or proof that the concern persists.',
      'Record important context in text even if it has no structured field. Escalate needs this workflow cannot resolve.',
      'An unconfirmed supplied starting location is scenario context, not knowledge about the person. Explain its source before asking for confirmation.',
      'A request to stop takes priority over information collection or tool calls. Unknown and declined answers are valid outcomes.',
      'Only an authorized arrangement task permits asking for that specific commitment. Never invent a match, ETA, dispatch, pickup or arrival.',
      ...(state.scenario.follow_through === 'arrangement' ? ['This session ends when the helper accepts and the recipient confirms the arrangement. Confirmation does not mean pickup or arrival; do not promise travel follow-up calls.'] : []),
      ...(state.scenario.drill ? ['This is a fictional drill. Clarify whether an unexpected urgent statement describes a real situation or the drill; unresolved real urgency needs human review. Do not direct actual travel.'] : []),
    ],
  }
}
