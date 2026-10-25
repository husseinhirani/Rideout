import assert from "node:assert/strict"
import { createServer } from "node:http"
import { test } from "node:test"

test("real planner parses valid output and rejects refusal, truncation and API failures without fallback", async () => {
  const expected = { calls: [{profile_id: 2, ask: "Can you check the playground?", context: "Ava was reported missing."}], reason: "Follow the reported sighting." }
  let status = 200
  let stopReason = "end_turn"
  let output = JSON.stringify(expected)
  let received: Record<string, unknown> = {}
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = []
    for await (const chunk of req) chunks.push(Buffer.from(chunk))
    received = JSON.parse(Buffer.concat(chunks).toString())
    res.writeHead(status, { "content-type": "application/json" })
    res.end(JSON.stringify(status === 200 ? {
      id: "msg_test", type: "message", role: "assistant", model: "test-model",
      content: [{type: "text", text: output}], stop_reason: stopReason, stop_sequence: null,
      usage: {input_tokens: 1, output_tokens: 1},
    } : {type: "error", error: {type: "authentication_error", message: "test rejection"}}))
  })
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve))
  const address = server.address()
  assert.ok(address && typeof address !== "string")
  const previousKey = process.env.ANTHROPIC_API_KEY
  const previousUrl = process.env.ANTHROPIC_BASE_URL
  process.env.ANTHROPIC_API_KEY = "test-only-not-a-real-key"
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${address.port}`
  try {
    const { planStrict, interpretCoordinationAnswer } = await import("../src/agent")
    assert.deepEqual(await planStrict({reports: ["New sighting"]}), expected)
    assert.match(JSON.stringify(received.messages), /New sighting/)
    const report = { reached: true, accepted: true, notes: [], concern: "" }
    output = JSON.stringify(report)
    assert.deepEqual(await interpretCoordinationAnswer({answer: "I will check the playground."}), report)
    assert.match(JSON.stringify(received.output_config), /accepted/)
    output = JSON.stringify({ reached: true, notes: [], concern: "" })
    await assert.rejects(() => interpretCoordinationAnswer({}))
    output = JSON.stringify(expected)
    stopReason = "max_tokens"
    await assert.rejects(() => planStrict({}))
    stopReason = "refusal"
    await assert.rejects(() => planStrict({}))
    stopReason = "end_turn"
    output = "I cannot provide a structured result."
    await assert.rejects(() => planStrict({}))
    status = 401
    await assert.rejects(() => planStrict({}))
  } finally {
    if (previousKey === undefined) delete process.env.ANTHROPIC_API_KEY
    else process.env.ANTHROPIC_API_KEY = previousKey
    if (previousUrl === undefined) delete process.env.ANTHROPIC_BASE_URL
    else process.env.ANTHROPIC_BASE_URL = previousUrl
    server.closeAllConnections()
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  }
})
