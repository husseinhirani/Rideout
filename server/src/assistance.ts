import { createHash } from 'node:crypto'
import { query, asString, callReducer, attempts, attemptProgress, profiles } from './db'
import { verifiedAttemptCall } from './call-transcript'
import { readInformationState, runInformationCommand } from './information'
import { object, commandId, canonicalJson } from '../shared/information'
import { person, taskInstruction, type AssistanceState, type VoiceUpdate } from '../shared/assistance'
import { answerCoordinator } from './assistance-agent'
import { districtLedger, type Ledger } from '../shared/districts'
import { ServiceError } from './service'

export async function assistanceStates(): Promise<AssistanceState[]> {
  return (await query('SELECT * FROM assistance_session')).map(row=>JSON.parse(asString(row.state_json)) as AssistanceState)
}
/** The ledger is recomputed on every read so the UI's numbers always come from current records. */
export function publicAssistance(s: AssistanceState): AssistanceState & { ledger: Ledger } {
  return {...s,people:s.people.map(({simulation,...p})=>p),ledger:districtLedger(s,Date.now())}
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
  if(update)await callReducer('recordAssistanceUpdate',[attemptId,callId,JSON.stringify(update)])
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
  return task?{status:'task',next_sequence,task_id:task.id,kind:task.kind,instruction:taskInstruction(state,task),suggested_location:state.scenario.locations.find(l=>l.id===p?.start_location_id)??null,known_facts:person(state,task.profile_id).facts,locations:state.scenario.locations.map(l=>({id:l.id,label:l.label})),revision:state.revision}
    :{status:'waiting',next_sequence,instruction:'No further question is ready. Do not promise a callback or keep the person waiting. If they are finished, submit the final report and end normally. Another authorized task can be handled by a later call.',known_facts:p?.facts??{},revision:state.revision}
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
    try{
      const reply=await answerCoordinator(state,String(input.text))
      await callReducer('recordAssistanceChat',[caseId,id,reply])
    }catch{throw new ServiceError(503,'Your message was saved, but the coordinator could not answer yet. Retry to request the reply without saving it twice.')}
    return {status:'recorded'}
  })();chats.set(fingerprint,work)
  try{return await work}finally{chats.delete(fingerprint)}
}
export async function callSnapshot(){const [a,p,info]=await Promise.all([attempts(),attemptProgress(),readInformationState()]);return {attempts:a,progress:p,information:info}}
