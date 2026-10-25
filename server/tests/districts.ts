import test from 'node:test'
import assert from 'node:assert/strict'
import { districtLedger, districts, UNASSIGNED } from '../shared/districts'
import { checkBrief, checkDistrictReport, ledgerBrief, ledgerReport, statedNumbers, type CoreBrief, type DistrictReport } from '../shared/trust-check'
import { drill, T } from './district-fixtures'

test('districts follow top-level scenario areas plus an unassigned bucket', () => {
  const ids = districts(drill()).map(d => d.id)
  assert.deepEqual(ids, ['west','east','ridge',UNASSIGNED])
  assert.ok(districts(drill())[0].location_ids.includes('drill-point-1'))
})

test('ledger places people by confirmed location only and never counts unknown as safe', () => {
  const l = districtLedger(drill(), T+3000)
  const by = (id: number) => l.people.find(p => p.profile_id === id)!
  assert.equal(by(1).status,'arrived'); assert.equal(by(1).tier,'two_party')
  assert.deepEqual(by(1).evidence_ids,['arrangement:7:1','voice:21:1','voice:22:1'])
  assert.equal(by(2).status,'arrived')
  assert.equal(by(3).status,'self_evacuating'); assert.equal(by(3).tier,'single_report')
  assert.equal(by(4).status,'needs_help'); assert.equal(by(4).district_id,'east')
  assert.equal(by(5).status,'unreachable'); assert.equal(by(5).district_id,UNASSIGNED)
  assert.equal(by(6).district_id,'west'); assert.equal(by(6).status,'unknown')
  assert.equal(by(7).district_id,UNASSIGNED); assert.equal(by(7).seeded_district_id,'west')
  const west = l.districts.find(d => d.district.id === 'west')!
  assert.equal(west.total,4); assert.equal(west.unaccounted,1)
  assert.deepEqual(l.totals,{people:7,arrived:2,in_progress:1,needs_help:1,unaccounted:3})
  assert.ok(!l.districts.some(d => d.district.id === 'ridge' && d.total))
})

test('a one-sided arrival is a single report, and stale silence is flagged', () => {
  const s = drill(), a = s.arrangements[0]
  a.status = 'picked_up'; a.arrival_confirmations = [2]
  const l = districtLedger(s, T + 10 * 60_000)
  assert.equal(l.people.find(p => p.profile_id === 1)!.tier,'single_report')
  assert.equal(l.people.find(p => p.profile_id === 4)!.stale,true)
  assert.equal(l.people.find(p => p.profile_id === 1)!.stale,false)
})

test('contradicting reports surface as disagreements', () => {
  const s = drill()
  s.findings.push({ id:'voice:15:1', profile_id:3, attempt_id:15, text:'Actually I need a ride', changes:{needs_transport:true}, at:T+5000 })
  const l = districtLedger(s,T+6000)
  assert.equal(l.disagreements.length,1)
  assert.deepEqual(l.disagreements[0].evidence_ids,['voice:13:1','voice:15:1'])
})

test('stated numbers ignore identifiers and read number words', () => {
  assert.deepEqual(statedNumbers('Three left from position 2; voice:11:1 confirms 4 people.'),[4,3])
  assert.deepEqual(statedNumbers('No one is missing.'),[])
})

test('the ledger-only fallback report and brief always pass their own checks', () => {
  const s = drill(), l = districtLedger(s,T+3000)
  const reports = Object.fromEntries(l.districts.map(d => { const r = ledgerReport(l,d.district.id); r.check = checkDistrictReport(s,l,r); return [d.district.id,r] }))
  for (const r of Object.values(reports)) { assert.ok(r.check!.summary.ok, r.summary); for (const c of Object.values(r.check!.claims)) assert.ok(c.ok, c.problems.join('; ')) }
  const brief = ledgerBrief(l,T), check = checkBrief(s,l,reports,brief)
  assert.ok(check.headline.ok && check.lines.every(c => c.ok))
})

test('the verifier catches inflated numbers, wrong statuses, foreign people and missing evidence', () => {
  const s = drill(), l = districtLedger(s,T+3000)
  const report: DistrictReport = { district_id:'west', based_on_revision:12, source:'model', questions:[], escalations:[],
    summary:'All 4 residents are evacuated.', claims:[
      { id:'ok', text:'2 reported arrived together.', status:'arrived', profile_ids:[1,2], evidence_ids:['arrangement:7:1'] },
      { id:'wrong-status', text:'Grace arrived.', status:'arrived', profile_ids:[3], evidence_ids:['voice:13:1'] },
      { id:'foreign', text:'Omar needs a ride.', status:'needs_help', profile_ids:[4], evidence_ids:['voice:14:1'] },
      { id:'invented', text:'Ben is leaving on his own.', status:'self_evacuating', profile_ids:[6], evidence_ids:['voice:99:1'] },
      { id:'inflated', text:'9 people are out.', status:null, profile_ids:[], evidence_ids:[] },
      { id:'uncited', text:'Grace is leaving on her own.', status:'self_evacuating', profile_ids:[3], evidence_ids:[] },
    ] }
  report.check = checkDistrictReport(s,l,report)
  const c = report.check.claims
  assert.ok(c.ok.ok, c.ok.problems.join('; '))
  assert.match(c['wrong-status'].problems.join(),/leaving on their own, not reported arrived/)
  assert.match(c.foreign.problems.join(),/not in this district/)
  assert.match(c.invented.problems.join(),/does not exist/)
  assert.match(c.inflated.problems.join(),/States 9/)
  assert.match(c.uncited.problems.join(),/No supporting report/)
  assert.match(report.check.summary.problems.join(),/accounted for, but 1 are not/)

  const brief: CoreBrief = { based_on_revision:12, created_at:T, source:'model', headline:'2 of 7 arrived; 3 unaccounted.', disagreements:[], asks_for_human:[],
    district_lines:[{ district_id:'west', text:'Two arrived by ride.', claim_ids:['ok'] }, { district_id:'west', text:'Grace is out.', claim_ids:['wrong-status'] }, { district_id:'east', text:'East has 5 people.', claim_ids:[] }] }
  const bc = checkBrief(s,l,{west:report},brief)
  assert.ok(bc.headline.ok, bc.headline.problems.join('; '))
  assert.ok(bc.lines[0].ok)
  assert.match(bc.lines[1].problems.join(),/failed its check/)
  assert.match(bc.lines[2].problems.join(),/States 5/)

  const mislabeled = checkBrief(s,l,{},{ ...brief, headline:'7 of 7 arrived.', district_lines:[{ district_id:'west', text:'4 people need a ride and 2 are unaccounted for.', claim_ids:[] }] })
  assert.match(mislabeled.headline.problems.join(),/Says 7 arrived; records show 2/)
  assert.match(mislabeled.lines[0].problems.join(),/Says 4 needing a ride/)
  assert.match(mislabeled.lines[0].problems.join(),/Says 2 unaccounted for/)
})
