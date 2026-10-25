import type { ReducerCtx } from "spacetimedb/server"
import type spacetimedb from "./models"
type Ctx = ReducerCtx<typeof spacetimedb.schemaType>
// All new and legacy creation paths allocate from the same numeric namespace.
// Reducer transactions serialize this read-and-insert with competing writers.
export function nextIncidentId(ctx: Ctx): bigint {
  let max = 0n
  for (const row of ctx.db.incident.iter()) if (row.id > max) max = row.id
  for (const row of ctx.db.informationIncident?.iter() ?? []) if (row.id > max) max = row.id
  return max + 1n
}
export function nextCaseId(ctx: Ctx): bigint {
  let max = 0n
  for (const row of ctx.db.supportCase.iter()) if (row.id > max) max = row.id
  for (const row of ctx.db.informationCase?.iter() ?? []) if (row.id > max) max = row.id
  return max + 1n
}
