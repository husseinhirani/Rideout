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
  status: string
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
  helper_profile_id: number | null
  call_id: string | null
  status: string
}

export type AttemptRow = {
  id: number
  support_case_id: number
  profile_id: number
  outcome: string | null
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
    status: asString(row.status),
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
    helper_profile_id: row.helper_profile_id == null ? null : asId(row.helper_profile_id),
    call_id: row.call_id == null ? null : asString(row.call_id),
    status: asString(row.status),
  }))
}

export async function attempts(): Promise<AttemptRow[]> {
  return (await query("SELECT * FROM attempt")).map((row) => ({
    id: asId(row.id),
    support_case_id: asId(row.support_case_id),
    profile_id: asId(row.profile_id),
    outcome: row.outcome == null ? null : asString(row.outcome),
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

function asNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value
  throw new Error("SpacetimeDB returned a value that is not a number")
}
