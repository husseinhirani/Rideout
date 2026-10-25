import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { loadEnv } from "./env"
import { callReducer, profiles } from "./db"

// The twelve registered residents the frontend draws on the Rockridge block,
// placed on the same footprints. Phones use the +1555555 placeholder prefix, so
// they are dialable only with SIMULATE=1.
type Resident = { name: string; phone: string; lat: number; lng: number; contacts: string[] }

loadEnv()
async function seed(): Promise<void> {
  if ((await profiles()).length) throw new Error("Rockridge seed requires an empty database; it never deletes data")
  const residents = JSON.parse(readFileSync(resolve(import.meta.dirname, "../mock/rockridge-profiles.json"), "utf8")) as Resident[]
  for (const person of residents) {
    await callReducer("insertProfile", [person.name, person.phone, person.lat, person.lng, []])
  }
  const byName = new Map((await profiles()).map(row => [row.name, row.id]))
  for (const person of residents) {
    if (person.contacts.length === 0) continue
    await callReducer("setContacts", [byName.get(person.name), person.contacts.map(name => byName.get(name))])
  }
  // A reporter who is not a resident, so missing-child intake can bind a parent
  // separate from both helpers on this database.
  await callReducer("insertProfile", ["Morgan (reporter)", "+15555550299", 37.8466, -122.2528, []])
  const ids = await profiles()
  const id = (name: string) => ids.find(row => row.name === name)?.id
  console.log(`Seeded ${residents.length} Rockridge residents and a reporter into ${process.env.SPACETIMEDB_DATABASE ?? "sealert"}.`)
  console.log(`COORDINATOR_HELPER_IDS=${id("Daniel Ruiz")},${id("Andre Walsh")} COORDINATOR_REPORTER_ID=${id("Morgan (reporter)")}`)
}
seed().catch(error => { console.error(error instanceof Error ? error.message : "Rockridge seed failed"); process.exitCode = 1 })
