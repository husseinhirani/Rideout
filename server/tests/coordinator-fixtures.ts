import assert from "node:assert/strict"
import { test } from "node:test"
import { demoSnapshots } from "../mock/coordinator"
import { evaluateCase } from "../src/coordinator"

test("demo stays within two locations, placeholder destinations and each helper's call budget", () => {
  for (const { snapshot } of demoSnapshots()) {
    assert.deepEqual(snapshot.locations.map(location => location.id).sort(), ["park-bench", "playground"])
    for (const helper of snapshot.helpers) {
      assert.match(helper.phone, /^\+1555555\d{4}$/)
      assert.ok(snapshot.attempts.filter(attempt => attempt.profile_id === helper.profile_id).length <= 2)
    }
  }
})

test("possible find records the follow-up and waits for parent confirmation without a third call", async () => {
  const fixture = demoSnapshots().find(entry => entry.name.startsWith("Possible find"))!
  assert.equal(fixture.snapshot.status, "open")
  assert.equal(fixture.snapshot.attempts.filter(attempt => attempt.profile_id === 12).length, 2)
  assert.deepEqual(fixture.proposal.calls, [])
  const result = await evaluateCase(fixture.snapshot, async () => fixture.proposal)
  assert.equal(result.status, "waiting")
  assert.deepEqual(result.calls, [])
})

test("closure fixture includes the original parent's explicit identity and reunion confirmation", () => {
  const { snapshot } = demoSnapshots().at(-1)!
  assert.equal(snapshot.status, "closed")
  const confirmation = snapshot.reports.at(-1)!
  assert.equal(confirmation.source_name, snapshot.reporter.name)
  assert.match(confirmation.text, /confirm.*(?:is Ava|identity)/i)
  assert.match(confirmation.text, /back with me/i)
})

test("every scripted fixture evaluates without failed or rejected proposals", async () => {
  for (const { name, snapshot, proposal } of demoSnapshots()) {
    const result = await evaluateCase(snapshot, async () => proposal)
    assert.ok(result.status !== "failed" && result.status !== "rejected", `${name}: ${result.reason}`)
  }
})
