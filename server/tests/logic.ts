import assert from "node:assert/strict"
import { decodeSql, type ProfileRow } from "../src/db"
import { candidatesFor } from "../src/loop"

function profile(id: number, name: string, phone = "+1415555" + String(1000 + id)): ProfileRow {
  return { id, name, phone, lat: 34.19, lng: -118.14, contact_profile_ids: [] }
}

const victim = profile(1, "Ada")
const contact = profile(2, "Bo")
const other = profile(3, "Cy")
const trapped = profile(4, "Di")
const unlisted = profile(5, "Eli", "+15555550100")
const everyone = new Map([victim, contact, other, trapped, unlisted].map((row) => [row.id, row]))

function run(overrides: Partial<Parameters<typeof candidatesFor>[0]> = {}): number[] {
  return candidatesFor({
    victimProfileId: victim.id,
    contactProfileIds: [],
    incidentProfileIds: [1, 2, 3, 4, 5],
    needsHelpProfileIds: [trapped.id],
    attemptedProfileIds: [],
    profilesById: everyone,
    ...overrides,
  }).map((row) => row.id)
}

// The victim, anyone who needs help themselves, and a placeholder phone are
// never candidates.
assert.deepEqual(run(), [contact.id, other.id])

// Contacts come first, in the order the victim lists them.
assert.deepEqual(run({ contactProfileIds: [other.id, contact.id] }), [other.id, contact.id])

// Nobody is called twice on the same case.
assert.deepEqual(run({ attemptedProfileIds: [contact.id] }), [other.id])

// A contact who is not on the incident is still a candidate.
assert.deepEqual(run({ contactProfileIds: [other.id], incidentProfileIds: [contact.id] }), [
  other.id,
  contact.id,
])

assert.deepEqual(run({ contactProfileIds: [], incidentProfileIds: [victim.id, unlisted.id] }), [])

const rows = decodeSql([
  {
    schema: {
      elements: [
        { name: { some: "id" } },
        { name: { some: "phone" } },
        { name: { some: "contact_profile_ids" } },
        { name: { some: "call_id" } },
      ],
    },
    rows: [[1, "+14155550123", [2], { none: [] }], [3, "+14155550124", [], { some: "call-1" }]],
  },
])

assert.deepEqual(rows, [
  { id: 1, phone: "+14155550123", contact_profile_ids: [2], call_id: null },
  { id: 3, phone: "+14155550124", contact_profile_ids: [], call_id: "call-1" },
])

console.log("ok")
