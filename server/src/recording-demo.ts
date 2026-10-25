import { pathToFileURL } from "node:url"
import { loadEnv } from "./env"
import { BLOCK } from "../shared/locations"
import type { AttemptRow, AttemptProgressRow, ProfileRow, SupportCaseRow, NoteRow, CaseProgressRow } from "./db"

export type RecordingState = {
  demo_mode?: { simulate: boolean; scripted: boolean; auto_coordinate: boolean; database: string; helper_ids: number[] }
  case_intakes?: { support_case_id: number; reunion_confirmed: boolean }[]
  profiles: ProfileRow[]
  cases: SupportCaseRow[]
  attempts: AttemptRow[]
  attempt_progress: AttemptProgressRow[]
  notes: NoteRow[]
  coordination: CaseProgressRow[]
}
export type RecordingEvent = { stage: string; at: string; detail: unknown }
export type RecordingCaseInputs = {
  open: (state: RecordingState) => Promise<{ support_case_id: number; incident_id: number }>
  update: (caseId: number, text: string) => Promise<void>
  confirm: (caseId: number) => Promise<void>
}
export type RecordingOptions = {
  callbackSecret?: string
  caseInputs?: RecordingCaseInputs
  database: string
  baseUrl?: string
  fetch?: typeof fetch
  report?: (event: RecordingEvent) => void
  timeoutMs?: number
  pollMs?: number
}

/** Replay against the running HTTP backend; no worker or database behavior is replaced. */
export async function runRecordingDemo(options: RecordingOptions): Promise<RecordingEvent[]> {
  const base = new URL(options.baseUrl ?? "http://127.0.0.1:8787")
  if (base.protocol !== "http:" || base.hostname !== "127.0.0.1" || base.pathname !== "/" || base.search || base.hash || base.username || base.password) {
    throw new Error("Recording requires http://127.0.0.1:<port> with no path or credentials")
  }
  if (!/^sealert-recording(?:-[a-z0-9-]+)?$/.test(options.database)) {
    throw new Error("RECORDING_DATABASE must name a dedicated sealert-recording or sealert-recording-* database")
  }
  const fetcher = options.fetch ?? fetch
  const events: RecordingEvent[] = []
  const emit = (stage: string, detail: unknown) => {
    const event = { stage, at: new Date().toISOString(), detail }
    events.push(event)
    options.report?.(event)
  }
  async function request<T>(path: string, body?: unknown): Promise<T> {
    let response: Response
    try {
      response = await fetcher(new URL(path, base), {
        method: body === undefined ? "GET" : "POST",
        headers: { "Content-Type": "application/json", ...(path === "/calls/report" && options.callbackSecret ? { Authorization: "Bearer " + options.callbackSecret } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(10_000),
      })
    } catch (error) {
      throw new Error(`${path}: backend unavailable or timed out; start the recording server. ${String(error)}`)
    }
    if (!response.ok) throw new Error(`${path}: HTTP ${response.status}: ${await response.text()}`)
    return await response.json() as T
  }
  async function poll(stage: string, ready: (state: RecordingState) => boolean): Promise<RecordingState> {
    const deadline = Date.now() + (options.timeoutMs ?? 45_000)
    let state: RecordingState
    do {
      state = await request<RecordingState>("/state")
      if (ready(state)) return state
      await new Promise(resolve => setTimeout(resolve, options.pollMs ?? 300))
    } while (Date.now() < deadline)
    throw new Error(`Timed out waiting for ${stage}. Inspect server logs and /state coordination: ${JSON.stringify(state.coordination)}`)
  }

  const initial = await request<RecordingState>("/state")
  const mode = initial.demo_mode
  if (!mode?.simulate || !mode.scripted || !mode.auto_coordinate || mode.database !== options.database) {
    throw new Error("Backend must report matching dedicated database, SIMULATE=1, scripted model and AUTO_COORDINATE=1 in /state demo_mode")
  }
  if (mode.helper_ids.length !== 2 || new Set(mode.helper_ids).size !== 2) throw new Error("Configure exactly two recording helper IDs")
  const helpers = mode.helper_ids.map(id => initial.profiles.find(profile => profile.id === id))
  if (helpers.some(helper => !helper?.phone.startsWith("+1555555")) || helpers[0]?.phone === helpers[1]?.phone) {
    throw new Error("Recording helpers must have distinct fictional +1555555 placeholder phones; run the recording seed command")
  }
  const child = initial.profiles.find(profile => profile.name === "Ava (recording)" && profile.phone === "")
  if (!options.caseInputs && (!child || mode.helper_ids.includes(child.id))) throw new Error("Seed the separate Ava (recording) profile with an empty phone")
  if (initial.cases.some(row => row.status !== "closed")) throw new Error("Close existing recording cases before starting another replay")
  if (initial.attempt_progress.some(row => !["ended", "cancelled"].includes(row.transport))) {
    throw new Error("Resolve outstanding simulated calls before replay; closing a case does not end its calls")
  }
  emit("mode", { ...mode, notice: "SIMULATED CALLS; SCRIPTED MODEL. Real HTTP, worker and persisted database. Not evidence of Claude adaptation or real phone delivery." })

  const opened = options.caseInputs ? await options.caseInputs.open(initial) : await (async () => {
    const incident = await request<{ incident_id: number }>("/incidents", {
      type: "Fictional recording: Ava, age 7, red jacket, last seen at Park bench at 15:00; possible search locations Park bench and Playground",
      lat: BLOCK.lat, lng: BLOCK.lng, radius_m: 0,
    })
    const opened = await request<{ support_case_id: number }>("/cases", {
      incident_id: incident.incident_id, victim_profile_id: child!.id,
      goal: "Locate Ava, age 7, red jacket, last seen at Park bench at 15:00. Gather observations from Park bench and Playground; keep case open pending human confirmation.",
    })
    return { ...incident, ...opened }
  })()
  const caseId = opened.support_case_id
  const attempts = (state: RecordingState) => state.attempts.filter(row => row.support_case_id === caseId)
  const active = (state: RecordingState, row: AttemptRow) => state.attempt_progress.some(progress => progress.attempt_id === row.id && progress.transport === "active")
  const processed = (state: RecordingState, rows: AttemptRow[]) => rows.every(row => state.attempt_progress.some(progress => progress.attempt_id === row.id && progress.report_processed))
  emit("case-opened", opened)
  const firstState = await poll("two initial helper calls", state => attempts(state).length === 2 && attempts(state).every(row => active(state, row)))
  const first = attempts(firstState)
  if (!mode.helper_ids.every(id => first.some(row => row.profile_id === id))) throw new Error("Initial calls did not reach both configured helpers")
  emit("initial-calls", first)
  for (const row of first) {
    await request("/calls/report", { attempt_id: String(row.id), answer: row.profile_id === mode.helper_ids[0] ? "Yes, I can check the park bench." : "Yes, I can check the playground.", concern: "" })
  }
  await poll("accepted reports", state => processed(state, first) && first.every(row => state.attempt_progress.some(progress => progress.attempt_id === row.id && progress.accepted_at_ms !== null)))
  emit("helpers-accepted", { message: "Both simulated helpers accepted; persisted ten-second follow-up timers are running." })
  const clue = "A witness reports a red backpack near the playground."
  if (options.caseInputs) await options.caseInputs.update(caseId, clue)
  else await request(`/cases/${caseId}/input`, { text: clue })
  emit("new-clue", { text: options.caseInputs ? "Unverified witness clue: red backpack near the playground. Internal service update with a simulated helper profile binding; no inbound phone or verified identity." : "Unverified witness clue: red backpack near the playground. Submitted through dispatcher input; inbound phone intake is not implemented." })
  const followed = await poll("two due follow-up calls", state => attempts(state).length === 4 && attempts(state).filter(row => !first.some(old => old.id === row.id)).every(row => active(state, row)))
  const followups = attempts(followed).filter(row => !first.some(old => old.id === row.id))
  if (!followups.every(row => /playground/i.test(row.ask))) throw new Error("Follow-up questions did not include the new Playground clue")
  emit("follow-up-calls", followups)
  for (const [index, row] of followups.entries()) {
    await request("/calls/report", { attempt_id: String(row.id), answer: index === 0 ? "Possible find, possible match: I see a child in a red jacket beside the Playground slide. I cannot confirm identity or a reunion." : "I checked the Park bench; I have no confirmed sighting.", concern: "" })
  }
  const possible = await poll("possible-find reports and brief", state => processed(state, followups) && state.cases.some(row => row.id === caseId && /possible find/i.test(row.brief)))
  const pending = possible.cases.find(row => row.id === caseId)!
  if (pending.status === "closed") throw new Error("Possible-find evidence unexpectedly closed the case")
  emit("possible-find-still-open", { case: pending, notes: possible.notes.filter(row => row.support_case_id === caseId) })
  if (options.caseInputs) await options.caseInputs.confirm(caseId)
  else await request(`/cases/${caseId}/close`, {})
  const closed = await poll(options.caseInputs ? "simulated reporter confirmation" : "manual dispatcher closure", state => state.cases.some(row => row.id === caseId && row.status === "closed") && (!options.caseInputs || state.case_intakes?.some(row => row.support_case_id === caseId && row.reunion_confirmed) === true))
  if (attempts(closed).length !== 4) throw new Error("Expected exactly two outbound calls per helper")
  emit(options.caseInputs ? "simulated-reporter-confirmation" : "manually-closed", { case: closed.cases.find(row => row.id === caseId), notice: options.caseInputs ? "Reported reunion through internal application service with a simulated original reporter profile binding. Not real phone delivery or verified parent identity." : "Manual dispatcher closure for this recording. This does not verify parent identity or phone-confirmed reunion." })
  return events
}

async function main(): Promise<void> {
  if (process.argv.includes("--help")) {
    console.log("Usage: RECORDING_DATABASE=sealert-recording-<name> npm run demo:recording\nOptional RECORDING_URL=http://127.0.0.1:8787. Start a seeded simulated/scripted recording backend first. Emits JSON stage events to stdout; redirect to save a transcript. No database reset or phone/provider changes.")
    return
  }
  if (process.argv.length > 2) throw new Error("Unknown argument; use --help")
  loadEnv()
  await runRecordingDemo({ callbackSecret: process.env.CALLBACK_SECRET?.trim(), database: process.env.RECORDING_DATABASE ?? "", baseUrl: process.env.RECORDING_URL, report: event => console.log(JSON.stringify(event)) })
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(`Recording failed: ${error instanceof Error ? error.message : String(error)}`); process.exitCode = 1 })
}
