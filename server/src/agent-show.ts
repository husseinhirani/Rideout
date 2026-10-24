import { pathToFileURL } from "node:url"
import { cartesiaJson } from "./cartesia"
import { loadEnv } from "./env"

async function main(): Promise<void> {
  const agentId = process.env.CARTESIA_AGENT_ID
  if (!agentId) throw new Error("CARTESIA_AGENT_ID is not set")
  const agent = await cartesiaJson("GET", "/v1/agents/" + encodeURIComponent(agentId))
  console.log(JSON.stringify(agent, null, 2))
}

const entry = process.argv[1]
if (entry && import.meta.url === pathToFileURL(entry).href) {
  loadEnv()
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "show failed")
    process.exitCode = 1
  })
}
