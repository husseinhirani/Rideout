import { t, SenderError, type ReducerCtx } from 'spacetimedb/server'
import spacetimedb from '../models'
import { addMessage, addTask, applyFinding, applyPlan, cancelArrangement, matchReasons, person, requiresInformationReview, taskInstruction, touch, type AssistanceState, type VoiceUpdate } from '../../../shared/assistance'
import { canonicalJson, commandId, object, text, contactEligibility, matchesScope, type InformationPolicy } from '../../../shared/information'
import { decodeCoordinatorFailure, hydrateLegacyCoordinatorFailure } from '../../../shared/coordinator-errors'
type Ctx = ReducerCtx<typeof spacetimedb.schemaType>
const now = (ctx: Ctx) => Number(ctx.timestamp.microsSinceUnixEpoch)/1000
function read(ctx: Ctx, caseId: bigint) {
  const row = ctx.db.assistanceSession.case_id.find(caseId)
  if (!row) throw new SenderError('This case has no assistance coordinator')
  return { row, state: hydrateLegacyCoordinatorFailure(JSON.parse(row.state_json) as AssistanceState) }
}
function write(ctx: Ctx, caseId: bigint, s: AssistanceState) {
  ctx.db.assistanceSession.case_id.update({ case_id: caseId, revision: BigInt(s.revision), state_json: JSON.stringify(s) })
}
function open(ctx: Ctx, caseId: bigint, s: AssistanceState, allowPaused = false) {
  const c = ctx.db.informationCase.id.find(caseId)
  if (!c || c.status !== 'open' || (!allowPaused && (s.paused || JSON.parse(c.policy_json).paused))) throw new SenderError('Case is closed or paused')
  return c
}

function permitted(ctx: Ctx, caseId: bigint, s: AssistanceState, profileId: number) {
  const c=ctx.db.informationCase.id.find(caseId), settings=ctx.db.profileSettings.profile_id.find(BigInt(profileId))
  const directory=[...ctx.db.profile.iter()].map(p=>({...p,id:Number(p.id),contact_profile_ids:p.contact_profile_ids.map(Number)}))
  const p=directory.find(p=>p.id===profileId), participant=person(s,profileId)
  const pref=settings?{...settings,profile_id:profileId,tags:JSON.parse(settings.tags_json),availability:settings.availability as 'unknown'|'available'|'unavailable'}:undefined
  if(!c||!p||!matchesScope(p,JSON.parse(c.scope_json),directory,pref))throw new SenderError('Person is outside current contact permissions')
  const reasons=contactEligibility(p,pref).filter(reason=>!(participant.mode==='simulated'&&reason==='No dialable phone number'))
  if(reasons.length)throw new SenderError(reasons.join('; '))
}

/** Read current directory permissions in the same transaction that delivers/accepts a task.
 * Temporary scope or availability restrictions are not a withdrawal of consent. */
function reconcileContacts(ctx: Ctx, caseId: bigint, s: AssistanceState): boolean {
  let changed=false
  for(const participant of s.people){
    const consent=ctx.db.profileSettings.profile_id.find(BigInt(participant.profile_id))?.call_consent===true
    let blocked:string|null=null
    if(consent){try{permitted(ctx,caseId,s,participant.profile_id)}catch(error){blocked=error instanceof Error?error.message:'Contact is currently unavailable'}}
    if(participant.consent!==consent || (participant.contact_blocked??null)!==blocked){
      participant.consent=consent;participant.contact_blocked=blocked;changed=true
    }
    if(!consent || blocked){
      const reason=!consent?'Contact consent withdrawn':blocked!
      for(const task of s.tasks.filter(t=>t.profile_id===participant.profile_id&&['pending','delivered'].includes(t.status))){task.status='cancelled';task.result=reason;changed=true}
      for(const arrangement of s.arrangements.filter(a=>!['cancelled','completed'].includes(a.status)&&(a.helper_id===participant.profile_id||a.recipient_id===participant.profile_id))){cancelArrangement(s,arrangement,reason,now(ctx));changed=true}
    }
  }
  return changed
}

/** Accepted inbound accounts are separate evidence, never outbound findings or verified facts. */
function synchronizeIncomingReports(ctx: Ctx, caseId: bigint, s: AssistanceState): boolean {
  let changed=false
  for(const resolution of ctx.db.informationIncomingResolution.iter()) {
    if(resolution.support_case_id!==caseId || resolution.reporter_profile_id===undefined
      || !['automatic_update','operator_attach','intake'].includes(resolution.kind))continue
    const participant=s.people.find(p=>p.profile_id===Number(resolution.reporter_profile_id))
    const request=ctx.db.incomingRequest.id.find(resolution.request_id)
    // Unknown callers and reports awaiting association remain in the existing intake review.
    if(!participant || !request || request.direction!=='inbound' || request.support_case_id!==caseId
      || request.revision!==resolution.request_revision || !['recorded','attached'].includes(request.status))continue
    const id='incoming:'+request.id+':'+resolution.request_revision
    if(s.inbound_reports?.some(report=>report.id===id))continue
    // Accepted requests are immutable today; revision is retained for provenance and replay safety.
    const reports=s.inbound_reports??(s.inbound_reports=[])
    reports.push({id,request_id:Number(request.id),request_revision:Number(resolution.request_revision),
      support_case_id:Number(caseId),profile_id:participant.profile_id,
      source:resolution.kind as 'automatic_update'|'operator_attach'|'intake',verification:'phone_association_only',
      text:request.text,at:Number(resolution.created_at.microsSinceUnixEpoch)/1000})
    const notice='An incoming caller associated with '+participant.name+' reported an update. Identity and account are unverified; review it before changing assistance decisions.'
    addMessage(s,notice+' Request #'+request.id+': '+request.text.slice(0,2000)+(request.text.length>2000?' [Excerpt; full account is saved in the incoming report.]':''),now(ctx),'review')
    if(!s.review)s.review=notice
    changed=true
  }
  return changed
}

function receipt(ctx: Ctx, id: string, operation: string, payload: unknown, result?: unknown) {
  commandId(id)
  const old = ctx.db.operatorCommand.command_id.find(id)
  if (old) {
    if (old.operation !== operation || old.payload_json !== canonicalJson(payload)) throw new SenderError('Command ID conflicts with another input')
    return JSON.parse(old.result_json)
  }
  if (result !== undefined) ctx.db.operatorCommand.insert({ command_id:id,operation,payload_json:canonicalJson(payload),result_json:JSON.stringify(result),actor:'coordinator',created_at:ctx.timestamp })
  return null
}
export const commitAssistancePlan = spacetimedb.reducer({ case_id:t.u64(), expected_revision:t.u64(), plan_json:t.string() }, (ctx,args) => {
  const {state:s} = read(ctx,args.case_id); open(ctx,args.case_id,s)
  // Keep newly revoked permissions durable even when this model result is stale.
  if(reconcileContacts(ctx,args.case_id,s)){touch(s);write(ctx,args.case_id,s);return}
  if (s.revision !== Number(args.expected_revision) || s.planned_revision === s.revision) throw new SenderError('Stale coordinator plan')
  try{applyPlan(s,JSON.parse(args.plan_json),now(ctx))}catch(error){throw new SenderError(error instanceof Error?error.message:'Invalid coordinator plan')}
  s.planning_error=undefined
  write(ctx,args.case_id,s)
})
export const failAssistancePlan = spacetimedb.reducer({ case_id:t.u64(), expected_revision:t.u64(), message:t.string() }, (ctx,args) => {
  const {state:s} = read(ctx,args.case_id)
  const failure=decodeCoordinatorFailure(args.message)
  if ((!failure.blocked && s.revision !== Number(args.expected_revision)) || s.planned_revision===s.revision) return
  if(s.planning_error?.blocked)return
  s.failure_count++; s.planning_error=failure; s.error=failure.message
  s.retry_at=failure.blocked?0:now(ctx)+Math.min(60000,(failure.kind==='rate_limit'?15000:5000)*s.failure_count)
  if(failure.blocked || s.failure_count===3){
    const notice=failure.message+(failure.blocked?'':' Automatic planning retries stopped. Choose Retry planning when ready.')
    addMessage(s,notice,now(ctx),'review')
  }
  write(ctx,args.case_id,s)
})
export const recordAssistanceUpdate = spacetimedb.reducer({ attempt_id:t.u64(), provider_call_id:t.string(), update_json:t.string() }, (ctx,args) => {
  const a = ctx.db.attempt.id.find(args.attempt_id), p = ctx.db.attemptProgress.attempt_id.find(args.attempt_id)
  if (!a || !p || !a.call_id || a.call_id !== args.provider_call_id) throw new SenderError('Call binding mismatch')
  const {state:s} = read(ctx,a.support_case_id)
  const update = JSON.parse(args.update_json) as VoiceUpdate
  if (!Number.isSafeInteger(update.sequence) || update.sequence < 1 || update.sequence > 1000 || typeof update.text !== 'string') throw new SenderError('Invalid update sequence or text')
  if (update.result !== undefined && !['answered','declined','unknown'].includes(update.result)) throw new SenderError('Invalid task result')
  if (update.confirmation !== undefined && !['accepted','declined','picked_up','arrived'].includes(update.confirmation)) throw new SenderError('Invalid confirmation')
  if (update.do_not_call !== undefined && typeof update.do_not_call !== 'boolean') throw new SenderError('Invalid consent update')
  const id = 'voice:' + args.attempt_id + ':' + update.sequence
  if (receipt(ctx,id,'assistance_update',update)) return
  const lastSequence=s.findings.filter(f=>f.attempt_id===Number(args.attempt_id)).reduce((max,f)=>Math.max(max,Number(f.id.split(':').slice(-1)[0])||0),0)
  if(update.sequence<=lastSequence)throw new SenderError('Stale update sequence; fetch current instructions and use next_sequence')
  // Late information is preserved, but closure revokes all unfinished tasks and arrangements.
  if(ctx.db.informationCase.id.find(a.support_case_id)?.status!=='open'){
    s.paused=true
    for(const task of s.tasks.filter(t=>['pending','delivered'].includes(t.status))){task.status='cancelled';task.result='Case closed'}
    for(const arrangement of s.arrangements)cancelArrangement(s,arrangement,'Case closed',now(ctx))
  }
  reconcileContacts(ctx,a.support_case_id,s)
  // Pause stops new outreach; previously delivered commitments may still be recorded.
  applyFinding(s,Number(a.profile_id),Number(a.id),id,update,now(ctx))
  if(update.finished)s.closing_attempts=[...new Set([...(s.closing_attempts??[]),Number(a.id)])]
  if (update.do_not_call) {
    const settings = ctx.db.profileSettings.profile_id.find(a.profile_id)
    if (settings) ctx.db.profileSettings.profile_id.update({...settings,call_consent:false})
    for (const task of s.tasks.filter(t => t.profile_id === Number(a.profile_id) && ['pending','delivered'].includes(t.status))) { task.status='cancelled';task.result='Contact consent withdrawn' }
  }
  write(ctx,a.support_case_id,s); receipt(ctx,id,'assistance_update',update,{status:'recorded'})
})
export const deliverAssistanceTask = spacetimedb.reducer({ attempt_id:t.u64(), provider_call_id:t.string() }, (ctx,args) => {
  const a = ctx.db.attempt.id.find(args.attempt_id), p = ctx.db.attemptProgress.attempt_id.find(args.attempt_id)
  if (!a || a.call_id !== args.provider_call_id || !p || p.transport !== 'active' || p.report_received) throw new SenderError('Call is no longer available for tasks')
  const {state:s} = read(ctx,a.support_case_id); open(ctx,a.support_case_id,s)
  if(s.closing_attempts?.includes(Number(a.id)))throw new SenderError('Call is no longer available for tasks: finishing')
  // Commit revoked task/arrangement state rather than throwing and rolling it back.
  if(reconcileContacts(ctx,a.support_case_id,s)){touch(s);write(ctx,a.support_case_id,s)}
  const participant=person(s,Number(a.profile_id))
  if(!participant.consent || participant.contact_blocked)return
  const existing = s.tasks.find(t => t.profile_id === Number(a.profile_id) && t.attempt_id === Number(a.id) && t.status === 'delivered')
  if (existing) return
  const task = s.tasks.find(t => t.profile_id === Number(a.profile_id) && t.status === 'pending' && t.due_at <= now(ctx)
    && (t.attempt_id === Number(a.id) || (t.attempt_id === null
      && !(s.scenario.handoff_mode === 'callback' && ['helper_accept','recipient_confirm'].includes(t.kind)))))
  if (!task) return
  try{taskInstruction(s,task,now(ctx))}catch(error){throw new SenderError(error instanceof Error?error.message:'Task is no longer available')} // Reject stale or held work.
  task.attempt_id=Number(a.id);task.status='delivered';task.delivered_at=now(ctx)
  addMessage(s,'Agent speaking with '+person(s,task.profile_id).name+' received: '+task.reason,now(ctx));write(ctx,a.support_case_id,s)
})
export const assistanceOperator = spacetimedb.reducer({ case_id:t.u64(), command_id:t.string(), payload_json:t.string(), actor:t.string() }, (ctx,args) => {
  const input = object(JSON.parse(args.payload_json),'command'), payload={...input,case_id:Number(args.case_id)}
  if (receipt(ctx,args.command_id,'assistance_operator',payload)) return
  const {state:s} = read(ctx,args.case_id); const c = open(ctx,args.case_id,s,true)
  if (input.expected_revision !== s.revision) throw new SenderError('Stale incident revision; refresh and review the current proposal')
  if (input.action === 'approve' || input.action === 'reject' || input.action === 'cancel') {
    const a=s.arrangements.find(a=>a.id===input.arrangement_id)
    if (!a) throw new SenderError('Arrangement not found')
    if (input.action === 'approve') {
      open(ctx,args.case_id,s)
      if (a.status !== 'proposed') throw new SenderError('Only a current proposal can be approved')
      permitted(ctx,args.case_id,s,a.recipient_id);permitted(ctx,args.case_id,s,a.helper_id)
      const reasons=matchReasons(s,a.recipient_id,a.helper_id,a.id);if(reasons.length) throw new SenderError(reasons.join('; '))
      a.status='approved';a.updated_at=now(ctx)
      addTask(s,a.helper_id,'helper_accept',now(ctx),'Ask the helper to accept the approved proposal',a.id)
      addMessage(s,'You approved asking '+person(s,a.helper_id).name+' to help '+person(s,a.recipient_id).name+'. Acceptance is still pending.',now(ctx),'decision')
    } else {
      cancelArrangement(s,a,typeof input.reason === 'string' ? text(input.reason,'reason',1000) : 'The dispatcher withdrew the proposal',now(ctx))
      for(const proposal of s.arrangements.filter(item=>item.status==='proposed'))cancelArrangement(s,proposal,'Recompare remaining unapproved choices after the dispatcher withdrew an arrangement',now(ctx),true)
    }
  } else if (input.action === 'reopen_assessment') {
    open(ctx,args.case_id,s)
    if(typeof input.profile_id!=='number')throw new SenderError('Invalid participant ID')
    const participant=person(s,input.profile_id), note=text(input.reason,'dispatcher review note',1000)
    if(!participant.consent || participant.contact_blocked)throw new SenderError('Contact permission must be resolved separately before reassessment')
    permitted(ctx,args.case_id,s,participant.profile_id)
    if(participant.unreachable)throw new SenderError('This participant was not reached; retrying contact needs a separate decision')
    if(!requiresInformationReview(s,participant.profile_id))throw new SenderError('This participant has no information review hold to reopen')
    const attempts=[...ctx.db.attempt.iter()].filter(a=>Number(a.profile_id)===participant.profile_id)
    if(attempts.some(a=>['queued','dispatching','active','unknown'].includes(ctx.db.attemptProgress.attempt_id.find(a.id)?.transport??'unknown')))throw new SenderError('Wait until this participant’s outstanding call has finished before reassessment')
    const reached=s.findings.some(f=>f.profile_id===participant.profile_id&&(f.text.trim()||Object.keys(f.changes).length))
      || attempts.some(a=>a.support_case_id===args.case_id && a.outcome==='answered' && ctx.db.attemptProgress.attempt_id.find(a.id)?.report_processed)
    if(!reached)throw new SenderError('No reached conversation is recorded; resolve contact separately before reassessment')
    if(s.tasks.some(task=>task.profile_id===participant.profile_id&&['pending','delivered'].includes(task.status)))throw new SenderError('Review the participant’s outstanding task before authorizing reassessment')
    const priorReview=participant.review_reason
    for(const task of s.tasks.filter(task=>task.profile_id===participant.profile_id&&task.status==='blocked'&&['assess','needs','location','capability'].includes(task.kind))) {
      task.status='cancelled';task.result=(task.result?task.result+'; ':'')+'Dispatcher authorized a new reassessment: '+note
    }
    delete participant.review_reason
    const task=addTask(s,participant.profile_id,'assess',now(ctx),'Dispatcher-authorized reassessment: '+note)
    if(!task)throw new SenderError('A reassessment cannot be queued within the current task limit; the review hold remains')
    task.review_reopened=true
    task.coordinator_brief={objective:'Resolve the dispatcher’s requested clarification: '+note,reason:'Dispatcher explicitly authorized reassessment after reviewing the prior hold.',focus_fields:[],evidence_ids:s.findings.filter(f=>f.profile_id===participant.profile_id).slice(-3).map(f=>f.id),revision:1,issued_at:now(ctx)}
    const message='Dispatcher reviewed '+participant.name+' and authorized one new assessment task within existing contact limits. Follow-up calls may be placed. Note: '+note+(priorReview?' Previous review: '+priorReview:'')
    if(s.review?.startsWith(participant.name))s.review=participant.name+': reassessment authorized; previous findings remain unverified until clarified.'
    addMessage(s,message,now(ctx),'decision')
  } else if (input.action === 'pause' || input.action === 'resume') {
    s.paused=input.action==='pause'
    const policy=JSON.parse(c.policy_json) as InformationPolicy
    ctx.db.informationCase.id.update({...c,policy_json:JSON.stringify({...policy,paused:s.paused})})
    addMessage(s,s.paused?'You paused new outreach. Active calls may still report information.':'You resumed incident coordination.',now(ctx))
  } else if (input.action === 'message') {
    addMessage(s,text(input.text,'message',6000),now(ctx),'chat','lead')
  } else if (input.action === 'location_access') {
    const location=s.scenario.locations.find(l=>l.id===input.location_id)
    if(!location || !['community','specialist','unknown'].includes(String(input.access))) throw new SenderError('Invalid incident location update')
    location.access=input.access as typeof location.access
    for(const a of s.arrangements.filter(a=>!['cancelled','completed'].includes(a.status))) {
      const reasons=matchReasons(s,a.recipient_id,a.helper_id,a.id);if(reasons.length) cancelArrangement(s,a,reasons.join('; '),now(ctx))
    }
    addMessage(s,'Dispatcher changed access at '+location.label+' to '+location.access+'.',now(ctx),'decision')
  } else if(input.action==='retry_planning') { s.error='';s.planning_error=undefined;s.failure_count=0;s.retry_at=0 }
  else throw new SenderError('Unsupported coordinator action')
  touch(s);write(ctx,args.case_id,s)
  receipt(ctx,args.command_id,'assistance_operator',payload,{status:'recorded',support_case_id:Number(args.case_id),revision:s.revision})
})
export const recordAssistanceChat = spacetimedb.reducer({ case_id:t.u64(), command_id:t.string(), message:t.string() }, (ctx,args) => {
  const {state:s}=read(ctx,args.case_id)
  const id='chat-reply:'+args.command_id
  if(s.messages.some(m=>m.id===id))return
  s.messages.push({id,from:'facilitator',text:text(args.message,'reply',8000),at:now(ctx),kind:'chat'})
  write(ctx,args.case_id,s)
})
/** The coordinator owns queue authorization for these cases; old information planning stays off. */
export const synchronizeAssistance = spacetimedb.reducer({ case_id:t.u64() }, (ctx,args) => {
  const {state:s}=read(ctx,args.case_id), c=ctx.db.informationCase.id.find(args.case_id)
  if(!c)return
  let changed=false
  if(c.status!=='open'){
    if(!s.paused){s.paused=true;changed=true}
    for(const a of s.arrangements.filter(a=>!['cancelled','completed'].includes(a.status))){cancelArrangement(s,a,'Case closed by dispatcher',now(ctx));changed=true}
  }
  changed=reconcileContacts(ctx,args.case_id,s)||changed
  changed=synchronizeIncomingReports(ctx,args.case_id,s)||changed
  for(const a of ctx.db.attempt.support_case_id.filter(args.case_id)) {
    const p=ctx.db.attemptProgress.attempt_id.find(a.id), meta=ctx.db.informationAttempt.attempt_id.find(a.id)
    if(!p)continue
    const participant=person(s,Number(a.profile_id))
    const eligible=participant.consent && !participant.contact_blocked
    const invalidTask=s.tasks.find(t=>t.attempt_id===Number(a.id) && ['cancelled','blocked'].includes(t.status))
    if(p.transport==='queued' && (c.status!=='open' || !eligible || invalidTask)) {
      ctx.db.attemptProgress.attempt_id.update({...p,transport:'cancelled',dispatch_error:'Coordinator task withdrawn or contact unavailable'})
      ctx.db.attempt.id.update({...a,outcome:'cancelled'});changed=true
    } else if(p.transport==='queued' && meta) ctx.db.informationAttempt.attempt_id.update({...meta,authorized_revision:c.input_revision})
    if(p.transport==='ended') {
      const attemptId=Number(a.id)
      const finalReport=p.report_received&&p.report_processed
      const missingExpired=!p.report_received && meta?.terminal_observed_at_ms!==undefined && now(ctx)>=meta.terminal_observed_at_ms+15000
      const missingAlready=s.missing_report_attempts?.includes(attemptId)??false
      if((finalReport&&!s.processed_reports.includes(attemptId)) || (missingExpired&&!missingAlready)) {
        if(finalReport)s.processed_reports.push(attemptId)
        else s.missing_report_attempts=[...(s.missing_report_attempts??[]),attemptId]
        changed=true
        const unreachable=['not_reached','no_answer'].includes(a.outcome??'')
        const savedFindings=s.findings.some(f=>f.attempt_id===attemptId && (f.text.trim() || Object.keys(f.changes).length > 0 || f.human_review?.trim()))
        const earlierFindings=s.findings.some(f=>f.profile_id===Number(a.profile_id))
        const missingSummary=savedFindings?'Call findings are saved, but the final summary is missing. Review any unanswered questions or unconfirmed commitments.':earlierFindings?'No new findings or final summary were saved from this call. Earlier findings remain available; review unresolved questions or commitments.':'The call ended without saved findings or a final summary. Their situation remains unknown; human follow-up is needed.'
        if(finalReport)participant.unreachable=unreachable
        addMessage(s,participant.name+': '+(finalReport?(unreachable?(earlierFindings?'not reached on this call. Earlier findings remain available; their current situation needs confirmation.':'not reached. Their situation remains unknown.'):a.answer||'final report received.'):missingSummary),now(ctx),unreachable||!finalReport?'review':'update')
        if(finalReport&&missingAlready&&s.review?.startsWith(participant.name+':')&&/final summary.*missing|without saved findings or a final summary|final summary were saved/i.test(s.review))s.review=participant.name+': The final summary has now arrived. Previously unresolved questions or commitments still need review.'
        if(unreachable)s.review=participant.name+' was not reached; human follow-up is needed.'
        if(!finalReport)s.review=participant.name+': '+missingSummary+' No automatic callback is authorized.'
        for(const t of s.tasks.filter(t=>t.attempt_id===attemptId&&['pending','delivered'].includes(t.status))) {
          if(unreachable || !eligible || !finalReport || missingAlready) {
            t.status='blocked';t.result=unreachable?'Person not reached':!eligible?'Contact is unavailable':finalReport?'Final summary arrived after the review deadline; this task remains unconfirmed':savedFindings?'Findings saved; final summary missing. This task remains unconfirmed':'Final summary missing; this task remains unconfirmed'
            s.review=participant.name+': '+t.result+'. No automatic callback is authorized.'
          }
          else if(t.call_count>=2){t.status='blocked';t.result='Task callback limit reached';s.review=participant.name+' needs human follow-up.'}
          else { t.status='pending';t.attempt_id=null;t.delivered_at=null;t.due_at=now(ctx)+30000 }
        }
      }
    }
  }
  // Future milestones wake coordination without needing another phone report.
  for(const t of s.tasks.filter(t=>['pending','delivered'].includes(t.status))) {
    if(c.status!=='open') { t.status='cancelled';t.result='Case closed';s.paused=true;changed=true }
    else if(now(ctx)>t.due_at+5*60_000) { t.status='blocked';t.result='Follow-up deadline exceeded';s.review='A follow-up for '+person(s,t.profile_id).name+' is overdue.';addMessage(s,s.review,now(ctx),'review');changed=true }
  }
  if(!s.paused && c.status==='open' && c.evaluated_revision!==c.input_revision) ctx.db.informationCase.id.update({...c,evaluated_revision:c.input_revision})
  if(changed){touch(s);write(ctx,args.case_id,s)}
})
export const bindAssistanceTask = spacetimedb.reducer({ case_id:t.u64(), task_id:t.string(), attempt_id:t.u64() },(ctx,args)=>{
  const {state:s}=read(ctx,args.case_id),task=s.tasks.find(t=>t.id===args.task_id),a=ctx.db.attempt.id.find(args.attempt_id)
  if(!task || !a || a.support_case_id!==args.case_id || Number(a.profile_id)!==task.profile_id)throw new SenderError('Task binding mismatch')
  if(task.status!=='pending' || (task.attempt_id!==null && task.attempt_id!==Number(a.id)))throw new SenderError('Task is no longer pending')
  task.attempt_id=Number(a.id);write(ctx,args.case_id,s)
})
export const blockAssistanceTask = spacetimedb.reducer({case_id:t.u64(),task_id:t.string(),reason:t.string()},(ctx,args)=>{
  const {state:s}=read(ctx,args.case_id),task=s.tasks.find(t=>t.id===args.task_id)
  if(!task || !['pending','delivered'].includes(task.status))return
  task.status='blocked';task.result=args.reason.slice(0,1000);s.review=person(s,task.profile_id).name+': '+task.result
  addMessage(s,s.review,now(ctx),'review');touch(s);write(ctx,args.case_id,s)
})
