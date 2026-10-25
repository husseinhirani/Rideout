import assert from "node:assert/strict"
import { readdirSync, readFileSync } from "node:fs"
import { resolve } from "node:path"
import {
  chooseTool,
  mergeToolIds,
  parseToolFile,
  sameIds,
  toolAuth,
  toolRequest,
  webhookBase,
  type ListedTool,
} from "../src/setup-tools"

assert.equal(webhookBase("https://rideout.ngrok.app/"), "https://rideout.ngrok.app")
assert.throws(() => webhookBase(""), /NGROK_URL is not set/)
assert.throws(() => webhookBase("http://rideout.ngrok.app"), /https/)
assert.throws(() => webhookBase("https://rideout.ngrok.app/check-ins"), /path/)

const older: ListedTool = { id: "old", name: "record_check_in", updatedAt: "2026-01-01T00:00:00Z" }
const newer: ListedTool = { id: "new", name: "record_check_in", updatedAt: "2026-02-01T00:00:00Z" }
const other: ListedTool = { id: "keep", name: "lookup_order", updatedAt: "2026-01-01T00:00:00Z" }

assert.equal(chooseTool("record_check_in", [older, newer], new Set())?.id, "new")
assert.equal(chooseTool("record_check_in", [older, newer], new Set(["old"]))?.id, "old")
assert.equal(chooseTool("missing", [newer], new Set()), null)

assert.deepEqual(
  mergeToolIds([other, older, newer], ["record_check_in"], new Map([["record_check_in", "old"]])),
  ["keep", "old"],
)
assert.deepEqual(
  mergeToolIds([other], ["record_check_in"], new Map([["record_check_in", "created"]])),
  ["keep", "created"],
)
assert.equal(sameIds(["keep", "old"], ["keep", "old"]), true)
assert.equal(sameIds(["old"], ["keep", "old"]), false)

const dir = resolve(import.meta.dirname, "../tools")
const files = readdirSync(dir).filter((name) => name.endsWith(".json")).sort()
assert.deepEqual(files, ["record_check_in.json", "report_call.json", "report_request.json"])
const definitions = files.map((file) => parseToolFile(JSON.parse(readFileSync(resolve(dir, file), "utf8")) as unknown, file))
assert.deepEqual(definitions.map((definition) => definition.api_schema.url), ["/check-ins", "/calls/report", "/requests"])
for (const definition of definitions) {
  const required = new Set(definition.api_schema.request_body_schema.required)
  for (const [name, schema] of Object.entries(definition.api_schema.request_body_schema.properties)) {
    const field = schema as { dynamic_variable?: unknown }
    if (typeof field.dynamic_variable === "string") assert.equal(required.has(name), false)
  }
}
const inbound = definitions.find(definition => definition.name === "report_request")!
assert.deepEqual(inbound.api_schema.request_body_schema.required, ["text"])
const inboundFields = inbound.api_schema.request_body_schema.properties as Record<string, {dynamic_variable?: string}>
assert.equal(inboundFields.from_phone.dynamic_variable, "system__caller_id")
assert.equal(inboundFields.provider_call_id.dynamic_variable, "system__conversation_id")
assert.equal(inboundFields.direction.dynamic_variable, "system__call_direction")
assert.equal(inboundFields.text.dynamic_variable, undefined)
const created = toolRequest(definitions[0], "https://rideout.ngrok.app", true, "s3cret")
const updated = toolRequest(definitions[0], "https://rideout.ngrok.app", false, "")
assert.equal(created.type, "webhook")
assert.equal("type" in updated, false)
assert.equal((created.api_schema as { url: string }).url, "https://rideout.ngrok.app/check-ins")

// A set secret becomes a bearer Cartesia sends on every call. An unset one
// sends null, which clears auth left behind by an earlier run.
assert.deepEqual(toolAuth("s3cret"), { mode: "bearer", token: { type: "secret", secret_value: "s3cret" } })
assert.equal(toolAuth(""), null)
assert.deepEqual((created.api_schema as { authentication: unknown }).authentication, toolAuth("s3cret"))
assert.equal((updated.api_schema as { authentication: unknown }).authentication, null)

console.log("ok")
