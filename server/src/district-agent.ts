import { askStrictWithMetadata, objectSchema } from './llm'
import { type AssistancePlan, type AssistanceState } from '../shared/assistance'
import { EVAC_STATUSES, UNASSIGNED, type Ledger } from '../shared/districts'
import { checkBrief, checkDistrictReport, ledgerBrief, ledgerReport, type CoreBrief, type DistrictReport } from '../shared/trust-check'
const string={type:'string'}, integer={type:'integer'}, refs={type:'array',items:string}, ids={type:'array',items:integer}
const reportSchema=objectSchema({
  summary:string,
  claims:{type:'array',items:objectSchema({id:string,text:string,status:{anyOf:[{type:'string',enum:EVAC_STATUSES},{type:'null'}]},profile_ids:ids,evidence_ids:refs},['id','text','status','profile_ids','evidence_ids'])},
  questions:{type:'array',items:objectSchema({profile_id:integer,kind:{type:'string',enum:['needs','location','capability']},reason:string,evidence_ids:refs},['profile_id','kind','reason','evidence_ids'])},
  escalations:{type:'array',items:string},
},['summary','claims','questions','escalations'])
const briefSchema=objectSchema({
  headline:string,
  district_lines:{type:'array',items:objectSchema({district_id:string,text:string,claim_ids:refs},['district_id','text','claim_ids'])},
  disagreements:{type:'array',items:string},asks_for_human:{type:'array',items:string},
},['headline','district_lines','disagreements','asks_for_human'])

const DISTRICT_SYSTEM='You are a RideOut district agent. You manage evacuation for the people in ONE district of an incident and report up to a core agent, which reports to a human dispatcher. ' +
'The ledger in your input is computed by code from saved phone reports; it is the source of truth for counts and statuses. Never contradict it, round it, or count unknown or unreachable people as evacuated. Findings are participant reports, not verified facts. A drill is fictional. ' +
'Write claims the human can check: each claim names the profile_ids it covers, the ledger status they share (or null for a general remark), and evidence_ids taken from those people\'s ledger evidence_ids or findings. Prefer one claim per status group. Any number you write must equal a ledger figure. A verifier rejects unsupported claims and the human sees the rejection. ' +
'Choose at most four next questions for people in your district only: location for people without a confirmed location, needs for people whose ability to leave is unknown, capability for possible helpers. Do not repeat pending, delivered, blocked or completed tasks. Do not ask unreachable people. ' +
'Put anything you cannot resolve inside your district in escalations: needing a helper from another district, specialist-only access, contradictory reports, people not reached. Keep summary to two sentences.'
const UNASSIGNED_SYSTEM=' Your district is the set of people with NO confirmed location. Your main job is confirming where they are; a seeded starting point is only a hint.'
const CORE_SYSTEM='You are the RideOut core agent. District agents manage evacuation in their districts and report to you; you report to the human dispatcher. ' +
'You receive the code-computed ledger and each district report with its verification result. The human will see every check, so only repeat district claims whose check passed, cite them by claim_ids, and say plainly when a district report failed verification or came from the ledger fallback. ' +
'Every number you write must equal a ledger figure. Unknown and unreachable people are unaccounted for, never safe; never imply a district is clear while anyone in it is unaccounted for. Only the human can declare a district clear. ' +
'headline: one sentence with the incident-wide arrived and unaccounted figures. One district_line per district with people, most urgent first. disagreements: contradictions between reports, districts or the ledger. asks_for_human: concrete decisions only the human can make (approvals, specialist access, unreachable people, declaring a district clear). A drill is fictional.'

/** One district's slice of the incident. Hidden simulation answers never leave the server. */
export function districtSnapshot(s: AssistanceState, ledger: Ledger, districtId: string) {
  const tally=ledger.districts.find(t=>t.district.id===districtId)!, members=new Set(ledger.people.filter(p=>p.district_id===districtId).map(p=>p.profile_id))
  return { district:tally.district, tally, ledger_people:ledger.people.filter(p=>members.has(p.profile_id)), scenario:{title:s.scenario.title,drill:s.scenario.drill,context:s.scenario.context,destination:s.scenario.destination,locations:s.scenario.locations},
    people:s.people.filter(p=>members.has(p.profile_id)).map(({simulation,...p})=>p), findings:s.findings.filter(f=>members.has(f.profile_id)),
    tasks:s.tasks.filter(t=>members.has(t.profile_id)), arrangements:s.arrangements.filter(a=>members.has(a.recipient_id)||members.has(a.helper_id)),
    disagreements:ledger.disagreements.filter(d=>d.district_id===districtId), server_time_ms:ledger.computed_at }
}
/** District agents may only ask about their own people, citing evidence that exists. */
export function admissibleQuestions(s: AssistanceState, ledger: Ledger, report: DistrictReport): AssistancePlan['questions'] {
  const evidence=new Set(s.findings.map(f=>f.id))
  return report.questions.filter(q=>ledger.people.some(p=>p.profile_id===q.profile_id&&p.district_id===report.district_id)&&q.evidence_ids.every(id=>evidence.has(id))).slice(0,4)
}
export async function districtReport(s: AssistanceState, ledger: Ledger, districtId: string): Promise<DistrictReport> {
  let report: DistrictReport
  try{
    const {value,model,request_id}=await askStrictWithMetadata<Pick<DistrictReport,'summary'|'claims'|'questions'|'escalations'>>({system:DISTRICT_SYSTEM+(districtId===UNASSIGNED?UNASSIGNED_SYSTEM:''),input:districtSnapshot(s,ledger,districtId),schema:reportSchema})
    report={...value,district_id:districtId,based_on_revision:ledger.revision,source:'model',model,request_id}
  }catch(error){report=ledgerReport(ledger,districtId,error instanceof Error?error.message:'District agent unavailable')}
  report.check=checkDistrictReport(s,ledger,report)
  return report
}
export async function coreBrief(s: AssistanceState, ledger: Ledger, reports: Record<string,DistrictReport>, now: number): Promise<CoreBrief> {
  let brief: CoreBrief
  try{
    // The core sees district reports and the ledger, not raw findings: it relies on its districts, and the human can drill down.
    const {value,model,request_id}=await askStrictWithMetadata<Pick<CoreBrief,'headline'|'district_lines'|'disagreements'|'asks_for_human'>>({system:CORE_SYSTEM,input:{incident:{title:s.scenario.title,drill:s.scenario.drill,destination:s.scenario.destination},ledger:{totals:ledger.totals,districts:ledger.districts,disagreements:ledger.disagreements},district_reports:Object.values(reports),pending_proposals:s.arrangements.filter(a=>a.status==='proposed').length,server_time_ms:now},schema:briefSchema})
    brief={...value,based_on_revision:ledger.revision,created_at:now,source:'model',model,request_id}
  }catch(error){brief=ledgerBrief(ledger,now,error instanceof Error?error.message:'Core agent unavailable')}
  brief.check=checkBrief(s,ledger,reports,brief)
  return brief
}
