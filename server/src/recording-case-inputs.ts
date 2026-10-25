import { randomUUID } from "node:crypto"
import { pathToFileURL } from "node:url"
import { loadEnv } from "./env"
import * as db from "./db"
import * as service from "./case-inputs"
import { runRecordingDemo, type RecordingCaseInputs } from "./recording-demo"

export function recordingCaseInputConfig(env: NodeJS.ProcessEnv): { database: string; baseUrl?: string } {
  const database = env.RECORDING_DATABASE ?? ""
  if (!/^sealert-recording-[a-z0-9-]+$/.test(database) || env.SPACETIMEDB_DATABASE !== database) {
    throw new Error("Explicit matching RECORDING_DATABASE and SPACETIMEDB_DATABASE must name a dedicated sealert-recording-* database")
  }
  let url: URL
  try { url = new URL(env.SPACETIMEDB_URL ?? "") } catch { throw new Error("Explicit SPACETIMEDB_URL=http://127.0.0.1:<port> is required") }
  if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || url.pathname !== "/" || url.search || url.hash || url.username || url.password) {
    throw new Error("SPACETIMEDB_URL must be local http://127.0.0.1:<port> without credentials or path")
  }
  return { database, baseUrl: env.RECORDING_URL }
}

type Ports = Pick<typeof db, "profiles" | "supportCases" | "caseInputs"> & Pick<typeof service, "createCaseFromIntake" | "addCaseUpdate" | "confirmCaseReunion">

/** Local fixture mapping only; these profile IDs do not authenticate a caller. */
export function createRecordingCaseInputs(ports: Ports = { ...db, ...service }): RecordingCaseInputs {
  let parentId: number | undefined
  let helperId: number | undefined
  let openedId: number | undefined
  const intakeKey = randomUUID(), updateKey = randomUUID(), confirmationKey = randomUUID()
  return {
    async open(state) {
      const parent = state.profiles.find(row => row.name === "Morgan (recording)" && row.phone === "+15555550104")
      const helpers = state.demo_mode!.helper_ids
      if (!parent || helpers.includes(parent.id)) throw new Error("Seed the separate Morgan (recording) parent with fictional +15555550104 phone")
      const rows = await ports.profiles()
      for (const id of [parent.id, ...helpers]) {
        const api = state.profiles.find(row => row.id === id)
        const stored = rows.find(row => row.id === id)
        if (!api || !stored || api.name !== stored.name || api.phone !== stored.phone) throw new Error("Database fixture profiles do not match the recording backend")
      }
      parentId = parent.id
      helperId = helpers[0]
      const draft = {
        child: { name: "Ava", description: "Age 7, red jacket", last_seen_location_id: "park-bench", last_seen_time: "15:00" },
        reporter: { name: "Morgan (recording)", relationship: "parent", attribution: "self_reported" },
      }
      const meta = { eventKey: intakeKey, reporterProfileId: parentId, helperProfileIds: helpers }
      const first = await ports.createCaseFromIntake(draft, meta)
      if (first.status !== "recorded") throw new Error("Recording intake unexpectedly requires clarification")
      const before = (await ports.caseInputs()).filter(row => row.support_case_id === first.support_case_id)
      const replay = await ports.createCaseFromIntake(draft, meta)
      const after = (await ports.caseInputs()).filter(row => row.support_case_id === first.support_case_id)
      if (replay.status !== "recorded" || replay.support_case_id !== first.support_case_id || JSON.stringify(before) !== JSON.stringify(after)) throw new Error("Exact intake replay did not preserve its case and input events")
      const supportCase = (await ports.supportCases()).find(row => row.id === first.support_case_id)
      if (!supportCase) throw new Error("Recorded case was not found")
      openedId = supportCase.id
      console.log(JSON.stringify({ stage: "intake-replay-deduplicated", support_case_id: openedId, notice: "Internal intake; server-configured fictional profile binding, no caller identity verification." }))
      return { support_case_id: openedId, incident_id: supportCase.incident_id }
    },
    async update(caseId, text) {
      if (!helperId || caseId !== openedId) throw new Error("Open the recording case before updating")
      await ports.addCaseUpdate({ eventKey: updateKey, caseId, reporterProfileId: helperId }, text)
    },
    async confirm(caseId) {
      if (!parentId || caseId !== openedId) throw new Error("Open the recording case before confirming")
      await ports.confirmCaseReunion({ eventKey: confirmationKey, caseId, reporterProfileId: parentId }, {
        childIdentityConfirmed: true, reunited: true,
        text: "Simulated original reporter states: This is Ava and we are reunited. Reported confirmation only; caller identity is not verified.",
      })
    },
  }
}

async function main(): Promise<void> {
  if (process.argv.includes("--help")) {
    console.log("Usage: SPACETIMEDB_URL=http://127.0.0.1:3000 SPACETIMEDB_DATABASE=sealert-recording-<name> RECORDING_DATABASE=sealert-recording-<name> npm run demo:case-inputs\nRequires a seeded simulated/scripted recording backend. Uses internal application intake with simulated profile bindings and reported reunion; no real inbound phone or verified caller identity.")
    return
  }
  if (process.argv.length > 2) throw new Error("Unknown argument; use --help")
  loadEnv()
  const config = recordingCaseInputConfig(process.env)
  await runRecordingDemo({ ...config, callbackSecret: process.env.CALLBACK_SECRET?.trim(), caseInputs: createRecordingCaseInputs(), report: event => console.log(JSON.stringify(event)) })
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(`Case input recording failed: ${error instanceof Error ? error.message : String(error)}`); process.exitCode = 1 })
}
