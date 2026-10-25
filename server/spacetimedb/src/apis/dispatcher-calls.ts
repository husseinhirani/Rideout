import { t } from "spacetimedb/server"
import spacetimedb from "../models"

type Line = { key: string; speaker: string; text: string }

export const openDispatcherCall = spacetimedb.reducer(
  { id: t.string(), support_case_id: t.u64(), profile_id: t.u64() },
  (ctx, { id, support_case_id, profile_id }) => {
    if (!id || ctx.db.dispatcherCall.id.find(id)) throw new Error("Dispatcher call id already exists")
    const current = ctx.db.supportCase.id.find(support_case_id)
    if (!current || current.status === "closed") throw new Error("Open support case required")
    const person = ctx.db.profile.id.find(profile_id)
    if (!person || !/^\+[1-9]\d{1,14}$/.test(person.phone)) throw new Error("Dialable profile required")
    ctx.db.dispatcherCall.insert({ id, support_case_id, profile_id, call_sid: "", status: "ready",
      transcript: "[]", guidance: "", created_at: ctx.timestamp, ended_at: undefined })
  },
)

export const connectDispatcherCall = spacetimedb.reducer(
  { id: t.string(), call_sid: t.string() },
  (ctx, { id, call_sid }) => {
    const row = ctx.db.dispatcherCall.id.find(id)
    if (!row || (row.call_sid && row.call_sid !== call_sid) || row.ended_at) throw new Error("Dispatcher call unavailable")
    ctx.db.dispatcherCall.id.update({ ...row, call_sid, status: "dialing" })
  },
)

export const finishDispatcherCall = spacetimedb.reducer(
  { id: t.string(), status: t.string() },
  (ctx, { id, status }) => {
    const row = ctx.db.dispatcherCall.id.find(id)
    if (!row) throw new Error("Dispatcher call not found")
    if (row.ended_at) return
    if (!["completed", "busy", "no-answer", "failed", "canceled"].includes(status)) throw new Error("Invalid call status")
    ctx.db.dispatcherCall.id.update({ ...row, status, ended_at: ctx.timestamp })
  },
)

export const progressDispatcherCall = spacetimedb.reducer(
  { id: t.string(), call_sid: t.string(), status: t.string() },
  (ctx, { id, call_sid, status }) => {
    const row = ctx.db.dispatcherCall.id.find(id)
    if (!row || row.call_sid !== call_sid || row.ended_at) return
    if (status !== "ringing" && status !== "active") throw new Error("Invalid call progress")
    if (row.status === "active" && status === "ringing") return
    ctx.db.dispatcherCall.id.update({ ...row, status })
  },
)

export const appendDispatcherTranscript = spacetimedb.reducer(
  { id: t.string(), call_sid: t.string(), key: t.string(), speaker: t.string(), text: t.string() },
  (ctx, { id, call_sid, key, speaker, text }) => {
    const row = ctx.db.dispatcherCall.id.find(id)
    if (!row || !row.call_sid || row.call_sid !== call_sid || !text.trim()) return
    const lines = JSON.parse(row.transcript) as Line[]
    if (lines.some(line => line.key === key)) return
    lines.push({ key, speaker, text: text.trim().slice(0, 2000) })
    ctx.db.dispatcherCall.id.update({ ...row, transcript: JSON.stringify(lines) })
  },
)

export const setDispatcherGuidance = spacetimedb.reducer(
  { id: t.string(), line_count: t.u64(), guidance: t.string() },
  (ctx, { id, line_count, guidance }) => {
    const row = ctx.db.dispatcherCall.id.find(id)
    if (!row || row.ended_at || (JSON.parse(row.transcript) as Line[]).length !== Number(line_count)) return
    ctx.db.dispatcherCall.id.update({ ...row, guidance: guidance.trim().slice(0, 1500) })
  },
)
