import { commandId, object, dialablePhone, normalizePhone } from "../shared/information"
import { runInformationCommand } from "./information"
import { query, asString, asTimestamp, profiles } from "./db"
import { ServiceError } from "./service"

async function drillParticipant() {
  const configuredPhone = process.env.WILDFIRE_DEMO_PHONE?.trim()
  const configuredName = process.env.WILDFIRE_DEMO_NAME?.trim()
  if (configuredPhone) return { name: configuredName || "Demo participant", phone: normalizePhone(configuredPhone) }
  // Reuse only a participant selected by an earlier authorized drill, never an
  // arbitrary directory match or a hardcoded name/number.
  const previous = (await wildfireDrills()).sort((a, b) => Date.parse(b.started_at) - Date.parse(a.started_at))[0]
  const person = previous ? (await profiles()).find(p => p.id === previous.profile_id) : undefined
  return { name: configuredName || person?.name || "Demo participant", phone: person?.phone || "" }
}

export async function wildfireDemo() {
  const participant = await drillParticipant()
  return { name: participant.name, ready: dialablePhone(participant.phone) }
}

export async function wildfireDrills() {
  const rows = await query("SELECT * FROM operator_command WHERE operation = 'wildfire_drill'")
  return rows.map(row => {
    const result = JSON.parse(asString(row.result_json))
    return { case_id: result.support_case_id as number, profile_id: result.profile_id as number, started_at: asTimestamp(row.created_at) }
  })
}

/** Only an authenticated operator click reaches this; no phone comes from the browser. */
export async function startWildfireDrill(body: unknown, actor: string) {
  const input = object(body, "request"), command_id = commandId(input.command_id)
  if (command_id.length > 150) throw new ServiceError(400, "Drill command ID is too long")
  const demo = await drillParticipant()
  if (!dialablePhone(demo.phone)) throw new ServiceError(503, "No saved drill participant is available. Set WILDFIRE_DEMO_PHONE on the backend for the first drill.")
  return runInformationCommand("startWildfireDrill", {
    command_id, name: demo.name, phone: normalizePhone(demo.phone),
  }, actor)
}
