import assert from "node:assert/strict"
import { test } from "node:test"
import { createIncomingRequestService, type IncomingInterpretation } from "../src/incoming-requests"
const intake = {child:{name:"Ava",description:"Red jacket",last_seen_location_id:"park-bench",last_seen_time:"four"},reporter:{name:"Morgan",relationship:"parent"}}
const body={provider_call_id:"call-1",from_phone:"+15555550104",direction:"inbound",text:"My child Ava is missing"}
function harness() {
 const rows:any[]=[], actions:any[]=[], cases:any[]=[], intakes:any[]=[], coordination:any[]=[]
 let calls=0, now=1000, failFinish=false
 let interpretation:IncomingInterpretation={kind:"intake",intake,childIdentityConfirmed:false,reunited:false}
 const ports={incomingRequests:async()=>structuredClone(rows), profiles:async()=>[{id:4,phone:body.from_phone},{id:1,phone:"+15555550102"},{id:2,phone:"+15555550103"}] as any,
 supportCases:async()=>cases, caseIntakes:async()=>intakes, caseProgress:async()=>coordination,now:()=>now,
 interpret:async()=>{calls++;return interpretation},
 callReducer:async(name:string,args:unknown[])=>{
  if(name==="receiveIncomingRequest") {
   const [provider_call_id,from_phone,direction,text]=args, row=rows.find(r=>r.provider_call_id===provider_call_id)
   if(row){if(row.text===text&&row.from_phone===from_phone)return;if(row.status!=="needs_clarification")throw Error("Incoming request content conflict");Object.assign(row,{text,revision:row.revision+1,status:"pending",decision_json:"",reply:"",retry_at_ms:0});return}
   rows.push({id:rows.length+1,provider_call_id,from_phone,direction,text,revision:1,status:"pending",decision_json:"",reply:"",support_case_id:null,failure_count:0,retry_at_ms:0});return
  }
  const row=rows.find(r=>r.id===args[0]);if(row.revision!==args[1])throw Error("stale")
  if(name==="prepareIncomingRequest"){if(row.status!=="pending")throw Error("stale");Object.assign(row,{decision_json:args[2],status:args[3],reply:args[4]})}
  if(name==="finishIncomingRequest"){if(failFinish){failFinish=false;throw Error("crash")};Object.assign(row,{status:"recorded",support_case_id:args[2],reply:args[3]})}
  if(name==="failIncomingRequest"){row.failure_count++;row.retry_at_ms=now+2000;if(row.failure_count>=3)row.status="needs_review"}
 },caseInputs:{
 createCaseFromIntake:async(draft:unknown,meta:unknown)=>{actions.push({kind:"intake",draft,meta});return{status:"recorded" as const,support_case_id:10}},
 addCaseUpdate:async(meta:unknown,text:string)=>{actions.push({kind:"update",meta,text});return{status:"recorded" as const,support_case_id:10}},
 confirmCaseReunion:async(meta:unknown,confirmation:unknown)=>{actions.push({kind:"confirmation",meta,confirmation});return{status:"recorded" as const,support_case_id:10}}}}
 const service=createIncomingRequestService(ports,{reporterProfileId:4,helperProfileIds:[1,2]})
 return{service,ports,rows,actions,cases,intakes,coordination,calls:()=>calls,set:(v:IncomingInterpretation)=>{interpretation=v},fail:()=>{failFinish=true},advance:()=>{now+=3000},open:()=>{cases.push({id:10,status:"open"});intakes.push({support_case_id:10,reporter_profile_id:4});coordination.push({support_case_id:10,helper_profile_ids:[1,2]})}}
}
test("rejects invalid bound metadata before persistence",async()=>{const h=harness();await assert.rejects(h.service.receive({...body,from_phone:"{{system__caller_id}}"}),/from_phone/);await assert.rejects(h.service.receive({...body,direction:"outbound"}),/inbound/);assert.equal(h.rows.length,0)})
test("intake uses server IDs and exact replay is inert",async()=>{const h=harness();await h.service.receive(body);await h.service.process(1);assert.equal(h.rows[0].status,"recorded");assert.deepEqual(h.actions[0].meta,{eventKey:"inbound:1:1",reporterProfileId:4,helperProfileIds:[1,2]});await h.service.receive(body);await h.service.process(1);assert.equal(h.actions.length,1)})
test("missing essentials asks clarification without outreach",async()=>{const h=harness();h.set({kind:"intake",intake:{},childIdentityConfirmed:false,reunited:false});await h.service.receive(body);await h.service.process(1);assert.equal(h.rows[0].status,"needs_clarification");assert.match(h.rows[0].reply,/child's name/);assert.equal(h.actions.length,0);h.set({kind:"intake",intake,childIdentityConfirmed:false,reunited:false});await h.service.receive({...body,text:"complete cumulative report"});await h.service.process(1);assert.equal(h.actions[0].meta.eventKey,"inbound:1:2")})
test("unknown caller is review only without disclosure",async()=>{const h=harness();h.open();const r=await h.service.receive({...body,from_phone:"+15555550199"});await h.service.process(1);assert.equal(h.rows[0].status,"needs_review");assert.equal(h.calls(),0);assert.equal(h.actions.length,0);assert.equal("support_case_id" in r,false)})
test("helper confirmation stays an update",async()=>{const h=harness();h.open();h.set({kind:"confirmation",intake:null,childIdentityConfirmed:true,reunited:true});await h.service.receive({...body,from_phone:"+15555550102"});await h.service.process(1);assert.equal(h.actions[0].kind,"update")})
test("original reporter confirmation reaches explicit reunion operation",async()=>{const h=harness();h.open();h.set({kind:"confirmation",intake:null,childIdentityConfirmed:true,reunited:true});await h.service.receive(body);await h.service.process(1);assert.equal(h.actions[0].kind,"confirmation")})
test("ambiguous cases are review only",async()=>{const h=harness();h.open();h.cases.push({id:11,status:"open"});h.intakes.push({support_case_id:11,reporter_profile_id:4});await h.service.receive(body);await h.service.process(1);assert.equal(h.rows[0].status,"needs_review");assert.equal(h.actions.length,0)})
test("recovery reuses saved action after mutation before finish",async()=>{const h=harness();h.fail();await h.service.receive(body);await h.service.process(1);assert.equal(h.rows[0].status,"prepared");h.advance();await h.service.sweep();assert.equal(h.rows[0].status,"recorded");assert.equal(h.calls(),1);assert.deepEqual(h.actions[0],h.actions[1])})

test("interpreter failures retry within bounds without mutating a case", async () => {
  const h = harness()
  h.ports.interpret = async () => { throw new Error("provider unavailable") }
  await h.service.receive(body)
  await h.service.process(1)
  assert.equal(h.rows[0].failure_count, 1)
  await h.service.sweep()
  assert.equal(h.rows[0].failure_count, 1)
  h.advance()
  await h.service.sweep()
  h.advance()
  await h.service.sweep()
  assert.equal(h.rows[0].status, "needs_review")
  assert.equal(h.actions.length, 0)
})

test("concurrent processing of one request does not repeat interpretation", async () => {
  const h = harness()
  await h.service.receive(body)
  await Promise.all([h.service.process(1), h.service.process(1), h.service.sweep()])
  assert.equal(h.calls(), 1)
  assert.equal(h.actions.length, 1)
})

test("a different report on a finalized provider call cannot mutate the case", async () => {
  const h = harness()
  await h.service.receive(body)
  await h.service.process(1)
  await assert.rejects(h.service.receive({ ...body, text: "Changed final report" }), /different report/)
  assert.equal(h.actions.length, 1)
})


test("known content conflicts become HTTP 409 without hiding database failures", async () => {
  const h = harness()
  await h.service.receive(body)
  await h.service.process(1)
  await assert.rejects(h.service.receive({ ...body, text: "Changed final report" }), (error: any) => error.status === 409)
  h.ports.callReducer = async () => { throw new Error("database offline") }
  await assert.rejects(h.service.receive(body), (error: any) => error.status === undefined && error.message === "database offline")
})

test("review decisions use an object accepted by the durable reducer", async () => {
  const h = harness()
  await h.service.receive({ ...body, from_phone: "+15555550199" })
  await h.service.process(1)
  assert.deepEqual(JSON.parse(h.rows[0].decision_json), {})
})

test("a stale processor never executes its alternate interpretation", async () => {
  const h = harness()
  let release!: () => void
  const firstBlocked = new Promise<void>(resolve => { release = resolve })
  let count = 0
  h.ports.interpret = async () => {
    const first = ++count === 1
    if (first) await firstBlocked
    return { kind: "intake", intake: { ...intake, child: { ...intake.child, name: first ? "Stale" : "Saved" } }, childIdentityConfirmed: false, reunited: false }
  }
  await h.service.receive(body)
  // Give the first processor time to reach its blocked model call.
  while (count === 0) await new Promise(resolve => setImmediate(resolve))
  const second = createIncomingRequestService(h.ports, { reporterProfileId: 4, helperProfileIds: [1, 2] })
  await second.process(1)
  release()
  await h.service.process(1)
  assert.equal(h.actions.length, 1)
  assert.equal(h.actions[0].draft.child.name, "Saved")
  assert.equal(h.rows[0].status, "recorded")
})
