import test from 'node:test'
import assert from 'node:assert/strict'
import { storeHarness } from './store-harness'
import { drill, T } from './district-fixtures'
import type { AssistanceState } from '../shared/assistance'
import type { CoreBrief, DistrictReport } from '../shared/trust-check'
const reducers = await import('../spacetimedb/src/index')
const r = reducers as unknown as Record<string, (...args: any[]) => any>

function store() {
  const s = storeHarness(['assistanceSession','informationCase','operatorCommand'])
  const state = drill()
  s.rows.assistanceSession.push({ case_id:7n, revision:BigInt(state.revision), state_json:JSON.stringify(state) })
  s.rows.informationCase.push({ id:7n, status:'open', policy_json:'{}' })
  s.time(T + 3000)
  return { ...s, state: () => JSON.parse(s.rows.assistanceSession[0].state_json) as AssistanceState }
}
const operator = (s: ReturnType<typeof store>, id: string, input: Record<string, unknown>) =>
  s.run(r.assistanceOperator, { case_id:7n, command_id:id, actor:'dispatcher', payload_json:JSON.stringify({ expected_revision:s.state().revision, ...input }) })

test('saved briefings carry checks recomputed by the database, not the worker', () => {
  const s = store()
  const report: DistrictReport = { district_id:'west', based_on_revision:12, summary:'Everyone in West is out.', source:'model', questions:[], escalations:[],
    claims:[{ id:'c1', text:'Grace arrived.', status:'arrived', profile_ids:[3], evidence_ids:['voice:13:1'] }],
    check:{ summary:{ ok:true, problems:[] }, claims:{ c1:{ ok:true, problems:[] } } } } // A forged "ok" from the worker.
  const brief: CoreBrief = { based_on_revision:12, created_at:0, source:'model', headline:'2 of 7 reported arrived.', district_lines:[{ district_id:'west', text:'Grace is out.', claim_ids:['c1'] }], disagreements:[], asks_for_human:[] }
  s.run(r.commitTrustBriefing, { case_id:7n, based_on_revision:12n, reports_json:JSON.stringify({ west:report }), brief_json:JSON.stringify(brief) })
  const saved = s.state()
  assert.equal(saved.revision,12, 'a briefing is not new evidence')
  assert.equal(saved.district_reports!.west.check!.claims.c1.ok,false)
  assert.equal(saved.district_reports!.west.check!.summary.ok,false)
  assert.match(saved.briefs![0].check!.lines[0].problems.join(),/failed its check/)
})

test('a briefing about an older revision is dropped', () => {
  const s = store()
  s.run(r.commitTrustBriefing, { case_id:7n, based_on_revision:11n, reports_json:'{}', brief_json:JSON.stringify({ headline:'x', district_lines:[] }) })
  assert.equal(s.state().briefs,undefined)
})

test('only an acknowledged human decision declares a district clear', () => {
  const s = store()
  assert.throws(() => operator(s,'clear-1',{ action:'declare_clear', district_id:'west' }), /Ben Lewis \(situation unknown\)/)
  assert.equal(s.state().cleared_districts,undefined)
  operator(s,'clear-2',{ action:'declare_clear', district_id:'west', acknowledged:[6] })
  const cleared = s.state().cleared_districts!
  assert.equal(cleared.length,1); assert.equal(cleared[0].actor,'dispatcher'); assert.deepEqual(cleared[0].acknowledged,[6])
  assert.equal(s.rows.operatorCommand.length,1)
  assert.throws(() => operator(s,'clear-3',{ action:'declare_clear', district_id:'east', acknowledged:[] }), /Omar Ali \(needs a ride\)/)
})
