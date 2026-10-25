import { demoSnapshots } from "../mock/coordinator"
import { planStrict } from "./agent"
import { evaluateCase } from "./coordinator"
import { loadEnv } from "./env"

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  if (args.includes("--help")) {
    console.log("Usage: npm run demo:coordinator -- [--scripted]\nDefault: real Claude planning; requires ANTHROPIC_API_KEY.\n--scripted: fixed proposals, no model calls.\nAll communications are simulated; independent snapshots, no database or telephony.")
    return
  }
  if (args.some(arg => arg !== "--scripted")) throw new Error("Unknown argument. Use --help for usage.")
  const scripted = args.includes("--scripted")
  loadEnv()
  if (!scripted && !process.env.ANTHROPIC_API_KEY?.trim()) {
    throw new Error("ANTHROPIC_API_KEY is required for real Claude planning. Use --scripted explicitly for fixed proposals.")
  }
  console.log("SIMULATED COMMUNICATIONS — no calls are placed or database rows written.")
  console.log(scripted ? "MODEL MODE: SCRIPTED — fixed proposals; this does not demonstrate model adaptation." : "MODEL MODE: REAL CLAUDE — fresh planning on each eligible snapshot; no fallback.")
  console.log("Independent fixture snapshots; results are not persisted or fed into later snapshots.")
  for (const { name, snapshot, proposal } of demoSnapshots()) {
    console.log(`\n--- ${name} ---`)
    console.log(`Case ${snapshot.case_id}: ${snapshot.status}; ${snapshot.child.name}, ${snapshot.child.description}`)
    console.log(`Reporter: ${snapshot.reporter.name} (${snapshot.reporter.relationship})`)
    console.log(`Locations: ${snapshot.locations.map(location => `${location.id}: ${location.label}`).join("; ")}`)
    console.log(`Reports: ${JSON.stringify(snapshot.reports, null, 2)}`)
    console.log(`Attempts: ${JSON.stringify(snapshot.attempts, null, 2)}`)
    const result = await evaluateCase(snapshot, scripted ? async () => proposal : planStrict)
    console.log(`Planner context: ${JSON.stringify(result.context, null, 2)}`)
    console.log(`Result: ${result.status} — ${result.reason}`)
    for (const call of result.calls) {
      const helper = snapshot.helpers.find(person => person.profile_id === call.profile_id)
      console.log(`SIMULATED question to ${helper?.name ?? call.profile_id}: ${call.ask}`)
      console.log(`Shared context: ${call.context}`)
    }
    if (result.calls.length === 0) console.log("No calls proposed.")
    if (result.status === "failed" || result.status === "rejected") {
      process.exitCode = 1
      return
    }
  }
}

main().catch(error => {
  console.error(`Coordinator demo failed: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
})
