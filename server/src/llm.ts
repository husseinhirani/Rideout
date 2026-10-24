import Anthropic from "@anthropic-ai/sdk"

const MODEL = "claude-opus-5"
const MAX_TOKENS = 16_000

let client: Anthropic | null = null

// Built on first use, not at import, so the server still boots without
// ANTHROPIC_API_KEY. Every ask() has a fallback, so the loop degrades
// instead of breaking.
function anthropic(): Anthropic {
  if (!client) client = new Anthropic()
  return client
}

export type AskOptions<T> = {
  system: string
  input: unknown
  schema: Record<string, unknown>
  fallback: T
}

export async function ask<T>(options: AskOptions<T>): Promise<T> {
  try {
    const reply = await anthropic().messages.parse({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      thinking: { type: "adaptive" },
      system: options.system,
      output_config: { format: { type: "json_schema", schema: options.schema } },
      messages: [{ role: "user", content: JSON.stringify(options.input) }],
    })
    if (reply.parsed_output == null) throw new Error("Claude returned no structured output")
    return reply.parsed_output as T
  } catch (error) {
    console.error("llm: " + errorMessage(error) + " - using fallback")
    return options.fallback
  }
}

export function objectSchema(
  properties: Record<string, unknown>,
  required: string[],
): Record<string, unknown> {
  return { type: "object", properties, required, additionalProperties: false }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "request failed"
}
