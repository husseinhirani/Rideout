// Internal application input, not a Cartesia tool or HTTP contract. This checks
// intake completeness only; it does not authorize outreach or establish identity.
export type DemoIntake = {
  child: {
    name: string
    description: string
    last_seen_location_id: "park-bench" | "playground"
    last_seen_time: string
  }
  reporter: { name: string; relationship: string; attribution: "self_reported" }
}
export type IntakeQuestion = { field: string; question: string }
export type IntakeAssessment =
  | { status: "complete"; intake: DemoIntake }
  | { status: "needs_clarification"; questions: IntakeQuestion[] }

const record = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {}
const text = (value: unknown): string => typeof value === "string" ? value.trim() : ""
const knownText = (value: unknown): string => {
  const result = text(value)
  return /^(unknown|unsure|not sure|i don't know|don't know|n\/a|\?)$/i.test(result) ? "" : result
}

export function assessDemoIntake(input: unknown): IntakeAssessment {
  const raw = record(input), child = record(raw.child), reporter = record(raw.reporter)
  const name = knownText(child.name), description = knownText(child.description)
  const location = text(child.last_seen_location_id), time = knownText(child.last_seen_time)
  const reporterName = knownText(reporter.name), relationship = knownText(reporter.relationship)
  const questions: IntakeQuestion[] = []
  const require = (present: boolean, field: string, question: string) => {
    if (!present) questions.push({field, question})
  }
  require(Boolean(name), "child.name", "What is the child's name?")
  require(Boolean(description), "child.description", "How would you describe the child, including clothing?")
  require(location === "park-bench" || location === "playground", "child.last_seen_location_id",
    "Was the child last seen at the Park bench or the Playground in the demo area?")
  require(Boolean(time), "child.last_seen_time", "Approximately when was the child last seen?")
  require(Boolean(reporterName), "reporter.name", "What is your name?")
  require(Boolean(relationship), "reporter.relationship", "What is your relationship to the child?")
  if (questions.length) return {status: "needs_clarification", questions}
  return {status: "complete", intake: {
    child: {name, description, last_seen_location_id: location as DemoIntake["child"]["last_seen_location_id"], last_seen_time: time},
    reporter: {name: reporterName, relationship, attribution: "self_reported"},
  }}
}
