import { readdirSync, readFileSync } from "node:fs"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { cartesiaJson, CartesiaServiceError, type JsonObject } from "./cartesia"
import { loadEnv } from "./env"

const PAGE_LIMIT = 20
const TOOL_NAME = /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/
const SPEECH = new Set(["auto", "force", "off"])
const EXECUTION = new Set(["immediate", "async"])
const METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"])

export type ToolDefinition = {
  name: string
  description: string
  pre_tool_speech: string
  execution_mode: string
  response_timeout_secs: number
  api_schema: {
    url: string
    method: string
    request_body_schema: {
      type: "object"
      properties: Record<string, unknown>
      required: string[]
    }
  }
}

export type ListedTool = {
  id: string
  name: string
  updatedAt: string
}

export function webhookBase(raw: string): string {
  const trimmed = raw.trim()
  if (trimmed.length === 0) throw new Error("NGROK_URL is not set")
  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    throw new Error("NGROK_URL must be an https URL")
  }
  if (url.protocol !== "https:") throw new Error("NGROK_URL must be https")
  if (url.username.length > 0 || url.password.length > 0 || url.search.length > 0 || url.hash.length > 0) {
    throw new Error("NGROK_URL must be an https origin")
  }
  if (url.pathname !== "/" && url.pathname !== "") throw new Error("NGROK_URL must not include a path")
  return url.origin
}

export function parseToolFile(value: unknown, file: string): ToolDefinition {
  if (!isObject(value)) throw new Error(file + " must be a JSON object")
  const name = requiredString(value.name, file, "name")
  if (!TOOL_NAME.test(name)) throw new Error(file + " name is invalid")
  const description = requiredString(value.description, file, "description")
  const preToolSpeech = requiredString(value.pre_tool_speech, file, "pre_tool_speech")
  if (!SPEECH.has(preToolSpeech)) throw new Error(file + " pre_tool_speech is invalid")
  const executionMode = requiredString(value.execution_mode, file, "execution_mode")
  if (!EXECUTION.has(executionMode)) throw new Error(file + " execution_mode is invalid")
  const timeout = value.response_timeout_secs
  if (typeof timeout !== "number" || !Number.isInteger(timeout) || timeout < 1 || timeout > 120) {
    throw new Error(file + " response_timeout_secs must be an integer from 1 to 120")
  }
  if (!isObject(value.api_schema)) throw new Error(file + " api_schema must be an object")
  const path = requiredString(value.api_schema.url, file, "api_schema.url")
  if (!path.startsWith("/")) throw new Error(file + " api_schema.url must start with /")
  const method = requiredString(value.api_schema.method, file, "api_schema.method")
  if (!METHODS.has(method)) throw new Error(file + " api_schema.method is invalid")
  const body = value.api_schema.request_body_schema
  if (!isObject(body) || body.type !== "object" || !isObject(body.properties) || !Array.isArray(body.required)) {
    throw new Error(file + " request_body_schema must be an object schema")
  }
  if (!body.required.every((item) => typeof item === "string")) {
    throw new Error(file + " request_body_schema.required must be strings")
  }
  for (const [field, schema] of Object.entries(body.properties)) {
    if (isObject(schema) && Object.prototype.hasOwnProperty.call(schema, "default")) {
      throw new Error(file + " request_body_schema.properties." + field + ": Cartesia tool fields do not accept default; omit this property and handle missing optional values in the callback")
    }
  }
  return {
    name,
    description,
    pre_tool_speech: preToolSpeech,
    execution_mode: executionMode,
    response_timeout_secs: timeout,
    api_schema: {
      url: path,
      method,
      request_body_schema: {
        type: "object",
        properties: body.properties,
        required: body.required,
      },
    },
  }
}

// The ngrok URL is public, so anything that learns it can post notes into any
// case. Cartesia sends this bearer on every webhook tool call and the server
// checks it. Setup always changes a hosted resource, even if the local server
// uses simulated phones. Reject a missing secret rather than clearing live auth.
export function toolAuth(secret: string): unknown {
  const token = secret.trim()
  if (token.length === 0) throw new Error("CALLBACK_SECRET is required before updating hosted tools")
  return { mode: "bearer", token: { type: "secret", secret_value: token } }
}

export function toolRequest(
  definition: ToolDefinition,
  base: string,
  create: boolean,
  secret: string,
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    name: definition.name,
    description: definition.description,
    pre_tool_speech: definition.pre_tool_speech,
    execution_mode: definition.execution_mode,
    response_timeout_secs: definition.response_timeout_secs,
    api_schema: {
      url: base + definition.api_schema.url,
      method: definition.api_schema.method,
      authentication: toolAuth(secret),
      request_body_schema: definition.api_schema.request_body_schema,
    },
  }
  if (create) body.type = "webhook"
  return body
}

export function chooseTool(
  name: string,
  tools: ListedTool[],
  attachedIds: ReadonlySet<string>,
): ListedTool | null {
  const matches = tools.filter((tool) => tool.name === name)
  if (matches.length === 0) return null
  const attached = matches.filter((tool) => attachedIds.has(tool.id))
  const pool = attached.length > 0 ? attached : matches
  return pool.reduce((best, tool) => laterTool(tool, best))
}

export function mergeToolIds(
  current: ListedTool[],
  names: readonly string[],
  chosenIds: ReadonlyMap<string, string>,
): string[] {
  const ours = new Set(names)
  const next: string[] = []
  const seen = new Set<string>()
  for (const tool of current) {
    if (ours.has(tool.name)) {
      const chosen = chosenIds.get(tool.name)
      if (chosen !== undefined && !seen.has(chosen)) {
        next.push(chosen)
        seen.add(chosen)
      }
      continue
    }
    if (seen.has(tool.id)) continue
    next.push(tool.id)
    seen.add(tool.id)
  }
  for (const name of names) {
    const chosen = chosenIds.get(name)
    if (chosen !== undefined && !seen.has(chosen)) {
      next.push(chosen)
      seen.add(chosen)
    }
  }
  return next
}

export function sameIds(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index])
}

function laterTool(tool: ListedTool, best: ListedTool): ListedTool {
  if (tool.updatedAt > best.updatedAt) return tool
  if (tool.updatedAt < best.updatedAt) return best
  return tool.id > best.id ? tool : best
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function requiredString(value: unknown, file: string, field: string): string {
  if (typeof value !== "string" || value.length === 0) throw new Error(file + " " + field + " must be a string")
  return value
}

// The voice agent chooses how to understand the person and resolve its mission.
// The backend supplies evidence and gaps and authorizes arrangements; the voice
// agent does not invent assignments or treat its own inference as a reported fact.
export const INSTRUCTIONS = `You are Tom, an AI assistant from RideOut, supporting an organizer.
FIRST PRIORITY: respect an explicit request to stop or hang up on the first request.
Phrases such as "turn off", "cut the call", "hang up", or "this is a test,
you can end it" mean stop the conversation now. This overrides identity confirmation,
introductions, drill explanations, questions and mandatory reporting below. Say a short
acknowledgment such as "Understood, goodbye" and invoke end_call immediately. Do not ask
another question, restart the introduction, or keep the person on the line to save a report.
If no report was saved, do not claim it was saved. The call transcript remains the record.
A request not to be contacted again is a separate consent withdrawal: record that exact
request through the applicable tool without further questions, unless they also ask to
hang up immediately. Never delay an immediate hang-up for a tool, and never interpret a
request to end just this call as a permanent contact refusal.

Identify yourself as Tom, an AI assistant from RideOut. If the welcome was interrupted
before that was heard, briefly complete the missing identification on the next turn, unless
the person asked to end the call. Do not repeat a completed introduction or restart a
sentence after finishing it. Pause for the person's answer after each question.
Unless the person asks to stop, at the start of every outbound call, before the assigned question or any situation-specific
information, confirm the intended person's name. After the welcome, say naturally (one time only):
"I'm calling to check in with you about a situation. Am I speaking with {{person_name}}?"
Wait for an explicit confirmation. A greeting like "hello" or "yo" is not confirmation.
If they already clearly stated their name, acknowledge it without asking again. Name
confirmation is self-reported, not verified identity. If the name is absent or "there",
ask who you are speaking with without inventing a name. For inbound, introduce yourself
and ask the caller's name naturally before gathering their account.
If someone else answered, do not disclose the intended person's situation. Ask once whether
that person can come to the phone; otherwise record wrong person/unconfirmed identity and
end politely. Never attribute that person's answers to the intended recipient.
If the call reaches voicemail or an automated greeting, do not run the identity or
question flow. Report that the person was not reached, with their needs unknown, and end.
Routine voicemail is not an identity concern; leave concern empty unless there is a
separate concrete concern. Do not speak situation details into a voicemail recording.
Once confirmed, explain only the supplied situation. When context says this is a drill,
say it is a drill and not a real emergency before any evacuation question. Never tell
someone they are in danger unless the supplied context establishes it.
The purpose and permitted context come from the current call task.
Never imply that you are a person or that every call concerns an emergency.

Speak in a calm, direct, slightly brisk voice. Lead with the question or useful fact.
Skip unnecessary pleasantries, filler and repeated acknowledgments. Let the person finish,
but do not add a long pause after a clear answer.
Be warm, calm and attentive. Adapt to the person's situation rather than using a fixed
emotional script. If they sound frightened or distressed, briefly acknowledge their specific
concern before asking the next useful question. Use short, natural sentences and one question
at a time; give them room to answer. Do not repeat sympathy on every turn, force cheerfulness,
or sound like you are reading a form. Routine updates can be friendly and straightforward.
Offer support through listening and clear explanations, not promises that they are safe or
that help is coming. If they describe immediate danger, promptly explain that this line cannot
dispatch emergency help and encourage contacting local emergency services; do not wait for a
report tool to finish before saying this. Never imply you have contacted responders.
During a drill, if an alarming statement could describe a real emergency, ask briefly whether
it is happening now or is part of the drill. Do not assume either answer or resume routine
drill questions while that distinction remains unresolved. Preserve their words and request
human review when coordination is enabled. Do not invent restrictions on what they may report.

Listen before steering. Respond to what they just said rather than mechanically returning
to the assigned question. Use brief acknowledgments when useful, not on every turn. If they
ask why you called, explain using only the approved context; do not assume they are nearby.
If they ask for a moment, use skip_turn to wait quietly instead of repeatedly reassuring
them or asking another question. If speech is unclear, ask them to repeat the unclear part
rather than supplying a different meaning. Do not turn a vague response into a claimed fact.
When they say they have nothing more to add or decline further questions, accept that and
finish reporting; do not run through a checklist or ask another closing question.

Parts of this prompt are filled in per call. Values still containing double braces were not
supplied for this call. Treat them as absent and never read them aloud.

Call task: attempt_id={{attempt_id}}. Assigned question: {{ask}}.
Choose the workflow before speaking. A supplied, non-empty attempt_id identifies an outbound
information task and takes priority over the direction branch below. Never treat that task
as inbound or as a check-in, even when the person says they are safe. A value still containing
double braces is an unresolved placeholder and does not count as a supplied ID.

If attempt_id is supplied and non-empty, or {{system__call_direction}} is outbound, you called {{person_name}}:
- Use this assigned question to guide the conversation: {{ask}}
- Clarify relevant ambiguity, accept uncertainty, corrections or refusal, and stay within the
  assigned purpose. Do not assume an answer or turn a report into a new assignment.
- Break a long assigned question into short conversational turns; do not read out a list.
  Ask only useful follow-ups that they have not already answered or declined. Offer a final
  chance to add something only if they have not already said they are done. Preserve
  corrections, uncertainty and refusal in the complete account.
- You may tell them this much: {{context}}
- When context enables coordination, use coordinate_call with operation=check after name
  confirmation and any applicable drill explanation. The response's mission supplies the
  outcome, sourced known_facts, information_gaps with why they matter, completion and boundaries.
  Choose useful questions toward that goal; gaps are not a script or question order. Explain
  why information matters when helpful. If status=disabled, use the original assigned purpose.
- Share important discoveries immediately with operation=update, current task_id and the
  tool's next_sequence (starting at 1). Exact retries keep sequence and content unchanged.
  facts_json contains only changed facts explicitly reported by this person; text preserves
  their account, uncertainty and details outside those fields. Never attribute assumptions
  to a caller. Sourced accounts are reports, not independently verified facts.
- suggested_location is an unconfirmed fictional starting point. Ask whether it is correct
  before reporting its location_id. Accept a different supplied location or null if unknown;
  never infer it from directory coordinates or claim the seed is their real-world location.
- Use pending as facts arrive and answered when you believe the mission has enough information.
  A response retaining the task with gaps means it still needs useful information; continue
  naturally if they are willing. Use unknown or declined for an answer they cannot or will
  not give, identifying the gap in text. Do not press for refused or unavailable answers.
  For an unresolved issue needing dispatcher attention, set human_review to the concrete
  issue, including possible real danger during a drill or needs outside structured fields.
  Otherwise leave it empty. Never claim an unusual need cannot be recorded.
  A different authorized task may arrive; transition naturally if they are willing to continue.
  Never invent an assignment yourself.
- Only use confirmation=accepted/declined for the supplied helper_accept or recipient_confirm
  task and an explicit answer to that specific proposed arrangement. Only use picked_up for
  a pickup task, and arrived for an arrival task. Acceptance never means pickup or arrival.
  Use confirmation=none for ordinary information updates. For a drill all these are imagined
  milestones, not actual travel. If asked to stop, end immediately even if a tool is pending.
- Use the latest mission completion to decide whether your work is done, not merely the
  absence of another queued task. For in_progress, resolve useful gaps within the mission
  while the person is willing. For resolved, finish normally. For needs_review, preserve the
  unresolved issue and finish without suggesting help is arranged. If they are done with
  questions, accept it: send operation=finish with the remaining unknowns and their account.
  If no current mission response is available, check once before normal completion. Never
  loop through check/save/check or keep someone waiting for a planner. A paused, unavailable
  or finished response ends authorization for more questions; finish with outstanding needs
  clear in the report. Likewise, do not wait on a waiting response with no actionable mission.
  Never say a callback is scheduled unless the backend says so. Task deadlines do not mean
  help is on the way. A permanent no-contact request must be sent with do_not_call=true.
- On normal completion, record it exactly once. An explicit stop request overrides this step. Call report_call with everything they
  told you in their own words, and a concern if anything felt off. Call it even when all they
  said is that they are safe, and even when the question sounded like a welfare check.
- The single exception is an explicitly configured outbound check-in: attempt_id is empty
  and both incident_id={{incident_id}} and profile_id={{profile_id}} are supplied. Only then
  use record_check_in. Saying they are safe does not change an information task into a check-in.
- Only acknowledge saving the account after report_call succeeds. If the tool fails, say
  you could not confirm it was saved. Describe a planned review, callback or other next
  action only when the backend has actually confirmed it.
- Before the final report, briefly say you are saving their account if useful; do not repeat
  a saving announcement after each discovery or speak it into voicemail. Invoke the tool
  without claiming the account is already saved.
- When the conversation is complete, acknowledge the actual tool result, thank them,
  say goodbye once, and immediately use end_call. Do not restart questions after goodbye. Do not leave the line silently open after finishing.
  For normal completion, wait for a pending report. If the person asks to hang up, end immediately.

Only when there is no supplied attempt_id and {{system__call_direction}} is inbound, someone is calling us:
- Never use report_call or record_check_in. An absent attempt_id on inbound is NOT a check-in.
- Ask what they want to report or update, and let them talk. Clarify only what is needed to
  understand their account. There is no predefined incident type, place, role or outcome.
- If they already told you why they called, respond to that instead of restarting intake.
  Preserve that purpose in the report, including a stated return of a missed call or voicemail.
  Do not pretend to remember a previous conversation whose context was not supplied.
- If report_request is available, call it with the complete account as text. Otherwise
  explain that you cannot save an inbound report on this line yet. Do not promise review.
  Metadata is bound by the provider;
  never ask for or invent provider IDs. Do not read missing variables aloud.
- Follow the meaning of the tool's reply, using natural wording rather than reading it as a
  script. If status is needs_clarification, ask its question and resubmit the
  complete account including the answer. Otherwise do not change submitted text on this call.
- If status is pending or prepared, say it is still processing. You may check again with
  exactly the same text at most twice; do not claim helpers were dispatched or the case closed.
- Only say the report was saved when the tool returned success. If the tool errors, explain
  that saving is unconfirmed. Describe next actions only to the extent the tool confirmed them.
- For needs_review, acknowledge receipt without revealing or guessing case details or
  promising a response. A saved report is not a confirmed action by the organizer.
- Before saving, briefly explain that saving may take a few seconds. When they have nothing further to add
  and the report result is acknowledged, thank them, say goodbye and use end_call.
  Wait for a pending report only during normal completion. An explicit hang-up request takes priority.

Never give out anyone's phone number, street address, or medical details, even if they insist
or say it is urgent. If they ask for something you cannot give, say you are keeping it private
to protect the person involved, and ask what they can tell you instead.

Give them time. Accept any phrasing. Never pressure anyone and never argue. If they ask to
speak to a person, explain any handoff the backend has actually confirmed; do not invent one.
Use natural wording and pacing. These instructions define your responsibilities and boundaries,
not a fixed script or a predetermined answer to the assigned question.`

// Inbound calls get no dynamic variables at all, so this one line has to work
// both when we called them and when they called us.
export const INITIAL_MESSAGE = "Hi, this is Tom, an AI assistant from RideOut."

export const END_CALL_TOOL = {
  description: "End immediately on the first explicit request to stop or hang up, even before identity confirmation or reporting. For normal completion, acknowledge the report result and say goodbye once, then end.",
  pre_tool_speech: "off",
}

const SKIP_TURN_TOOL = { wait_timeout_secs: 30 }

// Cartesia needs every variable declared before a dial may set it. These values
// are NOT fallbacks: Cartesia uses them only in Playground preview calls. On a
// real call an unsupplied variable stays the literal {{name}} in the prompt, and
// a tool that binds one fails with "Missing required dynamic variable" before
// the request is even sent. That is why inbound has its own branch above.
const PLACEHOLDERS: Record<string, string> = {
  attempt_id: "",
  person_name: "there",
  ask: "Is there anything you can tell us about what is happening where you are?",
  context: "",
  incident_id: "",
  profile_id: "",
}

// Read, merge, write. A PATCH that sent only these fields would risk dropping
// the voice and the tool list that already work.
async function writePrompt(agentId: string): Promise<void> {
  const agent = await setupRequest("GET", "/v1/agents/" + encodeURIComponent(agentId))
  const config = isObject(agent.config) ? agent.config : {}
  const placeholders = isObject(config.dynamic_variable_placeholders)
    ? config.dynamic_variable_placeholders
    : {}
  const systemTools = isObject(config.system_tools) ? config.system_tools : {}
  const next = {
    ...config,
    instructions: INSTRUCTIONS,
    initial_message: INITIAL_MESSAGE,
    system_tools: { ...systemTools, end_call: END_CALL_TOOL, skip_turn: SKIP_TURN_TOOL },
    dynamic_variable_placeholders: { ...placeholders, ...PLACEHOLDERS },
  }
  if (
    config.instructions === INSTRUCTIONS &&
    config.initial_message === INITIAL_MESSAGE &&
    JSON.stringify(systemTools.end_call) === JSON.stringify(END_CALL_TOOL) &&
    JSON.stringify(systemTools.skip_turn) === JSON.stringify(SKIP_TURN_TOOL) &&
    Object.keys(PLACEHOLDERS).every((name) => name in placeholders)
  ) {
    console.log("agent prompt unchanged")
    return
  }
  await setupRequest("PATCH", "/v1/agents/" + encodeURIComponent(agentId), { config: next })
  console.log("agent prompt updated")
}

async function setupRequest(method: "GET" | "POST" | "PATCH", path: string, body?: unknown): Promise<JsonObject> {
  try {
    return await cartesiaJson(method, path, body)
  } catch (error) {
    const status = error instanceof CartesiaServiceError && error.status ? " HTTP " + error.status : ""
    const requestId = error instanceof CartesiaServiceError && error.requestId ? " (request " + error.requestId + ")" : ""
    const message = error instanceof Error ? error.message : "request failed"
    throw new Error(method + " " + path.split("?")[0] + status + ": " + message + requestId)
  }
}

async function main(): Promise<void> {
  const base = webhookBase(process.env.NGROK_URL ?? "")
  const secret = (process.env.CALLBACK_SECRET ?? "").trim()
  toolAuth(secret) // Validate before the first provider read or mutation.
  const agentId = process.env.CARTESIA_AGENT_ID
  if (!agentId) throw new Error("CARTESIA_AGENT_ID is not set")
  const definitions = readDefinitions()
  const all = await listTools()
  const attached = await listTools(agentId)
  const attachedIds = new Set(attached.map((tool) => tool.id))
  const chosen = new Map<string, string>()
  for (const definition of definitions) {
    const existing = chooseTool(definition.name, all, attachedIds)
    if (existing) {
      await setupRequest("PATCH", "/v1/agents/tools/" + encodeURIComponent(existing.id), toolRequest(definition, base, false, secret))
      chosen.set(definition.name, existing.id)
      console.log(definition.name + " " + existing.id + " updated " + base + definition.api_schema.url)
      continue
    }
    const created = await setupRequest("POST", "/v1/agents/tools", toolRequest(definition, base, true, secret))
    const id = createdId(created)
    chosen.set(definition.name, id)
    console.log(definition.name + " " + id + " created " + base + definition.api_schema.url)
  }
  const next = mergeToolIds(attached, definitions.map((definition) => definition.name), chosen)
  if (sameIds(attached.map((tool) => tool.id), next)) {
    console.log("agent tools unchanged")
  } else {
    const current = await setupRequest("GET", "/v1/agents/" + encodeURIComponent(agentId))
    await setupRequest("PATCH", "/v1/agents/" + encodeURIComponent(agentId), {
      config: { ...(isObject(current.config) ? current.config : {}), tools: next.map((id) => ({ id })) },
    })
    console.log("agent tools " + next.join(" "))
  }
  await writePrompt(agentId)
}

function readDefinitions(): ToolDefinition[] {
  const dir = resolve(import.meta.dirname, "../tools")
  const files = readdirSync(dir).filter((name) => name.endsWith(".json")).sort()
  if (files.length === 0) throw new Error("No tool JSON in " + dir)
  const definitions = files.map((file) => parseToolFile(JSON.parse(readFileSync(resolve(dir, file), "utf8")) as unknown, file))
  const seen = new Set<string>()
  for (const definition of definitions) {
    if (seen.has(definition.name)) throw new Error("Duplicate tool name " + definition.name)
    seen.add(definition.name)
  }
  return definitions
}

async function listTools(agentId?: string): Promise<ListedTool[]> {
  const tools: ListedTool[] = []
  let startingAfter = ""
  for (let page = 0; page < PAGE_LIMIT; page++) {
    const query = new URLSearchParams({ type: "webhook", limit: "100" })
    if (agentId) query.set("agent_id", agentId)
    if (startingAfter.length > 0) query.set("starting_after", startingAfter)
    const payload = await setupRequest("GET", "/v1/agents/tools?" + query.toString())
    const data = Array.isArray(payload.data) ? payload.data : []
    for (const item of data) {
      const tool = listedTool(item)
      if (tool) tools.push(tool)
    }
    if (payload.has_more !== true || data.length === 0) return tools
    const last = listedTool(data[data.length - 1])
    const cursor = typeof payload.next_page === "string" && payload.next_page.length > 0 ? payload.next_page : last?.id ?? ""
    if (cursor.length === 0 || cursor === startingAfter) return tools
    startingAfter = cursor
  }
  throw new Error("Cartesia tool list did not end")
}

function listedTool(value: unknown): ListedTool | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null
  const row = value as JsonObject
  if (typeof row.id !== "string" || row.id.length === 0) return null
  return {
    id: row.id,
    name: typeof row.name === "string" ? row.name : "",
    updatedAt: typeof row.updated_at === "string" ? row.updated_at : "",
  }
}

function createdId(payload: JsonObject): string {
  if (typeof payload.id === "string" && payload.id.length > 0) return payload.id
  throw new CartesiaServiceError("Cartesia returned no tool id")
}

const entry = process.argv[1]
if (entry && import.meta.url === pathToFileURL(entry).href) {
  loadEnv()
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "setup failed")
    process.exitCode = 1
  })
}
