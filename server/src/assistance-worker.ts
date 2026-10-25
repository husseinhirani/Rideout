import { callReducer } from './db'
import { assistanceStates, assistanceState, callSnapshot, nextVoiceTask } from './assistance'
import { planAssistance } from './assistance-agent'
import { type AssistanceState, type Task, type VoiceUpdate } from '../shared/assistance'

export function startAssistanceWorker():()=>void {
  let stopped=false,scanning=false
  const planning=new Set<number>(), simulating=new Set<number>(), lastRevision=new Map<number,{revision:number,at:number}>()
  async function plan(s:AssistanceState){
    if(planning.has(s.case_id)||s.paused||s.planned_revision===s.revision||s.failure_count>=3||s.retry_at>Date.now())return
    const seen=lastRevision.get(s.case_id)
    if(!seen||seen.revision!==s.revision){lastRevision.set(s.case_id,{revision:s.revision,at:Date.now()});return}
    if(Date.now()-seen.at<700)return
    planning.add(s.case_id)
    try{const result=await planAssistance(s);if(!stopped)await callReducer('commitAssistancePlan',[s.case_id,s.revision,JSON.stringify(result)])}
    catch(error){if(!stopped)await callReducer('failAssistancePlan',[s.case_id,s.revision,error instanceof Error?error.message:'Planning failed'])}
    finally{planning.delete(s.case_id)}
  }
  async function dispatch(s:AssistanceState,task:Task,snapshot:Awaited<ReturnType<typeof callSnapshot>>){
    if(s.paused||task.status!=='pending'||task.attempt_id!==null||task.due_at>Date.now())return
    const person=s.people.find(p=>p.profile_id===task.profile_id)!
    if(!person.consent||person.unreachable)return
    const current=snapshot.information.cases.find(c=>c.id===s.case_id)
    if(!current||current.status!=='open'||current.policy.paused)return
    const pending=snapshot.attempts.some(a=>a.profile_id===task.profile_id && ['queued','dispatching','active','unknown'].includes(snapshot.progress.find(p=>p.attempt_id===a.id)?.transport??'unknown'))
    if(pending)return // The ongoing call can fetch the new task itself.
    try{await callReducer('queueAssistanceTask',[s.case_id,task.id])}
    catch(error){const message=error instanceof Error?error.message:'Could not queue follow-up'
      if(/budget|consent|outside authorized|unavailable|not found/i.test(message))await callReducer('blockAssistanceTask',[s.case_id,task.id,message])
      // Cooldown, outstanding reports and concurrent changes are retried on the next scan.
    }
  }
  async function finishSimulation(attemptId:number,callId:string,text:string){
    const snapshot=await callSnapshot(), progress=snapshot.progress.find(p=>p.attempt_id===attemptId)
    if(!progress?.report_received)await callReducer('receiveInformationReport',[attemptId,callId,'outbound',text,''])
    if(!progress?.report_processed)await callReducer('finishInformationReport',[attemptId,true,'[]','',false])
    await callReducer('observeInformationTerminal',[attemptId,callId,'completed','simulated_completion'])
  }
  async function simulate(s:AssistanceState,attemptId:number,callId:string){
    if(simulating.has(attemptId))return
    simulating.add(attemptId)
    try{
      let fresh=await assistanceState(s.case_id)
      if(fresh.paused)return
      const response=await nextVoiceTask(s.case_id,attemptId,callId)
      if(response.status==='paused')return
      fresh=await assistanceState(s.case_id)
      if(fresh.paused)return
      const task=fresh.tasks.find(t=>t.attempt_id===attemptId&&t.status==='delivered')
      const profile=task&&fresh.people.find(p=>p.profile_id===task.profile_id)
      if(response.status!=='task'||!task||!profile?.simulation){
        await finishSimulation(attemptId,callId,fresh.findings.filter(f=>f.attempt_id===attemptId).slice(-1)[0]?.text??'Simulated call ended with no further authorized task.')
        return
      }
      const sequence=1+fresh.findings.filter(f=>f.attempt_id===attemptId).reduce((max,f)=>Math.max(max,Number(f.id.split(':').slice(-1)[0])||0),0)
      const facts=profile.simulation,location=fresh.scenario.locations.find(l=>l.id===facts.location_id)?.label??'an unknown location'
      const account=facts.needs_transport
        ? 'In this drill I am at '+location+' and need a ride for '+facts.party_size+' passenger(s). Wheelchair transport: '+(facts.wheelchair?'needed':'not needed')+'. Pets: '+(facts.pets?'yes':'no')+'.'
        : 'In this drill I am at '+location+' and can leave independently. '+(facts.can_help?'I am willing to help with '+facts.seats+' passenger seats. Wheelchair space: '+(facts.wheelchair_space?'yes':'no')+'. Pets allowed: '+(facts.pets_allowed?'yes':'no')+'.':'I cannot help with transport.')
      const update:VoiceUpdate={sequence,text:'Simulated participant: '+account,facts,task_id:task.id,result:'answered'}
      if(task.kind==='helper_accept'||task.kind==='recipient_confirm')update.confirmation='accepted'
      if(task.kind==='pickup')update.confirmation='picked_up'
      if(task.kind==='arrival')update.confirmation='arrived'
      if(update.confirmation){update.facts={};update.text='Simulated participant confirms: '+update.confirmation}
      await callReducer('recordAssistanceUpdate',[attemptId,callId,JSON.stringify(update)])
      await finishSimulation(attemptId,callId,update.text)
    }finally{simulating.delete(attemptId)}
  }
  async function scan(){
    if(scanning||stopped)return
    scanning=true
    try{
      const sessions=await assistanceStates()
      for(const session of sessions){
        await callReducer('synchronizeAssistance',[session.case_id])
        const s=await assistanceState(session.case_id), snapshot=await callSnapshot()
        if(snapshot.information.cases.find(c=>c.id===s.case_id)?.status!=='open')continue
        void plan(s).catch(()=>undefined)
        for(const task of s.tasks)await dispatch(s,task,snapshot)
        for(const a of snapshot.attempts.filter(a=>a.support_case_id===s.case_id&&a.call_id?.startsWith('sim_')&&s.people.some(person=>person.profile_id===a.profile_id&&person.mode==='simulated'))){
          const p=snapshot.progress.find(p=>p.attempt_id===a.id)
          if(p?.transport==='active' && Date.now()-(p.claimed_at_ms??Date.now())>5000)void simulate(s,a.id,a.call_id!).catch(error=>console.error('Simulated coordinator attempt '+a.id+': '+(error instanceof Error?error.message:'failed')))
        }
      }
    }catch(error){console.error('Assistance coordinator: '+(error instanceof Error?error.message:'scan failed'))}
    finally{scanning=false}
  }
  const timer=setInterval(()=>void scan(),1000);void scan()
  return()=>{stopped=true;clearInterval(timer)}
}
