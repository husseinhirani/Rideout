import assert from "node:assert/strict"
import { test } from "node:test"
import { storeHarness } from "./store-harness"
import { createCoordinatorWorker, readStableCoordinationState, type CoordinationState, type WorkerPorts } from "../src/coordinator-worker"
const reducers = await import("../spacetimedb/src/index")
const r = reducers as unknown as Record<string, (...args: any[]) => any>
const params: Record<string, string[]> = {
  tickCoordination: ["support_case_id"],
  finishCoordinationReport: ["attempt_id", "reached", "accepted", "notes_json", "concern"],
  commitCoordinationPlan: ["support_case_id", "expected_revision", "calls_json"],
  claimCoordinationAttempt: ["attempt_id", "claim_token"],
  markCoordinationEnded: ["attempt_id", "end_reason"],
  recordCoordinationFailure: ["support_case_id", "expected_revision", "message"],
}
function fixture() {
  const s = storeHarness()
  let now = 1_000
  const setTime = (ms: number) => { now = ms; s.time(ms) }
  for (const [id, name, phone] of [[1n, "Ava", ""], [2n, "Alex", "+15555550102"], [3n, "Sam", "+15555550103"]] as const) {
    s.db.profile.insert({ id, name, phone, lat: 0, lng: 0, contact_profile_ids: [] })
  }
  s.db.incident.insert({ id: 1n, type: "missing child", description: "Ava in a red coat last seen near park bench", area: {lat: 0,lng: 0,radius_m: 0}, brief: "", status: "active", created_at: "2026-10-25T15:00:00Z", ended_at: null })
  s.db.supportCase.insert({ id: 1n, incident_id: 1n, victim_profile_id: 1n, goal: "Find Ava", brief: "", status: "open" })
  s.run(r.enableCoordination, {support_case_id: 1n, helper_profile_ids: [2n, 3n]})
  function read(): CoordinationState {
    const normalized = JSON.parse(JSON.stringify(s.rows, (_key, value) => {
      if (typeof value === "bigint") return Number(value)
      if (value === undefined) return null
      if (value && typeof value === "object" && "__timestamp_micros_since_unix_epoch__" in value) return new Date(Number(value.__timestamp_micros_since_unix_epoch__) / 1000).toISOString()
      return value
    }))
    return { cases: normalized.supportCase, incidents: normalized.incident, profiles: normalized.profile, attempts: normalized.attempt, notes: normalized.note, coordination: normalized.caseProgress, attempt_progress: normalized.attemptProgress }
  }
  let planCount = 0
  const dialed: number[] = []
  const ports: WorkerPorts = {
    read: async () => read(), now: () => now,
    reduce: async (name, args) => {
      const fields = params[name]; assert.ok(fields, name)
      s.run(r[name], Object.fromEntries(fields.map((field, i) => [field, field.endsWith("_id") || field === "expected_revision" ? BigInt(args[i] as number) : args[i]])))
    },
    plan: async context => {
      planCount++
      return {reason: "Use the current evidence", calls: (context.candidates as {profile_id:number}[]).map(({profile_id}) => ({profile_id, ask: JSON.stringify(context.reports).includes("playground") ? "Check the playground sighting?" : "Can you check your location?", context: "Ava was reported missing."}))}
    },
    interpret: async () => ({reached: true, accepted: true, concern: "", notes: [{text: "Accepted the assignment",has_place:false,lat:0,lng:0,radius_m:0}]}),
    dial: async (attempt, _profile, _context, token) => {
      dialed.push(attempt.id)
      s.run(r.recordCoordinationDispatch, {attempt_id: BigInt(attempt.id),claim_token: token,call_id: "sim_"+attempt.id,error:""})
    },
    inspect: async () => ({status:"started",endReason:null}),
  }
  return {s,ports,setTime,dialed,read,planCount:()=>planCount, report:(id:number) => s.run(r.receiveCoordinationReport,{attempt_id:BigInt(id),answer:"I accept and will check.",concern:""})}
}

test("worker resumes reports, follows up once at ten seconds using new evidence, and survives restart", async () => {
  const f = fixture()
  await createCoordinatorWorker(f.ports).tick()
  assert.equal(f.dialed.length, 2)
  f.report(1); f.report(2)
  await createCoordinatorWorker(f.ports).tick() // fresh worker must recover durable reports
  assert.ok(f.read().attempt_progress.every(p => p.report_processed))
  f.s.run(r.addNote,{support_case_id:1n,attempt_id:0n,source:"dispatcher",text:"Caller reports a sighting near the playground.",has_place:false,lat:0,lng:0,radius_m:0})
  f.setTime(10_999)
  await createCoordinatorWorker(f.ports).tick()
  assert.equal(f.dialed.length, 2)
  f.setTime(11_000)
  await createCoordinatorWorker(f.ports).tick()
  assert.equal(f.dialed.length, 4)
  assert.match(f.read().attempts[2].ask, /playground/)
  f.report(3); f.report(4)
  f.setTime(50_000)
  await createCoordinatorWorker(f.ports).tick()
  await createCoordinatorWorker(f.ports).tick()
  assert.equal(f.dialed.length, 4)
})

test("report replay after processing creates neither extra notes nor additional outreach", async () => {
  const f = fixture(); const worker = createCoordinatorWorker(f.ports)
  await worker.tick(); f.report(1); await worker.tick()
  const notes = f.read().notes.length; const revision = f.read().coordination[0].input_revision
  f.report(1); await worker.tick()
  assert.equal(f.read().notes.length, notes)
  assert.equal(f.read().coordination[0].input_revision, revision)
  assert.equal(f.dialed.length, 2)
})

test("case changes during planning reject the stale proposal", async () => {
  const f = fixture()
  f.ports.plan = async () => {
    f.s.run(r.setCaseStatus,{support_case_id:1n,status:"closed"})
    return {reason:"obsolete",calls:[{profile_id:2,ask:"Check?",context:"Missing child"}]}
  }
  await createCoordinatorWorker(f.ports).tick()
  assert.equal(f.dialed.length, 0)
  assert.equal(f.read().cases[0].status, "closed")
})

test("model failures back off and stop after three attempts, including across restart", async () => {
  const f = fixture(); let calls = 0
  f.ports.plan = async () => { calls++; throw new Error("unavailable") }
  await createCoordinatorWorker(f.ports).tick()
  await createCoordinatorWorker(f.ports).tick(); assert.equal(calls, 1)
  f.setTime(3_000); await createCoordinatorWorker(f.ports).tick()
  f.setTime(7_000); await createCoordinatorWorker(f.ports).tick()
  f.setTime(80_000); await createCoordinatorWorker(f.ports).tick()
  assert.equal(calls, 3); assert.ok(f.read().coordination[0].blocked_reason)
  assert.equal(f.dialed.length, 0)
})

test("a live report is not an end signal; only completed provider evidence releases follow-up", async () => {
  const f = fixture()
  f.ports.dial = async (attempt, _profile, _context, token) => {
    f.dialed.push(attempt.id)
    f.s.run(r.recordCoordinationDispatch,{attempt_id:BigInt(attempt.id),claim_token:token,call_id:"live_"+attempt.id,error:""})
  }
  await createCoordinatorWorker(f.ports).tick(); f.report(1); f.report(2)
  f.setTime(130_000); await createCoordinatorWorker(f.ports).tick()
  assert.equal(f.dialed.length,2)
  assert.ok(f.read().attempt_progress.every(p => p.transport === "active"))
  f.ports.inspect = async () => ({status:"completed",endReason:"client_hangup"})
  await createCoordinatorWorker(f.ports).tick()
  assert.equal(f.dialed.length,4)
})

test("two worker instances racing the same revision dispatch each initial attempt only once", async () => {
  const f=fixture()
  await Promise.all([createCoordinatorWorker(f.ports).tick(),createCoordinatorWorker(f.ports).tick()])
  assert.equal(f.dialed.length,2)
  assert.equal(new Set(f.dialed).size,2)
})

test("closure after claim but before provider dispatch prevents the outbound call", async () => {
  const f=fixture()
  const reduce=f.ports.reduce
  f.ports.reduce=async(name,args)=>{
    await reduce(name,args)
    if(name==="claimCoordinationAttempt") f.s.run(r.setCaseStatus,{support_case_id:1n,status:"closed"})
  }
  await createCoordinatorWorker(f.ports).tick()
  assert.equal(f.dialed.length,0)
})

test("an old worker's read cannot manufacture a last-seen time from incident creation", async () => {
  const f=fixture()
  f.ports.plan=async context=>{
    assert.notEqual((context.child as {last_seen_at:string}).last_seen_at,"2026-10-25T15:00:00Z")
    return {calls:[],reason:"Wait for details"}
  }
  await createCoordinatorWorker(f.ports).tick()
  assert.equal(f.read().coordination[0].failure_count,0)
})

test("snapshot reads retry if input changes between reading progress and notes", async () => {
  const f=fixture();let reads=0
  const state=await readStableCoordinationState(async()=>f.read().coordination,async()=>{
    reads++
    const old=f.read()
    if(reads===1) f.s.run(r.addNote,{support_case_id:1n,attempt_id:0n,source:"dispatcher",text:"New sighting",has_place:false,lat:0,lng:0,radius_m:0})
    return old
  })
  assert.equal(state.notes[0]?.text,"New sighting")
  assert.equal(reads,2)
})

test("planner uses persisted intake and attributed original reporter instead of placeholder identity", async () => {
  const f=fixture()
  const read=f.ports.read
  f.ports.read=async()=>({...await read(),case_intakes:[{
    support_case_id:1,reporter_profile_id:4,child_description:"Age 7, red jacket",
    last_seen_location_id:"park-bench",last_seen_time:"about 3 pm",
    reporter_name:"Morgan",reporter_relationship:"mother",reunion_confirmed:false,confirmed_at:null,
  }]})
  f.ports.plan=async context=>{
    assert.deepEqual(context.child,{name:"Ava",description:"Age 7, red jacket",last_seen_location_id:"park-bench",last_seen_at:"about 3 pm"})
    assert.deepEqual(context.reporter,{name:"Morgan",relationship:"mother",attribution:"self_reported"})
    return {calls:[],reason:"Wait"}
  }
  await createCoordinatorWorker(f.ports).tick()
  assert.equal(f.read().coordination[0].failure_count,0)
})
