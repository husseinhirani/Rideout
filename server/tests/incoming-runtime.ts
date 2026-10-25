import assert from "node:assert/strict"
import { test } from "node:test"
import { incomingConfig, scriptedIncoming } from "../src/incoming-runtime"
test("inbound requires explicit enrollment and known parent/helper IDs", () => {
  assert.equal(incomingConfig({}), null)
  assert.throws(() => incomingConfig({INBOUND_REQUESTS:"1"}), /AUTO_COORDINATE/)
  assert.throws(() => incomingConfig({INBOUND_REQUESTS:"1",AUTO_COORDINATE:"1",COORDINATOR_HELPER_IDS:"1,2",COORDINATOR_REPORTER_ID:"1"}), /distinct/)
  assert.deepEqual(incomingConfig({INBOUND_REQUESTS:"1",AUTO_COORDINATE:"1",COORDINATOR_HELPER_IDS:"1,2",COORDINATOR_REPORTER_ID:"4"}), {reporterProfileId:4,helperProfileIds:[1,2]})
})
test("scripted inbound is explicit fixture data and never invents unknown intake", async () => {
  const intake = await scriptedIncoming("My child Ava, age 7, red jacket, was last seen at the Park bench at 15:00. I am Morgan, her parent.", "intake")
  assert.equal(intake.kind,"intake")
  await assert.rejects(() => scriptedIncoming("Something unrelated", "intake"), /fixture/)
  assert.equal((await scriptedIncoming("Possible find", "update")).reunited,false)
  const confirmed = await scriptedIncoming("I confirm this is my child Ava and we are physically reunited.", "update")
  assert.equal(confirmed.childIdentityConfirmed && confirmed.reunited,true)
})
