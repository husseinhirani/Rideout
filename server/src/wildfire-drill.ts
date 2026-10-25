import { commandId, object, dialablePhone, normalizePhone } from "../shared/information"
import { runInformationCommand } from "./information"
import { ServiceError } from "./service"

export function wildfireDemo() {
  return { name: process.env.WILDFIRE_DEMO_NAME?.trim() || "Tony Nguyen", ready: dialablePhone(process.env.WILDFIRE_DEMO_PHONE?.trim() || "") }
}

/** Only an authenticated operator click reaches this; no phone comes from the browser. */
export async function startWildfireDrill(body: unknown, actor: string) {
  const input = object(body, "request"), command_id = commandId(input.command_id)
  if (command_id.length > 150) throw new ServiceError(400, "Drill command ID is too long")
  const demo = wildfireDemo()
  if (!demo.ready) throw new ServiceError(503, "Configure WILDFIRE_DEMO_PHONE on the backend before starting the drill.")
  return runInformationCommand("startWildfireDrill", {
    command_id, name: demo.name, phone: normalizePhone(process.env.WILDFIRE_DEMO_PHONE!),
  }, actor)
}
