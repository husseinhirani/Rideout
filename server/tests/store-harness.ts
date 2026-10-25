import { registerHooks } from "node:module"
// Only host imports are stubbed; reducer definitions and callbacks use the real SDK.
registerHooks({ resolve(specifier, context, next) {
  if (specifier.startsWith("spacetime:")) return { url: "data:text/javascript," + encodeURIComponent("export const moduleHooks = {}; export function env_get() { throw new Error(\"Host environment unavailable in reducer unit tests\") }"), shortCircuit: true }
  return next(specifier, context)
} })
import { Timestamp } from "spacetimedb"
export function storeHarness() {
  let now = 1_000
  const rows: Record<string, any[]> = Object.fromEntries(["profile", "incident", "incidentPerson", "supportCase", "attempt", "note", "caseProgress", "attemptProgress", "caseIntake", "caseInput", "incomingRequest", "dispatcherCall"].map(name => [name, []]))
  const db: any = {}
  for (const name of Object.keys(rows)) {
    const key = (name === "caseProgress" || name === "caseIntake") ? "support_case_id" : name === "attemptProgress" ? "attempt_id" : name === "caseInput" ? "event_key" : "id"
    db[name] = new Proxy({
      iter: () => rows[name].map(row => ({ ...row }))[Symbol.iterator](),
      insert: (row: any) => {
        const id = key === "id" && row.id === 0n ? rows[name].reduce((n, r) => r.id > n ? r.id : n, 0n) + 1n : row[key]
        if (rows[name].some(r => r[key] === id)) throw new Error("Duplicate primary key")
        const stored = { ...row, [key]: id }; rows[name].push(stored); return { ...stored }
      },
    }, { get(target: any, property: string) {
      if (property in target) return target[property]
      return {
        find: (value: any) => { const row = rows[name].find(r => r[property] === value); return row && { ...row } },
        filter: (value: any) => rows[name].filter(r => r[property] === value).map(r => ({ ...r })),
        update: (row: any) => { const index = rows[name].findIndex(r => r[key] === row[key]); if (index < 0) throw new Error("Missing row"); rows[name][index] = { ...row } },
      }
    } })
  }
  return { db, rows, time: (ms: number) => { now = ms },
    run: (reducer: (...args: any[]) => any, args: any) => {
      const snapshot = structuredClone(rows)
      try { reducer({ db, timestamp: new Timestamp(BigInt(now) * 1000n) }, args) }
      catch (error) { for (const name of Object.keys(rows)) rows[name] = snapshot[name]; throw error }
    },
  }
}
