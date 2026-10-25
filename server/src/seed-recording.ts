import { loadEnv } from "./env"
import { callReducer, profiles, supportCases } from "./db"
import { BLOCK } from "../shared/locations"

loadEnv()
async function seed(): Promise<void> {
  const name=process.env.SPACETIMEDB_DATABASE ?? ""
  if (!/^sealert-recording-[a-z0-9-]+$/.test(name)) throw new Error("Set SPACETIMEDB_DATABASE to a dedicated sealert-recording-<name> database")
  if ((await profiles()).length || (await supportCases()).length) throw new Error("Recording seed requires an empty database; it never deletes data")
  for (const [name,phone] of [["Blair (recording)","+15555550102"],["Casey (recording)","+15555550103"],["Ava (recording)",""],["Morgan (recording)","+15555550104"]]) {
    await callReducer("insertProfile",[name,phone,BLOCK.lat,BLOCK.lng,[]])
  }
  const rows=await profiles()
  const helperIds=rows.filter(row=>["Blair (recording)","Casey (recording)"].includes(row.name)).map(row=>row.id)
  console.log(`Seeded fictional recording profiles. COORDINATOR_HELPER_IDS=${helperIds.join(",")}`)
}
seed().catch(error=>{console.error(error instanceof Error ? error.message : "Recording seed failed");process.exitCode=1})
