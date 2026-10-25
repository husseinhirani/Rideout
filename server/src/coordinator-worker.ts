import type { Learned } from "./agent"
import type { CaseProgressRow, AttemptProgressRow, ProfileRow, SupportCaseRow, IncidentRow, AttemptRow, NoteRow } from "./db"
import type { Planner } from "./coordinator"
import { evaluateCase, type CaseSnapshot } from "./coordinator"
import { randomUUID } from "node:crypto"

export type CoordinationState = {
  cases: SupportCaseRow[]; incidents: IncidentRow[]; profiles: ProfileRow[]
  attempts: AttemptRow[]; notes: NoteRow[]
  coordination: CaseProgressRow[]; attempt_progress: AttemptProgressRow[]
}
export type WorkerPorts = {
  read: () => Promise<CoordinationState>
  reduce: (name: string, args: unknown[]) => Promise<void>
  plan: Planner
  interpret: (input: unknown) => Promise<Learned & { accepted: boolean }>
  dial: (attempt: AttemptRow, profile: ProfileRow, context: string, token: string) => Promise<void>
  inspect: (callId: string) => Promise<{ status: string; endReason: string | null }>
  now: () => number
}

export async function readStableCoordinationState(
  readProgress: () => Promise<CaseProgressRow[]>,
  readRecords: () => Promise<Omit<CoordinationState, "coordination">>,
): Promise<CoordinationState> {
  const fingerprint = (rows: CaseProgressRow[]) => JSON.stringify(
    [...rows].sort((a, b) => a.support_case_id - b.support_case_id),
  )
  for (let attempt = 0; attempt < 3; attempt++) {
    const before = await readProgress()
    const records = await readRecords()
    const after = await readProgress()
    if (fingerprint(before) === fingerprint(after)) return {...records, coordination: after}
  }
  throw new Error("Case state changed during snapshot read; retry on next scan")
}

export function createCoordinatorWorker(ports: WorkerPorts) {
  let running: Promise<void> | null = null
  async function processCase(caseId: number): Promise<void> {
    await ports.reduce("tickCoordination", [caseId])
    let state = await ports.read()
    let progress = state.coordination.find(row => row.support_case_id === caseId)!
    const paused = () => Boolean(progress.blocked_reason) || (progress.retry_at_ms !== null && progress.retry_at_ms > ports.now())
    if (paused()) return

    // Raw receipts were already saved by the HTTP handler. Interrupted processing
    // resumes here, and the reducer commits notes + result together exactly once.
    for (const receipt of state.attempt_progress.filter(row => row.support_case_id === caseId && row.report_received && !row.report_processed)) {
      const attempt = state.attempts.find(row => row.id === receipt.attempt_id)!
      const current = state.cases.find(row => row.id === caseId)!
      try {
        const learned = await ports.interpret({
          goal: current.goal,
          person: state.profiles.find(row => row.id === attempt.profile_id)?.name,
          ask: attempt.ask, answer: attempt.answer, flagged_by_the_in_call_agent: receipt.raw_concern,
          already_known: state.notes.filter(row => row.support_case_id === caseId).map(row => row.text),
        })
        await ports.reduce("finishCoordinationReport", [attempt.id, learned.reached, learned.accepted, JSON.stringify(learned.notes), learned.concern])
      } catch {
        await ports.reduce("recordCoordinationFailure", [caseId, progress.input_revision, "Report interpretation failed; raw report preserved."])
        return
      }
      state = await ports.read()
      progress = state.coordination.find(row => row.support_case_id === caseId)!
    }

    // A provider summary is not a conversational report. Only the terminal status
    // Vien observed is recognized here; unknown statuses leave the call unresolved.
    await Promise.all(state.attempt_progress.filter(row => row.support_case_id === caseId && ["active", "unknown", "dispatching"].includes(row.transport)).map(async row => {
      const attempt = state.attempts.find(item => item.id === row.attempt_id)!
      if (!attempt.call_id || attempt.call_id.startsWith("sim_")) return
      try {
        const call = await ports.inspect(attempt.call_id)
        if (call.status === "completed") await ports.reduce("markCoordinationEnded", [attempt.id, call.endReason ?? "unknown"])
      } catch { /* Preserve uncertain transport and its call budget; next scan can reconcile. */ }
    }))

    state = await ports.read()
    progress = state.coordination.find(row => row.support_case_id === caseId)!
    if (state.cases.find(row => row.id === caseId)?.status !== "open" || paused()) return
    if (progress.input_revision !== progress.evaluated_revision) {
      try {
        const decision = await evaluateCase(snapshotFor(state, progress, ports.now()), ports.plan)
        if (decision.status === "failed" || decision.status === "rejected") throw new Error(decision.reason)
        await ports.reduce("commitCoordinationPlan", [caseId, progress.input_revision, JSON.stringify(decision.calls)])
      } catch {
        // Revision mismatch is a harmless stale result: the reducer ignores this
        // failure marker when a newer input has already arrived.
        await ports.reduce("recordCoordinationFailure", [caseId, progress.input_revision, "Planning failed; no new calls authorized."])
        return
      }
    }

    state = await ports.read()
    await Promise.all(state.attempt_progress.filter(row => row.support_case_id === caseId && row.transport === "queued").map(async queued => {
      const token = randomUUID()
      try {
        await ports.reduce("claimCoordinationAttempt", [queued.attempt_id, token])
      } catch { return } // Another worker, new input, closure or destination lock won.
      const fresh = await ports.read()
      const claimed = fresh.attempt_progress.find(row => row.attempt_id === queued.attempt_id)
      if (claimed?.claim_token !== token || claimed.transport !== "dispatching") return
      const current = fresh.coordination.find(row => row.support_case_id === caseId)!
      if (fresh.cases.find(row => row.id === caseId)?.status !== "open" || current.input_revision !== current.evaluated_revision) return
      const attempt = fresh.attempts.find(row => row.id === queued.attempt_id)!
      const profile = fresh.profiles.find(row => row.id === attempt.profile_id)!
      // dial() owns provider execution and saves started/unknown against this token.
      // If the process dies here, the expired claim becomes unknown, never queued.
      await ports.dial(attempt, profile, queued.context, token)
    }))
  }
  async function scan(): Promise<void> {
    const state = await ports.read()
    for (const progress of state.coordination) await processCase(progress.support_case_id)
  }
  return {
    tick(): Promise<void> {
      if (!running) running = scan().finally(() => { running = null })
      return running
    },
  }
}

function snapshotFor(state: CoordinationState, progress: CaseProgressRow, now: number): CaseSnapshot {
  const current = state.cases.find(row => row.id === progress.support_case_id)!
  const victim = state.profiles.find(row => row.id === current.victim_profile_id)!
  const incident = state.incidents.find(row => row.id === current.incident_id)!
  const history = state.attempt_progress.filter(row => row.support_case_id === current.id && row.transport !== "cancelled")
  const locations = [{id:"park-bench",label:"Park bench"},{id:"playground",label:"Playground"}]
  return {
    case_id: current.id, status: current.status === "closed" ? "closed" : "open", now,
    child: {name:victim.name,description:current.goal + ". " + incident.description,last_seen_location_id:"not structured; see initial report",last_seen_at:"not structured; see initial report"},
    // Intake identity is supplied by milestone 3; do not invent a verified parent.
    reporter: {name:"Initial report",relationship:"not yet bound by phone intake"},
    helpers: progress.helper_profile_ids.map((id,index) => {
      const person = state.profiles.find(row => row.id === id)!
      return {profile_id:id,name:person.name,phone:person.phone,location_id:locations[index].id,available:true}
    }), locations,
    reports: state.notes.filter(row => row.support_case_id === current.id).map(row => ({
      id:String(row.id),source_name:row.source,text:row.text,received_at:Date.parse(row.at),
    })),
    attempts: history.map(row => {
      const attempt = state.attempts.find(item => item.id === row.attempt_id)!
      return {id:attempt.id,profile_id:attempt.profile_id,ask:attempt.ask,answer:attempt.answer,
        transport:row.transport === "ended" ? "ended" : row.transport === "unknown" ? "unknown" : "active",accepted_at:row.accepted_at_ms}
    }),
  }
}
