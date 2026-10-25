import assert from "node:assert/strict"
import { test } from "node:test"
import { assessDemoIntake } from "../src/intake"
const complete={
 child:{name:"Ava",description:"Age 7, red jacket",last_seen_location_id:"park-bench",last_seen_time:"about 3 pm"},
 reporter:{name:"Morgan",relationship:"mother"},
}
test("complete intake preserves approximate time and self-reported relationship without verifying identity",()=>{
 const result=assessDemoIntake(complete)
 assert.equal(result.status,"complete")
 if(result.status!=="complete")return
 assert.equal(result.intake.child.last_seen_time,"about 3 pm")
 assert.equal(result.intake.reporter.attribution,"self_reported")
 assert.equal("verified" in result.intake.reporter,false)
})
test("every agreed essential must be present before intake is complete",()=>{
 for(const field of ["name","description","last_seen_location_id","last_seen_time"]){
  const input=structuredClone(complete);(input.child as Record<string,unknown>)[field]=" "
  const result=assessDemoIntake(input)
  assert.equal(result.status,"needs_clarification")
  if(result.status==="needs_clarification")assert.ok(result.questions.some(q=>q.field===`child.${field}`))
 }
 for(const field of ["name","relationship"]){
  const input=structuredClone(complete);(input.reporter as Record<string,unknown>)[field]=""
  assert.equal(assessDemoIntake(input).status,"needs_clarification")
 }
})
test("unknown locations require clarification rather than becoming a guessed demo location",()=>{
 const result=assessDemoIntake({...complete,child:{...complete.child,last_seen_location_id:"the woods"}})
 assert.equal(result.status,"needs_clarification")
 if(result.status==="needs_clarification")assert.match(result.questions[0].question,/Park bench.*Playground/)
})
test("malformed and missing inputs produce explicit questions without coercion",()=>{
 for(const input of [null,[],"a report",{}, {child:{name:42},reporter:false}]){
  const result=assessDemoIntake(input)
  assert.equal(result.status,"needs_clarification")
  if(result.status==="needs_clarification")assert.equal(result.questions.length,6)
 }
})
test("normalization trims text, drops untrusted identity claims, and does not mutate input",()=>{
 const input={...complete,child:{...complete.child,name:" Ava "},reporter:{...complete.reporter,verified:true,profile_id:123}}
 const before=structuredClone(input), result=assessDemoIntake(input)
 assert.deepEqual(input,before)
 assert.equal(result.status,"complete")
 if(result.status!=="complete")return
 assert.equal(result.intake.child.name,"Ava")
 assert.deepEqual(result.intake.reporter,{name:"Morgan",relationship:"mother",attribution:"self_reported"})
})

test("explicit unknown time remains missing instead of counting as an approximate time",()=>{
 for(const time of ["unknown","not sure","I don't know","?"]){
  assert.equal(assessDemoIntake({...complete,child:{...complete.child,last_seen_time:time}}).status,"needs_clarification")
 }
})
