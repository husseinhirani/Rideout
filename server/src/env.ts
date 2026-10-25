import { readFileSync } from "node:fs"
import { resolve } from "node:path"

export function loadEnv(): void {
  const seen = new Set<string>()
  const roots = [process.cwd(), resolve(import.meta.dirname, "../.."), resolve(import.meta.dirname, "..")]
  for (const path of [".env.local", ".env"].flatMap(name => roots.map(root => resolve(root, name)))) {
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
