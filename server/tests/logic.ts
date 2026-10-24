import assert from "node:assert/strict"
import { nextCandidate } from "../src/candidates"
import { decodeSql } from "../src/db"

const victim = 1
const contact = 2
const other = 3

assert.equal(
  nextCandidate({
    victimProfileId: victim,
    contactProfileIds: [contact],
    safeProfileIds: [other, contact],
    attemptedProfileIds: [],
  }),
  contact,
)

assert.equal(
  nextCandidate({
    victimProfileId: victim,
    contactProfileIds: [contact],
    safeProfileIds: [other, contact],
    attemptedProfileIds: [contact],
  }),
  other,
)

assert.equal(
  nextCandidate({
    victimProfileId: victim,
    contactProfileIds: [contact],
    safeProfileIds: [victim],
    attemptedProfileIds: [],
  }),
  null,
)

assert.equal(
  nextCandidate({
    victimProfileId: victim,
    contactProfileIds: [other],
    safeProfileIds: [contact],
    attemptedProfileIds: [],
  }),
  contact,
)

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
