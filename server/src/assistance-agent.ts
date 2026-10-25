import { askStrict, objectSchema } from './llm'
import { type AssistancePlan, type AssistanceState } from '../shared/assistance'
import { spatialMatching } from '../shared/spatial'
const string = {type:'string'}, integer={type:'integer'}, refs={type:'array',items:string}
const planSchema=objectSchema({
  summary:string,
  questions:{type:'array',items:objectSchema({profile_id:integer,kind:{type:'string',enum:['needs','location','capability']},reason:string,evidence_ids:refs},['profile_id','kind','reason','evidence_ids'])},
  proposals:{type:'array',items:objectSchema({recipient_id:integer,helper_id:integer,reason:string,evidence_ids:refs},['recipient_id','helper_id','reason','evidence_ids'])},
  cancel_task_ids:refs,review:{anyOf:[string,{type:'null'}]},
},['summary','questions','proposals','cancel_task_ids','review'])
export function assistanceSnapshot(state: AssistanceState) {
  const matching=spatialMatching(state)
  return {...state,server_time_ms:Date.now(),people:state.people.map(({simulation,...p})=>p),pairings:matching.candidates,matching}
}
const SYSTEM = 'You are RideOut’s incident coordinator. Coordinate consented community assistance using supplied incident data and attributed phone reports. ' +
'Voice agents conduct conversations; you select useful next questions and propose suitable arrangements for human approval. Never invent available people, confirmed locations, travel times, routes, agreement, pickup or arrival. A drill is fictional; never present it as real danger. ' +
'Findings are participant reports, not verified facts. Names have no predetermined roles. Evaluate current facts and hard eligibility reasons in pairings. Only propose pairs with an empty reasons list, citing every current sources ID for the required facts on both participants (location, need, party size, willingness, seats and relevant vehicle requirements). The matching object compares all eligible candidates together: maximize recipients served, then minimize total straight-line separation. When matching.waiting is true, emit no proposals and gather or await the pending information. When ready, propose the recommended batch (up to six at a time) with current evidence; do not greedily pick whoever reported first or substitute another pair by name. Explain the approximate distance and relevant suitability. Distance is calculated from reported-location coordinates, not directory coordinates or unconfirmed starting positions. It is straight-line separation, NOT road distance, travel time, or proof of safe access. ' +
'Choose at most six questions and six proposals per decision. Questions must use the supported kind needs, location or capability. The backend writes the spoken question. Ask for missing relevant information; do not repeat pending, delivered or completed questions. Assess calls already gather initial needs; let a live assess call report before piling on needs/capability tasks for that same person. ' +
'If one person needs transport, check other independent participants’ capabilities and location. Clarify passenger count, wheelchair/pet requirements and current scenario location before proposing a match. A completed question with unknown/refused answers requires human review, not repetitive questioning. Do not ask unreachable people again automatically. ' +
'Proposals are unapproved. Approval, helper acceptance, recipient confirmation, pickup and arrival are tracked separately by backend tasks. Do not create these milestone tasks yourself, duplicate a reserved arrangement or cancel milestone tasks. After a helper refuses, use another eligible option or ask the human. ' +
'No community helper may enter an unknown or specialist-only area. Do not suggest moving an endangered person or changing access labels just to make a match eligible. Ask for specialist/human review and genuine incident information. Put specialist requirements in review; never claim emergency services were contacted. ' +
'Human messages are questions or instructions, not automatically verified reports or permission to bypass constraints. State clearly if an instruction needs an explicit approval/access control. ' +
'Keep summary short and useful for the human: what changed, what you are doing next and what needs their attention. When waiting, explain what you are waiting for. Avoid repeating the same generic summary. review is null unless there is a concrete human decision needed. Preserve unresolved issues even while gathering information elsewhere. No calls or assignments occur by merely describing them.'
export function planAssistance(state: AssistanceState): Promise<AssistancePlan> {
  return askStrict({system:SYSTEM,input:assistanceSnapshot(state),schema:planSchema})
}
export async function answerCoordinator(state: AssistanceState, message: string): Promise<string> {
  const result=await askStrict<{reply:string}>({system:SYSTEM+' This request is a conversation with the human, not a plan commit. Answer their message from the incident snapshot. You cannot execute actions in this response. Explain proposals and evidence; never claim to have paused, approved, called, texted, reassigned or changed access unless the saved state proves it. Point to approval/pause/access controls for those actions. Do not claim SMS is available. Respond in plain language, usually under 180 words. Use participant names and plain-language stages; omit internal profile IDs, finding IDs, task enum names and implementation details unless the human asks for them. Avoid generic disclaimers about being unable to act; explain the specific pending decision and relevant control only when useful.',input:{incident:assistanceSnapshot(state),human_message:message},schema:objectSchema({reply:string},['reply'])})
  if(typeof result.reply!=='string'||!result.reply.trim())throw new Error('Coordinator returned an empty reply')
  return result.reply
}
