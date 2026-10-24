import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { placeCheckInCall } from "./cartesia"

const E164 = /^\+[1-9]\d{1,14}$/

loadEnvFiles()

const phone = process.argv[2]?.trim() ?? ""
if (E164.test(phone) === false) {
  console.error("phone number must be E.164, for example +14155550123")
  process.exit(1)
}

placeCheckInCall(phone).then(
  (agentCallId) => {
    console.log(agentCallId)
  },
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : "Call could not start")
    process.exit(1)
  },
)

function loadEnvFiles(): void {
  const seen = new Set<string>()
  for (const root of [process.cwd(), resolve(import.meta.dirname, "../..")]) {
    const path = resolve(root, ".env")
    if (seen.has(path)) continue
    seen.add(path)
    let text: string
    try {
      text = readFileSync(path, "utf8")
    } catch {
      continue
    }
    for (const line of text.split("\n")) {
      const entry = envEntry(line)
      if (entry && process.env[entry.key] === undefined) {
        process.env[entry.key] = entry.value
      }
    }
  }
}

function envEntry(line: string): { key: string; value: string } | null {
  let stripped = line.trim()
  if (stripped.length === 0 || stripped.startsWith("#") || !stripped.includes("=")) return null
  if (stripped.startsWith("export ")) stripped = stripped.slice("export ".length)
  const splitAt = stripped.indexOf("=")
  const key = stripped.slice(0, splitAt).trim()
  let value = stripped.slice(splitAt + 1).trim()
  if (value.length >= 2 && (value[0] === '"' || value[0] === "'") && value[0] === value[value.length - 1]) {
    value = value.slice(1, -1)
  }
  if (key.length === 0) return null
  return { key, value }
}
