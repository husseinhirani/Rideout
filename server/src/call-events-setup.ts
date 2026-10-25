import type { cartesiaJson as CartesiaRequest } from "./cartesia"
import { ServiceError } from "./service"

let setup: Promise<void> | undefined
/** Shared by single and batch outbound calls, before dialing. Never replaces another webhook. */
export function ensureCallEvents(request: typeof CartesiaRequest): Promise<void> {
  if (process.env.SIMULATE === "1") return Promise.resolve()
  return setup ??= configureCallEvents(request).catch(error => { setup = undefined; throw error })
}

async function configureCallEvents(request: typeof CartesiaRequest) {
  let base: URL
  try { base = new URL(process.env.NGROK_URL ?? "") }
  catch { throw new ServiceError(503, "Set NGROK_URL to your running HTTPS tunnel before placing real calls.") }
  if (base.protocol !== "https:" || base.username || base.password || base.search || base.hash || base.pathname !== "/") {
    throw new ServiceError(503, "NGROK_URL must be an HTTPS origin.")
  }
  const secret = process.env.CALLBACK_SECRET?.trim()
  if (!secret) throw new ServiceError(503, "CALLBACK_SECRET is required for live transcript delivery.")
  const url = base.origin + "/calls/events"
  const agentPath = "/agents/" + encodeURIComponent(process.env.CARTESIA_AGENT_ID ?? "")
  const agent = await request("GET", agentPath)
  if (typeof agent.webhook_id === "string" && agent.webhook_id) {
    const hook = await request("GET", "/agents/webhooks/" + encodeURIComponent(agent.webhook_id))
    if (hook.url === url) return
    throw new ServiceError(409, "This voice agent already sends events to another webhook. Update its webhook URL to NGROK_URL + /calls/events and its secret to CALLBACK_SECRET.")
  }
  const hook = await request("POST", "/agents/webhooks", { url, secret })
  if (typeof hook.id !== "string" || !hook.id) throw new ServiceError(502, "The provider returned no call event webhook ID")
  await request("PATCH", agentPath, { webhook_id: hook.id })
}
