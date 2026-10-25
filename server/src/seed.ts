import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { callReducer, profiles } from "./db"
import { loadEnv } from "./env"

const E164 = /^\+[1-9]\d{1,14}$/
const PLACEHOLDER_PHONE_PREFIX = "+1555555"

type Fixture = {
  profiles: {
    name: string
    phone: string
    lat: number
    lng: number
    contacts: string[]
  }[]
}

loadEnv()

seed().then(
  () => undefined,
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : "Seed failed")
    process.exit(1)
  },
)

async function seed(): Promise<void> {
  const fixture = readFixture()
  const liveName = process.env.SEED_PROFILE ?? fixture.profiles[0]?.name ?? ""
  const livePhone = process.env.SEED_PHONE?.trim() ?? ""
  if (livePhone.length > 0 && E164.test(livePhone) === false) {
    throw new Error("SEED_PHONE must be E.164, for example +14155550123")
  }
  const rows = fixture.profiles.map((profile) => ({
    ...profile,
    phone: profile.name === liveName && livePhone.length > 0 ? livePhone : profile.phone,
  }))
  const names = new Set<string>()
  for (const profile of rows) {
    if (names.has(profile.name)) throw new Error("Duplicate profile name " + profile.name)
    names.add(profile.name)
    if (E164.test(profile.phone) === false) {
      throw new Error(profile.name + " phone must be E.164")
    }
    for (const contact of profile.contacts) {
      if (!fixture.profiles.some((row) => row.name === contact)) {
        throw new Error(profile.name + " contact " + contact + " is not in the fixture")
      }
    }
  }
  if (process.env.SEED_PROFILE !== undefined && !names.has(process.env.SEED_PROFILE)) {
    throw new Error("SEED_PROFILE " + process.env.SEED_PROFILE + " is not in the fixture")
  }
  const existing = await profiles()
  if (existing.length > 0) {
    throw new Error(
      "Profiles already exist; nothing was changed. Select an empty test database with SPACETIMEDB_DATABASE instead of wiping existing records.",
    )
  }
  for (const profile of rows) {
    await callReducer("insertProfile", [profile.name, profile.phone, profile.lat, profile.lng, []])
  }
  const inserted = await profiles()
  const idByName = new Map(inserted.map((row) => [row.name, row.id]))
  for (const profile of rows) {
    const id = idByName.get(profile.name)
    if (id === undefined) throw new Error("Inserted profile " + profile.name + " was not found")
    const contactIds = [...new Set(profile.contacts.map((name) => {
      const contactId = idByName.get(name)
      if (contactId === undefined) throw new Error("Contact " + name + " was not inserted")
      return contactId
    }))]
    await callReducer("setContacts", [id, contactIds])
  }
  for (const profile of rows) {
    const id = idByName.get(profile.name)
    const dial = profile.phone.startsWith(PLACEHOLDER_PHONE_PREFIX) ? "placeholder, not dialed" : "dialable"
    console.log(String(id) + " " + profile.name + " phone ending " + profile.phone.slice(-4) + " " + dial)
  }
}

function readFixture(): Fixture {
  const path = resolve(import.meta.dirname, "../mock/profiles.json")
  const parsed = JSON.parse(readFileSync(path, "utf8")) as Fixture
  if (!Array.isArray(parsed.profiles) || parsed.profiles.length === 0) {
    throw new Error("mock/profiles.json has no profiles")
  }
  return parsed
}
