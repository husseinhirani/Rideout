import { createHash } from 'node:crypto'
import { query, asString, callReducer, attempts, attemptProgress, profiles } from './db'
import { verifiedAttemptCall } from './call-transcript'
import { readInformationState, runInformationCommand } from './information'
import { object, commandId, canonicalJson } from '../shared/information'
import { person, taskInstruction, type AssistanceState, type VoiceUpdate } from '../shared/assistance'
import { voiceMission, informationGaps } from '../shared/voice-mission'
import { answerCoordinator } from './assistance-agent'
import { ServiceError } from './service'
import { hydrateLegacyCoordinatorFailure, classifyCoordinatorError } from '../shared/coordinator-errors'

export async function assistanceStates(): Promise<AssistanceState[]> {
  return (await query('SELECT * FROM assistance_session')).map(row=>hydrateLegacyCoordinatorFailure(JSON.parse(asString(row.state_json)) as AssistanceState))
}
export function publicAssistance(s: AssistanceState): AssistanceState {
  return {...s,people:s.people.map(({simulation,...p})=>p)}
}
export async function assistanceState(caseId: number) {
  const state=(await assistanceStates()).find(s=>s.case_id===caseId)
  if(!state)throw new ServiceError(404,'This case has no assistance coordinator')
  return state
}
/** Provider-authenticated callback; caller identity is bound to a saved outbound attempt. */
export async function coordinateCall(body: unknown) {
  const input=object(body,'call update'),attemptId=Number(input.attempt_id),callId=String(input.provider_call_id??'')
  if(!Number.isSafeInteger(attemptId)||attemptId<1||!callId)throw new ServiceError(400,'Missing call binding')
  const verified=await verifiedAttemptCall(attemptId)
  if(!verified || verified.callId!==callId)throw new ServiceError(409,'Call identity is not verified yet; retry shortly')
  const attempt=(await attempts()).find(a=>a.id===attemptId)!
  if(!(await assistanceStates()).some(s=>s.case_id===attempt.support_case_id))return {status:'disabled',instruction:'This call has no live coordinator. Continue the assigned question and use report_call on completion.'}
  const update=voiceUpdate(input)
  if(update)try{await callReducer('recordAssistanceUpdate',[attemptId,callId,JSON.stringify(update)])}catch(error){
    if(!/Stale update sequence|conflicts with another input|Update ID conflicts/i.test(error instanceof Error?error.message:''))throw error
    const current=await nextVoiceTask(attempt.support_case_id,attemptId,callId)
    if(!('next_sequence' in current) || ['paused','unavailable','finished'].includes(current.status))return {...current,update_saved:false,retry_allowed:false,instruction:current.instruction+' The rejected update was not saved. Do not retry the coordination update or restart questioning.'}
    return {...current,status:'resync_required',retry_allowed:true,mission_status:current.status,update_saved:false,instruction:'This update was not saved because its sequence was already used or superseded. Use the larger of next_sequence and your last submitted sequence plus one for a new corrected account. Never reuse a sequence with changed content. This response shows what is persisted; preserve the caller’s unsaved corrections instead of discarding them. Do not restart questioning if the call is finishing, paused or unavailable; honor a stop request immediately.'}
  }
  if(input.operation==='finish')return {status:'finished',instruction:'Your final update is saved. No further task will be delivered to this call. Submit report_call if appropriate and end normally; honor a stop request immediately.'}
  return nextVoiceTask(attempt.support_case_id,attemptId,callId)
}
function voiceUpdate(input: Record<string,unknown>): VoiceUpdate | null {
  if(input.operation!=='update' && input.operation!=='check' && input.operation!=='finish')throw new ServiceError(400,'Invalid coordination operation')
  if(input.operation==='check')return null
  const rawFacts=typeof input.facts_json==='string'?JSON.parse(input.facts_json):input.facts??{}
  const result:VoiceUpdate={sequence:Number(input.sequence),text:typeof input.text==='string'?input.text:'',facts:rawFacts as VoiceUpdate['facts']}
  if(typeof input.task_id==='string'&&input.task_id)result.task_id=input.task_id
  if(input.result && input.result!=='pending')result.result=input.result as VoiceUpdate['result']
  if(input.confirmation && input.confirmation!=='none')result.confirmation=input.confirmation as VoiceUpdate['confirmation']
  if(input.do_not_call===true)result.do_not_call=true
  if(input.mission_revision!==undefined)result.mission_revision=input.mission_revision as number
  if(typeof input.human_review==='string' && input.human_review.trim())result.human_review=input.human_review.trim()
  if(input.operation==='finish')result.finished=true
  return result
}
export async function nextVoiceTask(caseId:number,attemptId:number,callId:string) {
  let state=await assistanceState(caseId)
  const current=(await readInformationState()).cases.find(c=>c.id===caseId)
  if(state.paused || current?.policy.paused || current?.status!=='open')return {status:'paused',instruction:'No new tasks are authorized. Acknowledge any information already received and finish normally; honor a request to stop immediately.'}
  try{await callReducer('deliverAssistanceTask',[attemptId,callId])}catch(error){
    if(!/no longer available|consent|permission|unavailable|closed|paused|closing/i.test(error instanceof Error?error.message:''))throw error
    return {status:'unavailable',instruction:'No further task is authorized for this call. Do not repeat an earlier instruction. Finish normally, or hang up immediately if requested.'}
  }
  state=await assistanceState(caseId)
  const next_sequence=1+state.findings.filter(f=>f.attempt_id===attemptId).reduce((max,f)=>Math.max(max,Number(f.id.split(':').at(-1))||0),0)
  const task=state.tasks.find(t=>t.attempt_id===attemptId&&t.status==='delivered')
  const p=state.people.find(p=>state.tasks.some(t=>t.attempt_id===attemptId&&t.profile_id===p.profile_id))
  if(p && (!p.consent || p.contact_blocked))return {status:'unavailable',next_sequence,instruction:'No further task is authorized for this participant. Do not disclose or repeat a previous arrangement instruction. Finish normally.'}
  if(p?.review_reason)return {status:'needs_review',next_sequence,instruction:'The participant’s concern is saved for dispatcher review. No new commitment or further ordinary questioning is authorized. Close naturally, and honor any immediate stop request.',review_reason:p.review_reason,known_facts:p.facts,mission_revision:0,state_revision:state.revision}
  if(task) {
    const instruction=taskInstruction(state,task)
    const history=(await attempts()).filter(a=>a.support_case_id===caseId && a.profile_id===task.profile_id && a.id!==attemptId && (a.answer?.trim() || a.concern?.trim())).sort((a,b)=>a.id-b.id)
    const prior_reports=history.slice(-3).map(a=>({source_id:'attempt:'+a.id,attempt_id:a.id,provenance:'prior_call_report',outcome:a.outcome,account:(a.answer??'').slice(0,1600),concern:(a.concern??'').slice(0,800),truncated:(a.answer?.length??0)>1600 || (a.concern?.length??0)>800}))
    return {status:'task',next_sequence,task_id:task.id,kind:task.kind,instruction,
      mission_revision:task.coordinator_brief?.revision??0,
      mission:{...voiceMission(state,task,instruction),prior_reports,omitted_prior_reports:Math.max(0,history.length-prior_reports.length)},
      suggested_location:state.scenario.locations.find(l=>l.id===p?.start_location_id)??null,
      suggested_location_source:'Assigned scenario starting point; unconfirmed until the participant explicitly confirms it.',
      known_facts:person(state,task.profile_id).facts,locations:state.scenario.locations.map(l=>({id:l.id,label:l.label})),state_revision:state.revision}
  }
  const recent=state.tasks.filter(t=>t.attempt_id===attemptId).at(-1)
  const needsReview=Boolean(p?.review_reason) || recent?.status==='blocked' || Boolean(p && informationGaps('assess',p.facts).length && !state.arrangements.some(a=>[a.recipient_id,a.helper_id].includes(p.profile_id)&&a.status!=='cancelled'))
  return {status:needsReview?'needs_review':'resolved',next_sequence,
    instruction:needsReview
      ? 'The findings are saved, but unresolved information needs dispatcher review. Do not repeat declined or unavailable questions or imply assistance is arranged. Close naturally if the person is finished; an immediate stop request takes priority.'
      : 'The currently authorized conversation mission is resolved. Summarize the actual outcome briefly and close naturally; do not promise an unapproved arrangement or callback. Future milestones require their own authorization.',
    mission:recent?{...voiceMission(state,recent,recent.reason),completion:needsReview?'needs_review':'resolved'}:null,
    known_facts:p?.facts??{},mission_revision:recent?.coordinator_brief?.revision??0,state_revision:state.revision}

}
const chats=new Map<string,Promise<unknown>>()
export async function coordinatorCommand(caseId:number,body:unknown,actor:string) {
  const input=object(body,'coordinator command')
  if(input.action!=='message')return runInformationCommand('assistanceOperator',body,actor,caseId)
  const id=commandId(input.command_id)
  const fingerprint=createHash('sha256').update(canonicalJson({caseId,input})).digest('hex')
  const existing=chats.get(fingerprint);if(existing)return existing
  const work=(async()=>{
    await runInformationCommand('assistanceOperator',body,actor,caseId)
    const state=await assistanceState(caseId)
    if(state.messages.some(m=>m.id==='chat-reply:'+id))return {status:'recorded'}
    // A saved planning failure must not permanently block an explicit chat retry.
    // Chat cannot execute plans; leave the planning hold for Retry planning to clear.
    try{
      const reply=await answerCoordinator(state,String(input.text))
      await callReducer('recordAssistanceChat',[caseId,id,reply])
    }catch(error){const failure=classifyCoordinatorError(error);throw new ServiceError(503,'Your message was saved, but the coordinator could not answer. '+failure.message+' Retrying this message will not save it twice.')}
    return {status:'recorded'}
  })();chats.set(fingerprint,work)
  try{return await work}finally{chats.delete(fingerprint)}
}
export async function callSnapshot(){const [a,p,info]=await Promise.all([attempts(),attemptProgress(),readInformationState()]);return {attempts:a,progress:p,information:info}}
