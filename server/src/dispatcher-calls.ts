import { randomUUID } from "node:crypto"
import type { IncomingMessage } from "node:http"
import twilio from "twilio"
import { guideDispatcherCall } from "./agent"
import { callReducer, dispatcherCalls, profiles, supportCases } from "./db"
import { ServiceError } from "./service"

function setting(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) throw new ServiceError(503, name + " is not configured")
  return value
}

function publicBase(): string {
  return setting("TWILIO_WEBHOOK_BASE_URL").replace(/\/$/, "")
}

export async function openDispatcherCall(caseId: number, profileId: number): Promise<{ id: string; token: string }> {
  const row = (await supportCases()).find(item => item.id === caseId)
  if (!row || row.status === "closed") throw new ServiceError(400, "Open support case required")
  const person = (await profiles()).find(item => item.id === profileId)
  if (!person || !/^\+[1-9]\d{1,14}$/.test(person.phone)) throw new ServiceError(400, "Dialable profile required")
  publicBase()
  const accountSid = setting("TWILIO_ACCOUNT_SID")
  const keySid = setting("TWILIO_API_KEY_SID")
  const keySecret = setting("TWILIO_API_KEY_SECRET")
  const appSid = setting("TWILIO_TWIML_APP_SID")
  setting("TWILIO_AUTH_TOKEN")
  setting("TWILIO_FROM_NUMBER")
  const id = randomUUID()
  await callReducer("openDispatcherCall", [id, caseId, profileId])
  const token = new twilio.jwt.AccessToken(accountSid, keySid, keySecret, { identity: "dispatcher", ttl: 900 })
  token.addGrant(new twilio.jwt.AccessToken.VoiceGrant({ outgoingApplicationSid: appSid }))
  return { id, token: token.toJwt() }
}

export function verifyTwilio(req: IncomingMessage, path: string, form: Record<string, string>): void {
  const signature = req.headers["x-twilio-signature"]
  const url = publicBase() + path
  if (typeof signature !== "string" || !twilio.validateRequest(setting("TWILIO_AUTH_TOKEN"), signature, url, form)
    || form.AccountSid !== setting("TWILIO_ACCOUNT_SID")) {
    throw new ServiceError(403, "Invalid Twilio signature")
  }
}

export async function connectDispatcherCall(id: string, callSid: string): Promise<string> {
  const row = (await dispatcherCalls()).find(item => item.id === id)
  const person = (await profiles()).find(item => item.id === row?.profile_id)
  if (!row || row.ended_at || !person) throw new ServiceError(404, "Dispatcher call unavailable")
  if ((await supportCases()).find(item => item.id === row.support_case_id)?.status === "closed") {
    await callReducer("finishDispatcherCall", [id, "canceled"])
    throw new ServiceError(409, "Support case is closed")
  }
  await callReducer("connectDispatcherCall", [id, callSid])
  const response = new twilio.twiml.VoiceResponse()
  response.start().transcription({ statusCallbackUrl: publicBase() + "/dispatcher-calls/" + id + "/transcript", track: "both_tracks" })
  response.dial({ callerId: setting("TWILIO_FROM_NUMBER"), action: publicBase() + "/dispatcher-calls/" + id + "/complete" })
    .number({ statusCallback: publicBase() + "/dispatcher-calls/" + id + "/status",
      statusCallbackEvent: ["ringing", "answered", "completed"] }, person.phone)
  return response.toString()
}

export async function updateDispatcherCallStatus(id: string, form: Record<string, string>): Promise<void> {
  const row = (await dispatcherCalls()).find(item => item.id === id)
  if (!row || row.call_sid !== form.ParentCallSid || row.ended_at) return
  if (form.CallStatus === "ringing") await callReducer("progressDispatcherCall", [id, row.call_sid, "ringing"])
  else if (form.CallStatus === "in-progress") await callReducer("progressDispatcherCall", [id, row.call_sid, "active"])
  else if (["completed", "busy", "no-answer", "failed", "canceled"].includes(form.CallStatus)) {
    await callReducer("finishDispatcherCall", [id, form.CallStatus])
  }
}

export async function finishDispatcherCall(id: string, status: string, callSid: string): Promise<string> {
  const row = (await dispatcherCalls()).find(item => item.id === id)
  if (!row || row.call_sid !== callSid) throw new ServiceError(404, "Dispatcher call unavailable")
  await callReducer("finishDispatcherCall", [id, status])
  return new twilio.twiml.VoiceResponse().toString()
}

export async function cancelUnconnectedDispatcherCall(id: string): Promise<void> {
  const row = (await dispatcherCalls()).find(item => item.id === id)
  if (!row) throw new ServiceError(404, "Dispatcher call not found")
  if (row.call_sid) throw new ServiceError(409, "Call has connected; hang up from the browser")
  await callReducer("finishDispatcherCall", [id, "canceled"])
}

export async function receiveDispatcherTranscript(id: string, form: Record<string, string>): Promise<void> {
  if (form.TranscriptionEvent !== "transcription-content" || form.Final !== "true") return
  const row = (await dispatcherCalls()).find(item => item.id === id)
  if (!row || row.call_sid !== form.CallSid) return
  let text = ""
  try { text = (JSON.parse(form.TranscriptionData ?? "{}") as { transcript?: string }).transcript ?? "" } catch { return }
  const speaker = form.Track === "outbound_track" ? "resident" : form.Track === "inbound_track" ? "dispatcher" : ""
  if (!speaker || !text.trim() || !form.TranscriptionSid || !form.SequenceId) return
  const key = [form.TranscriptionSid, form.Track, form.SequenceId].join(":")
  if ((JSON.parse(row.transcript) as { key: string }[]).some(line => line.key === key)) return
  await callReducer("appendDispatcherTranscript", [id, form.CallSid, key, speaker, text])
  const fresh = (await dispatcherCalls()).find(item => item.id === id)!
  const lines = JSON.parse(fresh.transcript) as { key: string; speaker: string; text: string }[]
  if (lines.at(-1)?.key !== key || fresh.ended_at || !process.env.ANTHROPIC_API_KEY) return
  const current = (await supportCases()).find(item => item.id === row.support_case_id)
  const person = (await profiles()).find(item => item.id === row.profile_id)
  if (!current) return
  void guideDispatcherCall({ case_goal: current.goal, case_brief: current.brief,
    person: person?.name ?? "Unknown", transcript: lines.slice(-20).map(({ speaker, text }) => ({ speaker, text })) })
    .then(result => {
      const guidance = [result.summary, result.suggestion ? "Ask: " + result.suggestion : ""].filter(Boolean).join("\n")
      return guidance ? callReducer("setDispatcherGuidance", [id, lines.length, guidance]) : undefined
    })
    .catch(error => console.error("dispatcher guidance: " + String(error)))
}
