import { emptyFacts, type Arrangement, type AssistanceState, type Facts, type Participant, type Task } from '../shared/assistance'
import { EVACUATION_DRILL } from '../mock/evacuation'

export const T = Date.parse('2026-10-25T15:00:00Z')
function person(id: number, name: string, facts: Partial<Facts> = {}, extra: Partial<Participant> = {}): Participant {
  return { profile_id:id, name, mode:'simulated', facts:{...emptyFacts(),...facts}, sources:{}, consent:true, unreachable:false, ...extra }
}
/** Fictional drill state: West has an arrived ride, a self-evacuee and an unknown; East has a needs-help and an unreachable. */
export function drill(): AssistanceState {
  const s: AssistanceState = { case_id:7, revision:12, planned_revision:12, paused:false, scenario:EVACUATION_DRILL, people:[
    person(1,'Helen Cho'), person(2,'Daniel Ruiz'), person(3,'Grace Park'), person(4,'Omar Ali'),
    person(5,'Iris Kim',{},{unreachable:true}), person(6,'Ben Lewis',{location_id:'drill-point-1'}), person(7,'Ava Reed',{},{start_location_id:'drill-point-1'}),
  ], findings:[], tasks:[], arrangements:[], messages:[], review:null, failure_count:0, retry_at:0, error:'', processed_reports:[] }
  const report = (profile: number, attempt: number, seq: number, changes: Partial<Facts>, at = T) => {
    const id = 'voice:'+attempt+':'+seq
    s.findings.push({ id, profile_id:profile, attempt_id:attempt, text:'Simulated participant report', changes, at })
    const p = s.people.find(p => p.profile_id === profile)!
    Object.assign(p.facts,changes); for (const key of Object.keys(changes)) p.sources[key as keyof Facts] = id
    return id
  }
  report(1,11,1,{location_id:'west',needs_transport:true,party_size:1})
  report(2,12,1,{location_id:'west',needs_transport:false,can_help:true,seats:2})
  report(3,13,1,{location_id:'west',needs_transport:false})
  report(4,14,1,{location_id:'east',needs_transport:true})
  const ride: Arrangement = { id:'arrangement:7:1', recipient_id:1, helper_id:2, evidence_ids:['voice:11:1','voice:12:1'], reason:'Nearest eligible helper', status:'completed', helper_accepted:true, recipient_confirmed:true, pickup_confirmations:[1,2], arrival_confirmations:[1,2], created_at:T, updated_at:T }
  s.arrangements.push(ride)
  const task = (id: string, profile: number, attempt: number, at: number): Task => ({ id, profile_id:profile, kind:'arrival', arrangement_id:ride.id, reason:'Confirm arrival', status:'completed', attempt_id:attempt, created_at:at, delivered_at:at, call_count:1, due_at:at, result:'arrived' })
  s.tasks.push(task('task:7:1',1,21,T+1000), task('task:7:2',2,22,T+1000))
  report(1,21,1,{},T+2000); report(2,22,1,{},T+2000)
  return s
}
