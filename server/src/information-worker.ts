import { randomUUID } from "node:crypto"
import { interpretInformationAccount } from "./agent"
import { getCall, isTerminalCallStatus, placeCall } from "./cartesia"
import * as db from "./db"
import { readInformationState, readInformationPlanning } from "./information"
import { buildInformationSnapshot, planInformationSnapshot } from "./information-planner"
import { verifyOutboundCallBinding } from "./provider-binding"
import { normalizePhone } from "../shared/information"
import { collectPendingInformationRequests } from "./information-incoming"

// Separate activities: an interpreting model request must not hold up transport
// observation or another authorized conversation. No future-follow-up scheduler.
export function startInformationWorker(): () => void {
  const interpreting = new Set<number>()
  const inspecting = new Set<number>()
  const inspectedAt = new Map<number, number>()
  const planning = new Set<number>()
  let scanning = false
  let dispatching = false
  let nextStartAt = 0
  let stopped = false

  async function read() {
    const [information, attempts, progress, profiles] = await Promise.all([
      readInformationState(), db.attempts(), db.attemptProgress(), db.profiles(),
    ])
    return { ...information, attempts, progress, profiles }
  }
  type Snapshot = Awaited<ReturnType<typeof read>>

  async function planCase(caseId: number) {
    if (stopped || process.env.AUTO_COORDINATE !== "1" || planning.has(caseId)) return
    planning.add(caseId)
    let revision: number | undefined
    try {
      // Bracket the separate SQL reads with the case revision. A snapshot assembled
      // during a new report must not be mistaken for a complete view of that revision.
      const before = await readInformationState()
      const current = before.cases.find(c => c.id === caseId)
      if (!current || current.status !== "open" || current.policy.paused || current.input_revision === current.evaluated_revision) return
      revision = current.input_revision
      const [coordination, profiles, attempts, progress, notes] = await Promise.all([
        readInformationPlanning(), db.profiles(), db.attempts(), db.attemptProgress(), db.notes(),
      ])
      const control = coordination.planning.find(p => p.support_case_id === caseId)
      if (!control?.enabled || (control.failure_revision === revision
        && (control.failure_count >= 3 || (control.retry_at_ms ?? 0) > Date.now()))) return
      // Raw receipts stay durable during interpretation/binding; they cannot be
      // used as evidence or silently bypassed by an automatic call decision.
      if (progress.some(p => p.support_case_id === caseId && p.report_received && !p.report_processed)) return
      const information = await readInformationState()
      if (information.cases.find(c => c.id === caseId)?.input_revision !== revision) return
      const snapshot = buildInformationSnapshot({ information, planning: control,
        decisions: coordination.decisions, profiles, attempts, progress, notes, caseId, nowMs: Date.now() })
      const result = await planInformationSnapshot(snapshot)
      if (stopped) return
      await db.callReducer("commitInformationPlan", [caseId, revision, JSON.stringify(result.plan), result.model, result.request_id])
    } catch (error) {
      if (revision !== undefined && !stopped) {
        // The reducer ignores failures for superseded/evaluated revisions. Real
        // model/validation failures have a persisted, bounded retry budget.
        await db.callReducer("recordInformationPlanFailure", [caseId, revision,
          error instanceof Error ? error.message.slice(0, 2000) : "Planning failed"])
      }
    } finally { planning.delete(caseId) }
  }

  async function inspect(snapshot: Snapshot, attempt: db.AttemptRow) {
    const meta = snapshot.metadata.find(m => m.attempt_id === attempt.id)
    const progress = snapshot.progress.find(p => p.attempt_id === attempt.id)
    const callId = attempt.call_id || meta?.report_provider_call_id
    if (!callId || callId.startsWith("sim_") || meta?.terminal_observed_at_ms != null
      || inspecting.has(attempt.id) || Date.now() - (inspectedAt.get(attempt.id) ?? 0) < 2000) return
    inspecting.add(attempt.id)
    inspectedAt.set(attempt.id, Date.now())
    try {
      const provider = await getCall(callId)
      if (!attempt.call_id) {
        const person = snapshot.profiles.find(p => p.id === attempt.profile_id)
        if (!person || !progress?.claim_token || verifyOutboundCallBinding(provider, {
          providerCallId: callId, agentId: process.env.CARTESIA_AGENT_ID ?? "",
          toNumber: person.phone, attemptId: String(attempt.id),
        }).status !== "matched") return
        await db.callReducer("recordInformationDispatch", [attempt.id, progress.claim_token, callId, ""])
      }
      if (isTerminalCallStatus(provider.status)) {
        await db.callReducer("observeInformationTerminal", [attempt.id, callId, provider.status, provider.endReason ?? ""])
      }
    } catch {
      // Provider unavailability does not establish termination or allow a redial.
      inspectedAt.set(attempt.id, Date.now() + 8000)
    } finally { inspecting.delete(attempt.id) }
  }

  async function interpret(snapshot: Snapshot, progress: db.AttemptProgressRow) {
    const meta = snapshot.metadata.find(m => m.attempt_id === progress.attempt_id)
    const attempt = snapshot.attempts.find(a => a.id === progress.attempt_id)
    const current = snapshot.cases.find(c => c.id === progress.support_case_id)
    if (!current || !attempt || !meta || meta.binding_status !== "matched"
      || !progress.report_received || progress.report_processed || interpreting.has(attempt.id)
      || meta.interpretation_failure_count >= 3 || (meta.interpretation_retry_at_ms ?? 0) > Date.now()) return
    interpreting.add(attempt.id)
    try {
      const account = await interpretInformationAccount({
        objective: current.objective, question: attempt.ask,
        person_name: snapshot.profiles.find(p => p.id === attempt.profile_id)?.name ?? "Caller",
        answer: attempt.answer, concern: progress.raw_concern,
      })
      await db.callReducer("finishInformationReport", [attempt.id, account.reached,
        JSON.stringify(account.notes), account.concern, account.do_not_call])
    } catch (error) {
      await db.callReducer("failInformationReport", [attempt.id, error instanceof Error ? error.message.slice(0, 1000) : "Interpretation failed"])
    } finally { interpreting.delete(attempt.id) }
  }

  async function dispatch(snapshot: Snapshot) {
    if (dispatching || stopped || Date.now() < nextStartAt) return
    const queued = snapshot.progress.filter(p => p.transport === "queued"
      && (process.env.AUTO_COORDINATE === "1" || !snapshot.metadata.find(m => m.attempt_id === p.attempt_id)?.decision_command_id.startsWith("plan:"))
      && snapshot.cases.some(c => c.id === p.support_case_id && c.status === "open"
        && !c.policy.paused && c.input_revision === c.evaluated_revision))
    if (!queued.length) return
    dispatching = true
    try {
      for (const work of queued) {
        const attempt = snapshot.attempts.find(a => a.id === work.attempt_id)
        if (!attempt) continue
        const token = randomUUID()
        try { await db.callReducer("claimInformationAttempt", [attempt.id, token]) }
        catch { continue } // Another claim, a revised case or the destination lock won.
        const fresh = await read()
        const current = fresh.cases.find(c => c.id === attempt.support_case_id)
        const meta = fresh.metadata.find(m => m.attempt_id === attempt.id)
        const progress = fresh.progress.find(p => p.attempt_id === attempt.id)
        const person = fresh.profiles.find(p => p.id === attempt.profile_id)
        if (stopped || !person || !current || current.status !== "open" || current.policy.paused
          || current.input_revision !== current.evaluated_revision || meta?.authorized_revision !== current.input_revision
          || progress?.claim_token !== token || progress.transport !== "dispatching") {
          await db.callReducer("releaseInformationClaim", [attempt.id, token, "Case changed before the provider request"])
          return
        }
        try { await db.callReducer("validateInformationClaim", [attempt.id, token]) }
        catch {
          await db.callReducer("releaseInformationClaim", [attempt.id, token, "Eligibility changed before dialing"])
          return
        }
        if (stopped) {
          await db.callReducer("releaseInformationClaim", [attempt.id, token, "Worker stopped before dialing"])
          return
        }
        nextStartAt = Date.now() + 1000
        let callId = ""
        try {
          callId = await placeCall(normalizePhone(person.phone), {
            attempt_id: String(attempt.id), person_name: person.name, ask: attempt.ask, context: work.context,
          })
          await db.callReducer("recordInformationDispatch", [attempt.id, token, callId, ""])
        } catch (error) {
          await db.callReducer("recordInformationDispatch", [attempt.id, token, callId,
            callId ? "" : error instanceof Error ? error.message.slice(0, 1000) : "Dispatch outcome is uncertain"])
        }
        return
      }
    } finally { dispatching = false }
  }

  function background(work: Promise<unknown>) {
    void work.catch(() => console.error("Information worker operation failed; saved state remains available"))
  }
  async function scan() {
    if (scanning || stopped) return
    scanning = true
    try {
      await db.callReducer("recoverInformationClaims", [])
      background(collectPendingInformationRequests())
      const snapshot = await read()
      for (const attempt of snapshot.attempts) background(inspect(snapshot, attempt))
      for (const progress of snapshot.progress) background(interpret(snapshot, progress))
      if (process.env.AUTO_COORDINATE === "1") for (const current of snapshot.cases) {
        if (current.status === "open" && !current.policy.paused && current.input_revision !== current.evaluated_revision) background(planCase(current.id))
      }
      background(dispatch(snapshot))
    } catch { console.error("Information worker cannot read persisted work") }
    finally { scanning = false }
  }
  const timer = setInterval(() => { void scan() }, 1000)
  timer.unref()
  void scan()
  return () => { stopped = true; clearInterval(timer) }
}
