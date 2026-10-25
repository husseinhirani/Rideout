import { commandId, object, dialablePhone, normalizePhone } from "../shared/information"
import { runInformationCommand } from "./information"
import { query, asString, asTimestamp, profiles } from "./db"
import { ServiceError } from "./service"

type DrillParticipant = { name: string; phone: string; location_id?: string }

async function drillConfiguration() {
  const configurations = await query("SELECT * FROM operator_command WHERE operation = 'configure_drill_participants'")
  const latest = configurations.sort((a, b) => Date.parse(asTimestamp(b.created_at)) - Date.parse(asTimestamp(a.created_at)))[0]
  const directory = await profiles()
  if (latest) {
    const { profile_ids } = JSON.parse(asString(latest.result_json)) as { profile_ids: number[] }
    const configured=JSON.parse(asString(latest.payload_json)) as {participants?: DrillParticipant[]; include_simulated?: boolean}
    return { saved: true, include_simulated: configured.include_simulated ?? true, participants: profile_ids.map((id,index) => {
      const person = directory.find(p => p.id === id)
      return { name: person?.name ?? "Missing participant", phone: person?.phone ?? "", ...(configured.participants?.[index]?.location_id ? {location_id:configured.participants[index].location_id} : {}) }
    }) }
  }
  const configuredPhone = process.env.WILDFIRE_DEMO_PHONE?.trim()
  const configuredName = process.env.WILDFIRE_DEMO_NAME?.trim()
  if (configuredPhone) return { saved: false, include_simulated: true, participants: [{ name: configuredName || "Demo participant", phone: normalizePhone(configuredPhone) }] }
  const previous = (await wildfireDrills()).sort((a, b) => Date.parse(b.started_at) - Date.parse(a.started_at))[0]
  return { saved: false, include_simulated: true, participants: (previous?.profile_ids ?? []).map(id => {
    const person = directory.find(p => p.id === id)
    return { name: person?.name ?? "Missing participant", phone: person?.phone ?? "" }
  }) }
}

export async function wildfireDemo() {
  const { participants, include_simulated } = await drillConfiguration()
  return { name: participants[0]?.name ?? "Demo participant", names: participants.map(p => p.name),
    count: participants.length, include_simulated, ready: participants.length > 0 && participants.every(p => dialablePhone(p.phone)) }
}

export async function wildfireDrills() {
  const rows = await query("SELECT * FROM operator_command WHERE operation = 'wildfire_drill'")
  return rows.map(row => {
    const result = JSON.parse(asString(row.result_json))
    return { case_id: result.support_case_id as number, profile_id: result.profile_id as number,
      profile_ids: (result.profile_ids ?? [result.profile_id]) as number[], started_at: asTimestamp(row.created_at) }
  })
}

/** Saves a private reusable roster. Configuring participants never places calls. */
export async function configureDrillParticipants(body: unknown, actor: string) {
  const input = { ...object(body, "request") }
  const previous = (await query("SELECT * FROM operator_command")).find(row => asString(row.command_id) === commandId(input.command_id))
  if (previous && asString(previous.operation) !== "configure_drill_participants") throw new ServiceError(409, "Command ID conflicts with another operation")
  const previousPayload = previous ? JSON.parse(asString(previous.payload_json)) as Record<string, unknown> : undefined
  if (input.include_simulated === undefined && (!previousPayload || previousPayload.include_simulated !== undefined)) input.include_simulated = true
  if (input.include_simulated !== undefined && typeof input.include_simulated !== "boolean") throw new ServiceError(400, "include_simulated must be boolean")
  if (input.participant_names !== undefined) {
    if (input.participants !== undefined) throw new ServiceError(400, "Choose participant_names or participants, not both")
    const names = input.participant_names
    if (!Array.isArray(names) || names.length < 1 || names.length > 10 || names.some(name => typeof name !== "string" || !name.trim()))
      throw new ServiceError(400, "Choose between 1 and 10 saved participant names")
    const normalizeName = (name: string) => name.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase()
    const normalized = (names as string[]).map(normalizeName)
    if (new Set(normalized).size !== normalized.length) throw new ServiceError(400, "Duplicate participant name")
    // Resolve an exact retry from its immutable receipt, even if the saved roster
    // has subsequently changed. The reducer still compares the entire payload.
    if (previousPayload && !Array.isArray(previousPayload.participant_names)) throw new ServiceError(409, "Command ID conflicts with another input")
    const configuration = previousPayload
      ? { saved: true, participants: previousPayload.participants as DrillParticipant[] }
      : await drillConfiguration()
    if (!configuration.saved) throw new ServiceError(400, "Configure a saved roster before selecting participant names")
    input.participants = normalized.map(name => {
      const matches = configuration.participants.filter(person => normalizeName(person.name) === name)
      if (matches.length !== 1) throw new ServiceError(400, matches.length ? "Participant name is ambiguous in the saved roster" : "Participant name was not found in the saved roster")
      return matches[0]
    })
  }
  return runInformationCommand("configureDrillParticipants", input, actor)
}

/** Only an authenticated operator click reaches this; no phone comes from the browser. */
export async function startWildfireDrill(body: unknown, actor: string) {
  const input = object(body, "request"), command_id = commandId(input.command_id)
  if (command_id.length > 150) throw new ServiceError(400, "Drill command ID is too long")
  // A retry must replay the original receipt, including its old optional-neighbor
  // flag and roster. New creation uses the saved choice; old cases stay intact.
  const previous = (await query("SELECT * FROM operator_command")).find(row => asString(row.command_id) === command_id)
  if (previous) {
    if (asString(previous.operation) !== "wildfire_drill") throw new ServiceError(409, "Command ID conflicts with another operation")
    return runInformationCommand("startWildfireDrill", { ...JSON.parse(asString(previous.payload_json)), command_id }, actor)
  }
  if (!process.env.ANTHROPIC_API_KEY?.trim()) throw new ServiceError(503, "Configure the coordinator model before starting an assistance drill.")
  const { participants, include_simulated } = await drillConfiguration()
  if (!participants.length || participants.some(p => !dialablePhone(p.phone))) throw new ServiceError(503, "Configure the saved drill participants before starting.")
  return runInformationCommand("startWildfireDrill", { command_id, participants, include_simulated }, actor)
}
