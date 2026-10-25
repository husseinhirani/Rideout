// One real answered call, end to end, without touching anyone else's phone.
//
// It builds a throwaway case in the middle of the Pacific, adds one attempt
// against the number you pass, and dials it. Everything after the dial is the
// real path: the hosted agent calls report_call, Cartesia sends the
// CALLBACK_SECRET bearer, POST /calls/report resolves the attempt, and Claude
// turns what you said into notes.
//
//   npm run test:report -- +14155550123
//
// Answer the phone, say one sentence, let the agent finish. The script polls
// the attempt row and prints what landed.

import { placeCall } from "../src/cartesia"
import { attempts, callReducer, notes, profiles, supportCases } from "../src/db"
import { loadEnv } from "../src/env"

const E164 = /^\+[1-9]\d{1,14}$/
const POLL_MS = 3_000
const WAIT_MS = 300_000
// Deliberately not a welfare question. "Are you safe?" reads like a check-in and
// the voice model will reach for record_check_in instead of report_call.
const ASK = "In one sentence, when did you last see Ava and where was she?"
const CONTEXT = "This is a test of the coordination line. Nothing real is happening."

loadEnv()

const phone = process.argv[2]?.trim() ?? ""
if (E164.test(phone) === false) {
  console.error("usage: npm run test:report -- +14155550123")
  process.exit(1)
}

probe(phone).then(
  () => process.exit(0),
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : "Probe failed")
    process.exit(1)
  },
)

async function probe(to: string): Promise<void> {
  const stamp = String(Date.now())
  // Mid-Pacific, so no real incident ever sweeps these two in.
  const lat = -20
  const lng = -140 + Math.random() * 20
  await callReducer("insertProfile", ["probe-victim-" + stamp, "+15555550199", lat, lng, []])
  await callReducer("insertProfile", ["probe-witness-" + stamp, to, lat, lng, []])
  const victim = await findProfile("probe-victim-" + stamp)
  const witness = await findProfile("probe-witness-" + stamp)

  await callReducer("createIncident", ["missing person", "provider probe " + stamp, lat, lng, 0])
  const incidentId = await latestIncident()
  await callReducer("openCase", [incidentId, victim.id, "Provider probe: confirm report_call reaches /calls/report."])
  const supportCase = (await supportCases()).find((row) => row.incident_id === incidentId)
  if (!supportCase) throw new Error("Support case was not opened")
  await callReducer("addAttempt", [supportCase.id, witness.id, ASK])
  const attempt = (await attempts()).find((row) => row.support_case_id === supportCase.id)
  if (!attempt) throw new Error("Attempt was not added")

  console.log("attempt_id " + String(attempt.id) + ", case " + String(supportCase.id))
  const callId = await placeCall(to, {
    attempt_id: String(attempt.id),
    person_name: "there",
    ask: ASK,
    context: CONTEXT,
  })
  await callReducer("setAttemptCall", [attempt.id, callId])
  console.log("dialing " + to + " as " + callId + ". Answer it, then wait.")

  const deadline = Date.now() + WAIT_MS
  while (Date.now() < deadline) {
    await delay(POLL_MS)
    const row = (await attempts()).find((item) => item.id === attempt.id)
    if (!row?.outcome) continue
    console.log("outcome   " + row.outcome)
    console.log("answer    " + JSON.stringify(row.answer))
    console.log("concern   " + JSON.stringify(row.concern))
    for (const note of await notes()) {
      if (note.support_case_id === supportCase.id) console.log("note      " + note.text)
    }
    if (row.outcome !== "answered") throw new Error("Reported, but Claude read it as not reached")
    return
  }
  throw new Error("No report reached /calls/report within " + String(WAIT_MS / 1000) + "s")
}

async function findProfile(name: string): Promise<{ id: number }> {
  const row = (await profiles()).find((item) => item.name === name)
  if (!row) throw new Error(name + " was not inserted")
  return row
}

async function latestIncident(): Promise<number> {
  const { incidents } = await import("../src/db")
  const rows = await incidents()
  const row = rows.reduce<{ id: number } | null>((best, item) => (!best || item.id > best.id ? item : best), null)
  if (!row) throw new Error("Incident was not created")
  return row.id
}

function delay(ms: number): Promise<void> {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms))
}
