import assert from "node:assert/strict"
import { test } from "node:test"
import { recordingMode, scriptedPlan, scriptedInterpret } from "../src/recording-model"

test("scripted backend refuses to run against real phones or without automatic coordination", () => {
  assert.throws(()=>recordingMode({COORDINATOR_SCRIPTED:"1",AUTO_COORDINATE:"1"}),/SIMULATE/)
  assert.throws(()=>recordingMode({COORDINATOR_SCRIPTED:"1",SIMULATE:"1"}),/AUTO_COORDINATE/)
  assert.equal(recordingMode({COORDINATOR_SCRIPTED:"1",SIMULATE:"1",AUTO_COORDINATE:"1"}),true)
  assert.equal(recordingMode({}),false)
})
test("scripted proposals reflect latest demo report and preserve possible-find uncertainty", async () => {
  const context={candidates:[{profile_id:2,name:"Blair",location_id:"park-bench"}],attempts:[],reports:[]}
  const initial=await scriptedPlan(context)
  assert.match(initial.calls[0].ask,/Park bench/)
  const updated={...context,attempts:[{profile_id:2}],reports:[{text:"A witness reports a red backpack near the playground."}]}
  assert.match((await scriptedPlan(updated)).calls[0].ask,/red backpack/)
  assert.deepEqual((await scriptedPlan({...updated,reports:[{text:"I see a possible match."}]})).calls,[])
})
test("scripted interpretation accepts only explicit fixture agreements and retains other evidence", async () => {
  assert.equal((await scriptedInterpret({answer:"Yes, I can check the park bench."})).accepted,true)
  const other=await scriptedInterpret({answer:"Someone says yes; I did not agree.",flagged_by_the_in_call_agent:""})
  assert.equal(other.accepted,false)
  assert.equal(other.notes[0].text,"Someone says yes; I did not agree.")
})
test("scripted ride plan asks the first ordered candidate and nobody else", async () => {
  const { scriptedRidePlan } = await import("../src/recording-model")
  const result = await scriptedRidePlan({ victim: { name: "Helen Cho" }, candidates: [{ profile_id: 2, name: "Daniel Ruiz" }, { profile_id: 6, name: "Andre Walsh" }] })
  assert.deepEqual(result.calls.map(call => call.profile_id), [2])
  assert.match(result.calls[0].ask, /Helen Cho/)
  assert.deepEqual((await scriptedRidePlan({ victim: {}, candidates: [] })).calls, [])
})
