import type { Learned, Plan } from "./agent"

// Explicit demonstration fixtures, never a fallback for failed Claude requests.
export function recordingMode(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.COORDINATOR_SCRIPTED !== "1") return false
  if (env.SIMULATE !== "1") throw new Error("COORDINATOR_SCRIPTED requires SIMULATE=1")
  if (env.AUTO_COORDINATE !== "1") throw new Error("COORDINATOR_SCRIPTED requires AUTO_COORDINATE=1")
  return true
}

export async function scriptedPlan(input: Record<string, unknown>): Promise<Plan> {
  const candidates = input.candidates as {profile_id:number;location_id:string}[]
  const attempts = input.attempts as {profile_id:number}[]
  const reports = input.reports as {text:string}[]
  if (reports.some(row=>row.text.toLowerCase().includes("possible match"))) {
    return {calls:[],reason:"SCRIPTED DEMO: possible match awaits parent confirmation."}
  }
  return {
    reason:"SCRIPTED DEMO: use eligible helpers and the latest recorded clue.",
    calls:candidates.map(person=>{
      const location=person.location_id === "park-bench" ? "Park bench" : "Playground"
      const followup=attempts.some(row=>row.profile_id===person.profile_id)
      const clue=reports.some(row=>row.text.toLowerCase().includes("red backpack near the playground"))
      return {profile_id:person.profile_id,
        ask:!followup ? `Can you check the ${location} and report what you see?`
          :clue ? "A new report mentions a red backpack near the playground. Can you check that sighting and report what you see?"
          :`What did you observe near the ${location}, and do you need help?`,
        context:"Fictional recording exercise: Ava was reported missing near the park. Reports are not verified."}
    }),
  }
}

export async function scriptedInterpret(input: unknown): Promise<Learned & {accepted:boolean}> {
  const report=input as {answer?:unknown;flagged_by_the_in_call_agent?:unknown}
  if (typeof report.answer !== "string" || !report.answer.trim()) throw new Error("Scripted report requires an answer")
  return {reached:true,
    accepted:["Yes, I can check the park bench.","Yes, I can check the playground."].includes(report.answer),
    concern:typeof report.flagged_by_the_in_call_agent === "string" ? report.flagged_by_the_in_call_agent : "",
    notes:[{text:report.answer,has_place:false,lat:0,lng:0,radius_m:0}],
  }
}
