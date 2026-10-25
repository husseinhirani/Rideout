import { SenderError, t } from "spacetimedb/server"
import spacetimedb from "../models"

type Ctx = Parameters<Parameters<typeof spacetimedb.reducer>[1]>[0]
function current(ctx: Ctx, requestId: bigint, revision: bigint) {
  const row = ctx.db.incomingRequest.id.find(requestId)
  if (!row || row.revision !== revision) throw new SenderError("Incoming request revision changed")
  return row
}
const validText = (value: string, max: number) => value.trim().length > 0 && value.length <= max

export const receiveIncomingRequest = spacetimedb.reducer(
  { provider_call_id: t.string(), from_phone: t.string(), direction: t.string(), text: t.string() },
  (ctx, { provider_call_id, from_phone, direction, text }) => {
    if (!validText(provider_call_id, 200) || /[{}\s]/.test(provider_call_id) || !/^\+[1-9]\d{7,14}$/.test(from_phone) || direction !== "inbound" || !validText(text, 20_000)) {
      throw new SenderError("Valid inbound call metadata and text are required")
    }
    const existing = ctx.db.incomingRequest.provider_call_id.find(provider_call_id)
    if (existing) {
      if (existing.from_phone !== from_phone || existing.direction !== direction) throw new SenderError("Incoming request metadata conflict")
      if (existing.text === text) return
      if (existing.status !== "needs_clarification") throw new SenderError("Incoming request content conflict")
      ctx.db.incomingRequest.id.update({ ...existing, text, revision: existing.revision + 1n, status: "pending", decision_json: "", reply: "Your report is saved for processing.", support_case_id: undefined, failure_count: 0, retry_at_ms: 0n })
      return
    }
    ctx.db.incomingRequest.insert({ id: 0n, provider_call_id, from_phone, direction, text, revision: 1n, status: "pending", decision_json: "", reply: "Your report is saved for processing.", support_case_id: undefined, failure_count: 0, retry_at_ms: 0n })
  },
)

export const prepareIncomingRequest = spacetimedb.reducer(
  { request_id: t.u64(), expected_revision: t.u64(), decision_json: t.string(), status: t.string(), reply: t.string() },
  (ctx, { request_id, expected_revision, decision_json, status, reply }) => {
    const row = current(ctx, request_id, expected_revision)
    if (row.status !== "pending") throw new SenderError("Incoming request decision already saved")
    if (!["prepared", "needs_clarification", "needs_review"].includes(status) || !validText(reply, 1000) || decision_json.length > 40_000) throw new SenderError("Invalid incoming request decision")
    try {
      const decision: unknown = JSON.parse(decision_json)
      if (decision === null || typeof decision !== "object" || Array.isArray(decision)) throw new Error("not object")
    } catch { throw new SenderError("Incoming request decision must be a JSON object") }
    ctx.db.incomingRequest.id.update({ ...row, status, decision_json, reply, retry_at_ms: 0n })
  },
)

export const finishIncomingRequest = spacetimedb.reducer(
  { request_id: t.u64(), expected_revision: t.u64(), support_case_id: t.u64(), reply: t.string() },
  (ctx, { request_id, expected_revision, support_case_id, reply }) => {
    const row = current(ctx, request_id, expected_revision)
    if (support_case_id === 0n || !validText(reply, 1000)) throw new SenderError("Recorded request needs a case and reply")
    if (row.status === "recorded" && row.support_case_id === support_case_id && row.reply === reply) return
    if (row.status !== "prepared") throw new SenderError("Incoming request is not prepared")
    ctx.db.incomingRequest.id.update({ ...row, status: "recorded", support_case_id, reply, retry_at_ms: 0n })
  },
)

export const failIncomingRequest = spacetimedb.reducer(
  { request_id: t.u64(), expected_revision: t.u64() },
  (ctx, { request_id, expected_revision }) => {
    const row = current(ctx, request_id, expected_revision)
    if (row.status !== "pending" && row.status !== "prepared") throw new SenderError("Incoming request is not processing")
    const failure_count = row.failure_count + 1
    const blocked = failure_count >= 3
    ctx.db.incomingRequest.id.update({ ...row, failure_count, status: blocked ? "needs_review" : row.status,
      reply: blocked ? "Your report is saved and needs operator review." : row.reply,
      retry_at_ms: blocked ? 0n : ctx.timestamp.microsSinceUnixEpoch / 1000n + BigInt(2 ** failure_count * 1000),
    })
  },
)
