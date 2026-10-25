import assert from "node:assert/strict"
import { createServer } from "node:http"
import { test } from "node:test"
import { onReport } from "../src/loop"

test("coordinated report acknowledges durable receipt without waiting for interpretation; replay is idempotent", async () => {
  let received = false
  let answer = ""
  const calls: string[] = []
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = []
    for await (const chunk of req) chunks.push(Buffer.from(chunk))
    const body = Buffer.concat(chunks).toString()
    res.setHeader("content-type","application/json")
    if (req.url?.endsWith("/sql")) {
      let rows: unknown[] = []
      if (body.includes("attempt_progress")) rows = [{attempt_id:1,support_case_id:7,context:"Find Ava",transport:"active",claim_token:"token",claimed_at_ms:1000,report_received:received,report_processed:false,raw_concern:"",report_received_at_ms:received?1000:null,accepted_at_ms:null,review_consumed:false}]
      else if (body.includes("FROM attempt")) rows = [{id:1,support_case_id:7,profile_id:2,ask:"Will you check?",call_id:"live_1",outcome:null,answer,concern:"",created_at:1_000_000}]
      else if (body.includes("support_case")) rows = [{id:7,incident_id:1,victim_profile_id:1,goal:"Find Ava",brief:"",status:"open"}]
      res.end(JSON.stringify([{rows}]))
    } else if (req.url?.includes("/call/")) {
      const name = req.url.split("/call/")[1]; calls.push(name)
      if (name !== "receive_coordination_report") {res.statusCode=500;res.end(JSON.stringify({error:"Unexpected reducer"}));return}
      const args = JSON.parse(body)
      if (received && args[1] !== answer) {res.statusCode=409;res.end("A different final report already exists");return}
      received=true;answer=args[1];res.end("{}")
    } else {res.statusCode=404;res.end("{}")}
  })
  await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve))
  const address=server.address();assert.ok(address && typeof address!=="string")
  const previous=process.env.SPACETIMEDB_URL
  process.env.SPACETIMEDB_URL=`http://127.0.0.1:${address.port}`
  try {
    const input={attempt_id:1,from_phone:"",answer:"I accept.",concern:""}
    assert.deepEqual(await onReport(input),{support_case_id:7})
    assert.equal(received,true)
    assert.deepEqual(await onReport(input),{support_case_id:7})
    await assert.rejects(()=>onReport({...input,answer:"Different final report"}), (error: unknown) => (error as {status:number}).status===409)
    assert.ok(calls.length>=1)
    assert.ok(calls.every(name=>name==="receive_coordination_report"),"HTTP receipt must not run interpretation reducers")
  } finally {
    if (previous===undefined) delete process.env.SPACETIMEDB_URL;else process.env.SPACETIMEDB_URL=previous
    server.closeAllConnections()
    await new Promise<void>(resolve=>server.close(()=>resolve()))
  }
})
