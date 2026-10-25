import type { Plan } from "../src/agent"
import type { CaseSnapshot } from "../src/coordinator"

// Fictional, independent snapshots. No real phone numbers or communications.
export function demoSnapshots(): Array<{ name: string; snapshot: CaseSnapshot; proposal: Plan }> {
  const start = Date.parse("2026-10-25T15:00:00Z")
  const base: CaseSnapshot = {
    case_id: 3,
    status: "open",
    now: start,
    child: {
      name: "Ava Reyes",
      description: "Seven years old, red coat, blue backpack",
      last_seen_location_id: "park-bench",
      last_seen_at: "2026-10-25T14:55:00Z",
    },
    reporter: { name: "Maya Reyes", relationship: "parent" },
    helpers: [
      { profile_id: 11, name: "Alex", phone: "+15555550101", location_id: "park-bench", available: true },
      { profile_id: 12, name: "Sam", phone: "+15555550102", location_id: "playground", available: true },
    ],
    locations: [
      { id: "park-bench", label: "Park bench" },
      { id: "playground", label: "Playground" },
    ],
    reports: [{ id: "parent-initial", source_name: "Maya Reyes", text: "Ava was last seen at the park bench wearing a red coat and blue backpack.", received_at: start }],
    attempts: [],
  }
  const initial: Plan = {
    reason: "Ask two nearby people about different last-seen areas.",
    calls: [
      { profile_id: 11, ask: "From the park bench, can you see Ava in a red coat with a blue backpack?", context: "Ava's parent reports her missing near the park bench." },
      { profile_id: 12, ask: "From the playground, have you seen a child in a red coat with a blue backpack?", context: "Ava, age seven, was last seen near the park bench." },
    ],
  }
  const accepted: CaseSnapshot = {
    ...base,
    now: start + 9_000,
    attempts: initial.calls.map((call, i) => ({ id: i + 1, profile_id: call.profile_id, ask: call.ask, answer: "I can look from here.", transport: "ended", accepted_at: start })),
  }
  const sighting: CaseSnapshot = {
    ...accepted,
    now: start + 10_000,
    reports: [...base.reports, { id: "new-sighting", source_name: "Sam", text: "I saw a child in a red coat at the playground; I could not see a backpack.", received_at: start + 10_000 }],
  }
  const followup: Plan = {
    reason: "Clarify the new playground sighting after the acceptance wait and ended calls.",
    calls: [{ profile_id: 12, ask: "In your sighting at the playground, could you tell whether the child had a blue backpack?", context: "Ava wears a red coat and blue backpack. Your playground sighting is unconfirmed." }],
  }
  const possibleFind: CaseSnapshot = {
    ...sighting,
    now: start + 25_000,
    attempts: [...sighting.attempts, { id: 3, profile_id: 12, ask: followup.calls[0].ask, answer: "Yes, the child at the playground has a blue backpack. Her parent has not confirmed.", transport: "ended", accepted_at: start + 10_000 }],
    reports: [...sighting.reports, { id: "possible-find", source_name: "Sam", text: "I may have found Ava at the playground. A child here matches the coat and backpack, but her parent has not confirmed.", received_at: start + 25_000 }],
  }
  return [
    { name: "Initial bench and playground questions", snapshot: base, proposal: initial },
    { name: "Accepted 9 seconds ago: wait", snapshot: accepted, proposal: followup },
    { name: "Accepted 10 seconds ago, transport ended, new sighting", snapshot: sighting, proposal: followup },
    {
      name: "Possible find: case remains open",
      snapshot: possibleFind,
      proposal: { reason: "A matching description is not parent confirmation; await identity and reunion confirmation.", calls: [] },
    },
    {
      name: "Parent confirmed: case closed",
      snapshot: { ...possibleFind, status: "closed", now: start + 40_000, reports: [...possibleFind.reports, { id: "parent-confirmed", source_name: "Maya Reyes", text: "I confirm this child is Ava, and she is back with me. Close the case.", received_at: start + 40_000 }] },
      proposal: { reason: "Parent confirmed; no further calls.", calls: [] },
    },
  ]
}
