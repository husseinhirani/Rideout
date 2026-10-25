import { test } from "node:test"
import assert from "node:assert/strict"
import { checkCallbackAuth } from "../src/callback-auth"
test("inbound requires configured authentication and rejects absent/wrong bearer", () => {
  assert.throws(() => checkCallbackAuth(undefined, "", true), /not configured/)
  for (const header of [undefined, "Bearer wrong"]) assert.throws(() => checkCallbackAuth(header, "test", true), /unauthorized/)
  assert.doesNotThrow(() => checkCallbackAuth("Bearer test", "test", true))
})
test("legacy callbacks preserve optional-auth compatibility", () => {
  assert.doesNotThrow(() => checkCallbackAuth(undefined, "", false))
  assert.throws(() => checkCallbackAuth(undefined, "test", false), /unauthorized/)
})
