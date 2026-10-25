export type CoordinatorErrorKind = 'billing' | 'authentication' | 'rate_limit' | 'network' | 'invalid_plan' | 'service' | 'unknown'
export type CoordinatorFailure = { kind: CoordinatorErrorKind; message: string; blocked: boolean }

const descriptions: Record<CoordinatorErrorKind, string> = {
  billing: 'Coordinator planning is unavailable because the model provider rejected billing or available credits. Fix the provider billing, then choose Retry planning. Saved call findings are still available.',
  authentication: 'Coordinator planning is unavailable because model-provider authentication or permissions failed. Check the server credentials and access, then choose Retry planning. Saved call findings are still available.',
  rate_limit: 'The model provider is rate limiting coordinator planning. Saved call findings are still available.',
  network: 'Coordinator planning could not connect to the model provider or database, or the request timed out. Saved call findings are still available.',
  invalid_plan: 'The coordinator returned an incomplete or invalid plan. No actions from that plan were applied. Saved call findings are still available.',
  service: 'The model provider or database service could not complete coordinator planning. Saved call findings are still available.',
  unknown: 'Coordinator planning failed unexpectedly. Saved call findings are still available. Check the server before retrying.',
}

function failure(kind: CoordinatorErrorKind): CoordinatorFailure {
  return { kind, message: descriptions[kind], blocked: kind === 'billing' || kind === 'authentication' }
}

/** Use SDK status/type information as well as messages; never expose raw provider payloads. */
export function classifyCoordinatorError(error: unknown, phase: 'model' | 'commit' = 'model'): CoordinatorFailure {
  const data = error && typeof error === 'object' ? error as Record<string, unknown> : {}
  const nested = data.error && typeof data.error === 'object' ? data.error as Record<string, unknown> : {}
  const inner = nested.error && typeof nested.error === 'object' ? nested.error as Record<string, unknown> : {}
  const cause = data.cause && typeof data.cause === 'object' ? data.cause as Record<string, unknown> : {}
  const status = Number(data.status ?? data.statusCode ?? nested.status)
  const description = [typeof error === 'string' ? error : '', data.message, data.name, data.code, nested.type, nested.message, inner.type, inner.message, cause.message, cause.code].filter(v => typeof v === 'string').join(' ')
  if (status === 402 || /credit balance|insufficient.{0,20}(credit|fund)|billing|payment required|insufficient_quota/i.test(description)) return failure('billing')
  if (status === 401 || status === 403 || /authentication|permission_error|unauthorized|forbidden|invalid.{0,15}(api.?key|credential)|missing.{0,15}(api.?key|credential)|could not resolve authentication/i.test(description)) return failure('authentication')
  if (status === 429 || /rate.?limit|too many requests/i.test(description)) return failure('rate_limit')
  if (status === 408 || status === 504 || /APIConnection|connection|network|fetch failed|could not be reached|timed? ?out|timeout|ECONN|ENOTFOUND|EAI_AGAIN|socket/i.test(description)) return failure('network')
  if (status >= 500 || /overloaded_error|service unavailable|internal.server.error|instance encountered a fatal error/i.test(description)) return failure('service')
  if (error instanceof SyntaxError || /structured output|invalid.*plan|incomplete.*plan/i.test(description) || phase === 'commit') return failure('invalid_plan')
  return failure('unknown')
}

/** Existing reducer signature stays compatible with older callers sending plain text. */
export function decodeCoordinatorFailure(message: string): CoordinatorFailure {
  try {
    const parsed = JSON.parse(message) as { kind?: unknown }
    if (parsed && typeof parsed.kind === 'string' && Object.prototype.hasOwnProperty.call(descriptions, parsed.kind)) return failure(parsed.kind as CoordinatorErrorKind)
  } catch { /* Older callers send an unstructured error message. */ }
  return classifyCoordinatorError(message)
}

/** Read compatibility for incidents saved before structured planning failures existed. */
export function hydrateLegacyCoordinatorFailure<T extends { error: string; planning_error?: CoordinatorFailure; review?: string | null }>(state: T): T {
  if (!state.planning_error && state.error?.trim()) {
    state.planning_error = decodeCoordinatorFailure(state.error)
    state.error = state.planning_error.message
    // This older operational warning misidentified provider failures as invalid plans.
    // Preserve every other review: it may describe an unresolved participant need.
    if (state.planning_error.blocked && state.review === 'The coordinator could not produce a valid plan. Please review the incident.') state.review = null
  }
  return state
}
