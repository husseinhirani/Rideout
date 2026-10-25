import Anthropic from "@anthropic-ai/sdk"

const DEFAULT_MODEL = "claude-sonnet-5-5"
const MAX_TOKENS = 16_000

let client: Anthropic | null = null

// Built on first use, not at import, so the server still boots without
// ANTHROPIC_API_KEY. Generic planning uses the strict path without a fallback.
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
      model: process.env.CLAUDE_MODEL?.trim() || DEFAULT_MODEL,
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

// Bounded coordinator requests must distinguish model failure from a real plan.
// Existing callers can still explicitly use ask() with their legacy fallback.
export async function askStrict<T>(options: Omit<AskOptions<T>, "fallback">): Promise<T> {
  return (await askStrictWithMetadata<T>(options)).value
}

export async function askStrictWithMetadata<T>(options: Omit<AskOptions<T>, "fallback">): Promise<{ value: T; model: string; request_id: string }> {
  const { data: reply, request_id } = await anthropic().messages.create({
    model: process.env.CLAUDE_MODEL?.trim() || DEFAULT_MODEL,
    max_tokens: MAX_TOKENS,
    thinking: { type: "adaptive" },
    system: options.system,
    output_config: { format: { type: "json_schema", schema: options.schema } },
    messages: [{ role: "user", content: JSON.stringify(options.input) }],
  }, { timeout: 60_000, maxRetries: 0 }).withResponse()
  const output = reply.content.find(block => block.type === "text")
  if (reply.stop_reason !== "end_turn" || output?.type !== "text") {
    throw new Error("Claude returned no complete structured output")
  }
  const value = JSON.parse(output.text) as T
  if (value == null) throw new Error("Claude returned no structured output")
  return { value, model: reply.model, request_id: request_id ?? "" }
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
