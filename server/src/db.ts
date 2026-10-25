export type ProfileRow = {
  id: number
  name: string
  phone: string
  lat: number
  lng: number
  contact_profile_ids: number[]
}

export type IncidentRow = {
  id: number
  type: string
  description: string
  area: { lat: number; lng: number; radius_m: number }
  brief: string
  status: string
  created_at: string
  ended_at: string | null
}

export type IncidentPersonRow = {
  id: number
  incident_id: number
  profile_id: number
  status: string
}

export type SupportCaseRow = {
  id: number
  incident_id: number
  victim_profile_id: number
  goal: string
  brief: string
  status: string
}

export type AttemptRow = {
  id: number
  support_case_id: number
  profile_id: number
  ask: string
  call_id: string | null
  outcome: string | null
  answer: string
  concern: string
  created_at: string
}

export type NoteRow = {
  id: number
  support_case_id: number
  attempt_id: number | null
  source: string
  text: string
  lat: number | null
  lng: number | null
  radius_m: number | null
  at: string
}

export type CaseProgressRow = {
  support_case_id: number
  helper_profile_ids: number[]
  input_revision: number
  evaluated_revision: number
  failure_count: number
  retry_at_ms: number | null
  blocked_reason: string
}

export type CaseIntakeRow = {
  support_case_id: number
  reporter_profile_id: number
  child_description: string
  last_seen_location_id: string
  last_seen_time: string
  reporter_name: string
  reporter_relationship: string
  reunion_confirmed: boolean
  confirmed_at: string | null
}

export type CaseInputRow = {
  event_key: string
  support_case_id: number
  reporter_profile_id: number
  kind: string
  payload: string
  received_at: string
}

export async function caseIntakes(): Promise<CaseIntakeRow[]> {
  return (await query("SELECT * FROM case_intake")).map(row => ({
    support_case_id: asId(row.support_case_id), reporter_profile_id: asId(row.reporter_profile_id),
    child_description: asString(row.child_description), last_seen_location_id: asString(row.last_seen_location_id),
    last_seen_time: asString(row.last_seen_time), reporter_name: asString(row.reporter_name),
    reporter_relationship: asString(row.reporter_relationship), reunion_confirmed: row.reunion_confirmed === true,
    confirmed_at: asOptionalTimestamp(row.confirmed_at),
  }))
}

export async function caseInputs(): Promise<CaseInputRow[]> {
  return (await query("SELECT * FROM case_input")).map(row => ({
    event_key: asString(row.event_key), support_case_id: asId(row.support_case_id),
    reporter_profile_id: asId(row.reporter_profile_id), kind: asString(row.kind),
    payload: asString(row.payload), received_at: asTimestamp(row.received_at),
  }))
}

export type IncomingRequestRow = {
  id: number
  provider_call_id: string
  from_phone: string
  direction: string
  text: string
  revision: number
  status: "pending" | "prepared" | "needs_clarification" | "recorded" | "needs_review" | "attached" | "rejected"
  decision_json: string
  reply: string
  support_case_id: number | null
  failure_count: number
  retry_at_ms: number
}

export async function incomingRequests(): Promise<IncomingRequestRow[]> {
  return (await query("SELECT * FROM incoming_request")).map(row => ({
    id: asId(row.id), provider_call_id: asString(row.provider_call_id),
    from_phone: asString(row.from_phone), direction: asString(row.direction), text: asString(row.text),
    revision: asId(row.revision), status: asString(row.status) as IncomingRequestRow["status"],
    decision_json: asString(row.decision_json), reply: asString(row.reply),
    support_case_id: optionalId(row.support_case_id), failure_count: asNumber(row.failure_count),
    retry_at_ms: asId(row.retry_at_ms),
  }))
}

export type AttemptProgressRow = {
  attempt_id: number
  support_case_id: number
  context: string
  transport: "queued" | "dispatching" | "active" | "ended" | "unknown" | "cancelled"
  claim_token: string
  dispatch_error: string
  claimed_at_ms: number | null
  report_received: boolean
  report_processed: boolean
  raw_concern: string
  report_received_at_ms: number | null
  accepted_at_ms: number | null
  review_consumed: boolean
}

export async function caseProgress(): Promise<CaseProgressRow[]> {
  return (await query("SELECT * FROM case_progress")).map(row => ({
    support_case_id: asId(row.support_case_id), helper_profile_ids: asIdList(row.helper_profile_ids),
    input_revision: asId(row.input_revision), evaluated_revision: asId(row.evaluated_revision),
    failure_count: asNumber(row.failure_count), retry_at_ms: optionalNumber(row.retry_at_ms),
    blocked_reason: asString(row.blocked_reason),
  }))
}

export async function attemptProgress(): Promise<AttemptProgressRow[]> {
  return (await query("SELECT * FROM attempt_progress")).map(row => ({
    attempt_id: asId(row.attempt_id), support_case_id: asId(row.support_case_id),
    context: asString(row.context), transport: asString(row.transport) as AttemptProgressRow["transport"],
    claim_token: asString(row.claim_token), claimed_at_ms: optionalNumber(row.claimed_at_ms),
    dispatch_error: optionalString(row.dispatch_error) ?? "",
    report_received: row.report_received === true, report_processed: row.report_processed === true,
    raw_concern: asString(row.raw_concern), report_received_at_ms: optionalNumber(row.report_received_at_ms),
    accepted_at_ms: optionalNumber(row.accepted_at_ms), review_consumed: row.review_consumed === true,
  }))
}

export async function callReducer(name: string, args: unknown[]): Promise<void> {
  const response = await spacetimeFetch("/call/" + encodeURIComponent(reducerName(name)), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(args),
  })
  if (!response.ok) {
    throw new Error(await failureText(response, name))
  }
}

export async function profiles(): Promise<ProfileRow[]> {
  return (await query("SELECT * FROM profile")).map((row) => ({
    id: asId(row.id),
    name: asString(row.name),
    phone: asString(row.phone),
    lat: asNumber(row.lat),
    lng: asNumber(row.lng),
    contact_profile_ids: asIdList(row.contact_profile_ids),
  }))
}

export async function incidents(): Promise<IncidentRow[]> {
  return (await query("SELECT * FROM incident")).map((row) => ({
    id: asId(row.id),
    type: asString(row.type),
    description: asString(row.description),
    area: asArea(row.area),
    brief: asString(row.brief),
    status: asString(row.status),
    created_at: asTimestamp(row.created_at),
    ended_at: asOptionalTimestamp(row.ended_at),
  }))
}

export async function incidentPeople(): Promise<IncidentPersonRow[]> {
  return (await query("SELECT * FROM incident_person")).map((row) => ({
    id: asId(row.id),
    incident_id: asId(row.incident_id),
    profile_id: asId(row.profile_id),
    status: asString(row.status),
  }))
}

export async function supportCases(): Promise<SupportCaseRow[]> {
  return (await query("SELECT * FROM support_case")).map((row) => ({
    id: asId(row.id),
    incident_id: asId(row.incident_id),
    victim_profile_id: asId(row.victim_profile_id),
    goal: asString(row.goal),
    brief: asString(row.brief),
    status: asString(row.status),
  }))
}

export async function attempts(): Promise<AttemptRow[]> {
  return (await query("SELECT * FROM attempt")).map((row) => ({
    id: asId(row.id),
    support_case_id: asId(row.support_case_id),
    profile_id: asId(row.profile_id),
    ask: asString(row.ask),
    call_id: optionalString(row.call_id),
    outcome: optionalString(row.outcome),
    answer: asString(row.answer),
    concern: asString(row.concern),
    created_at: asTimestamp(row.created_at),
  }))
}

export async function notes(): Promise<NoteRow[]> {
  return (await query("SELECT * FROM note")).map((row) => ({
    id: asId(row.id),
    support_case_id: asId(row.support_case_id),
    attempt_id: optionalId(row.attempt_id),
    source: asString(row.source),
    text: asString(row.text),
    lat: optionalNumber(row.lat),
    lng: optionalNumber(row.lng),
    radius_m: optionalNumber(row.radius_m),
    at: asTimestamp(row.at),
  }))
}

export function decodeSql(payload: unknown): Record<string, unknown>[] {
  if (!Array.isArray(payload) || payload.length === 0) return []
  const statement = payload[0]
  if (typeof statement !== "object" || statement === null) return []
  const schema = (statement as { schema?: { elements?: { name?: unknown }[] } }).schema
  const names = (schema?.elements ?? []).map((element) => fieldName(element.name))
  const rows = (statement as { rows?: unknown[] }).rows ?? []
  return rows.map((row) => {
    if (Array.isArray(row)) {
      const record: Record<string, unknown> = {}
      names.forEach((name, index) => {
        if (name.length > 0) record[name] = decodeValue(row[index])
      })
      return record
    }
    if (typeof row === "object" && row !== null) {
      return decodeValue(row) as Record<string, unknown>
    }
    throw new Error("SpacetimeDB returned a row that is not an object")
  })
}

async function query(sql: string): Promise<Record<string, unknown>[]> {
  const response = await spacetimeFetch("/sql", {
    method: "POST",
    headers: { "Content-Type": "text/plain" },
    body: sql,
  })
  if (!response.ok) {
    throw new Error(await failureText(response, "sql"))
  }
  const payload = await response.json() as unknown
  return decodeSql(payload)
}

async function spacetimeFetch(path: string, init: RequestInit): Promise<Response> {
  const base = (process.env.SPACETIMEDB_URL ?? "http://127.0.0.1:3000").replace(/\/$/, "")
  const database = process.env.SPACETIMEDB_DATABASE ?? "rideout"
  try {
    return await fetch(base + "/v1/database/" + encodeURIComponent(database) + path, init)
  } catch (error) {
    const reason = error instanceof Error ? error.message : "request failed"
    throw new Error("SpacetimeDB could not be reached: " + reason)
  }
}

async function failureText(response: Response, name: string): Promise<string> {
  const text = (await response.text()).trim()
  return text.length > 0 ? text : "SpacetimeDB " + name + " failed (" + String(response.status) + ")"
}

function reducerName(name: string): string {
  return name.replace(/[A-Z]/g, (letter) => "_" + letter.toLowerCase())
}

function fieldName(name: unknown): string {
  if (typeof name === "string") return name
  if (typeof name === "object" && name !== null && "some" in name) {
    const some = (name as { some?: unknown }).some
    if (typeof some === "string") return some
  }
  return ""
}

function decodeValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => decodeValue(item))
  if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>
    const keys = Object.keys(record)
    if (keys.length === 1 && keys[0] === "some") return decodeValue(record.some)
    if (keys.length === 1 && keys[0] === "none") return null
    const decoded: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(record)) decoded[key] = decodeValue(item)
    return decoded
  }
  return value
}

// An option arrives either already decoded, as the {some}/{none} object form,
// or raw as a tagged array [tag, value] where tag 1 is none. Only a field the
// schema declares optional may be read this way: a plain two-number array is a
// list, not a sum.
function asOption(value: unknown): unknown {
  if (Array.isArray(value) && value.length === 2 && typeof value[0] === "number") {
    return value[0] === 1 ? null : value[1]
  }
  return value
}

function optionalString(value: unknown): string | null {
  const inner = asOption(value)
  return inner == null ? null : asString(inner)
}

function optionalNumber(value: unknown): number | null {
  const inner = asOption(value)
  return inner == null ? null : asNumber(inner)
}

function optionalId(value: unknown): number | null {
  const inner = asOption(value)
  return inner == null ? null : asId(inner)
}

function asId(value: unknown): number {
  if (typeof value === "bigint") {
    const id = Number(value)
    if (Number.isSafeInteger(id)) return id
  }
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return value
  if (typeof value === "string" && /^\d+$/.test(value)) {
    const id = Number(value)
    if (Number.isSafeInteger(id)) return id
  }
  throw new Error("SpacetimeDB returned an id that is not an integer")
}

function asIdList(value: unknown): number[] {
  if (!Array.isArray(value)) throw new Error("SpacetimeDB returned contact_profile_ids that is not a list")
  return value.map((item) => asId(item))
}

function asString(value: unknown): string {
  if (typeof value === "string") return value
  throw new Error("SpacetimeDB returned a value that is not a string")
}

function asArea(value: unknown): { lat: number; lng: number; radius_m: number } {
  if (Array.isArray(value) && value.length === 3) {
    return { lat: asNumber(value[0]), lng: asNumber(value[1]), radius_m: asNumber(value[2]) }
  }
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    const area = value as Record<string, unknown>
    return { lat: asNumber(area.lat), lng: asNumber(area.lng), radius_m: asNumber(area.radius_m) }
  }
  throw new Error("SpacetimeDB returned an area that is not lat, lng, radius_m")
}

function asTimestamp(value: unknown): string {
  return new Date(timestampMicros(value) / 1000).toISOString()
}

function asOptionalTimestamp(value: unknown): string | null {
  const inner = asOption(value)
  return inner == null ? null : asTimestamp(inner)
}

function timestampMicros(value: unknown): number {
  if (Array.isArray(value)) return asNumber(value[0])
  if (typeof value === "object" && value !== null && "__timestamp_micros_since_unix_epoch__" in value) {
    return asNumber((value as Record<string, unknown>).__timestamp_micros_since_unix_epoch__)
  }
  return asNumber(value)
}

function asNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value
  throw new Error("SpacetimeDB returned a value that is not a number")
}

// Shared SQL decoding for the additive information-case read model.
export { query, asId, asString, asArea, asTimestamp, asOption, optionalNumber }
