// Headless run of the demo scenario: `npx tsx scripts/simulate.ts [--live]`
import { clock } from '../src/lib/format'
import { initialState, reducers } from '../src/store/sim'

const s = initialState()
s.autopilot = !process.argv.includes('--live')
reducers.start(s)
for (let i = 0; i < 2400; i++) reducers.tick(s, 1)
for (const e of s.log) console.log(clock(e.at).padStart(8), e.kind.padEnd(8), e.text)
console.log('\nFinal:', Object.values(s.residents).map((r) => `${r.id}=${r.status}`).join(' '))
