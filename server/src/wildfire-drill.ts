import { commandId, object, dialablePhone, normalizePhone } from "../shared/information"
import { runInformationCommand } from "./information"
import { query, asString, asTimestamp, profiles } from "./db"
import { ServiceError } from "./service"

async function drillParticipants() {
  const configurations = await query("SELECT * FROM operator_command WHERE operation = 'configure_drill_participants'")
  const latest = configurations.sort((a, b) => Date.parse(asTimestamp(b.created_at)) - Date.parse(asTimestamp(a.created_at)))[0]
  const directory = await profiles()
  if (latest) {
    const { profile_ids } = JSON.parse(asString(latest.result_json)) as { profile_ids: number[] }
    const configured=JSON.parse(asString(latest.payload_json)) as {participants?:{name:string,phone:string,location_id?:string}[]}
    return profile_ids.map((id,index) => {
      const person = directory.find(p => p.id === id)
      return { name: person?.name ?? "Missing participant", phone: person?.phone ?? "", ...(configured.participants?.[index]?.location_id ? {location_id:configured.participants[index].location_id} : {}) }
    })
  }
  const configuredPhone = process.env.WILDFIRE_DEMO_PHONE?.trim()
  const configuredName = process.env.WILDFIRE_DEMO_NAME?.trim()
  if (configuredPhone) return [{ name: configuredName || "Demo participant", phone: normalizePhone(configuredPhone) }]
  const previous = (await wildfireDrills()).sort((a, b) => Date.parse(b.started_at) - Date.parse(a.started_at))[0]
  return (previous?.profile_ids ?? []).map(id => {
    const person = directory.find(p => p.id === id)
    return { name: person?.name ?? "Missing participant", phone: person?.phone ?? "" }
  })
}

export async function wildfireDemo() {
  const participants = await drillParticipants()
  return { name: participants[0]?.name ?? "Demo participant", names: participants.map(p => p.name),
    count: participants.length, ready: participants.length > 0 && participants.every(p => dialablePhone(p.phone)) }
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
  const input = object(body, "request")
  return runInformationCommand("configureDrillParticipants", input, actor)
}

/** Only an authenticated operator click reaches this; no phone comes from the browser. */
export async function startWildfireDrill(body: unknown, actor: string) {
  const input = object(body, "request"), command_id = commandId(input.command_id)
  if (command_id.length > 150) throw new ServiceError(400, "Drill command ID is too long")
  // A retry must replay the original receipt, including its old optional-neighbor
  // flag and roster. New creation always includes neighbors; old cases stay intact.
  const previous = (await query("SELECT * FROM operator_command")).find(row => asString(row.command_id) === command_id)
  if (previous) {
    if (asString(previous.operation) !== "wildfire_drill") throw new ServiceError(409, "Command ID conflicts with another operation")
    return runInformationCommand("startWildfireDrill", { ...JSON.parse(asString(previous.payload_json)), command_id }, actor)
  }
  if (!process.env.ANTHROPIC_API_KEY?.trim()) throw new ServiceError(503, "Configure the coordinator model before starting an assistance drill.")
  const participants = await drillParticipants()
  if (!participants.length || participants.some(p => !dialablePhone(p.phone))) throw new ServiceError(503, "Configure the saved drill participants before starting.")
  return runInformationCommand("startWildfireDrill", { command_id, participants, include_simulated: true }, actor)
}
