// Input validation and the error type the HTTP layer turns into a status code.
// The workflow itself lives in loop.ts.

export class ServiceError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = "ServiceError"
    this.status = status
  }
}

export function asString(value: unknown, name: string): string {
  if (typeof value === "string") return value
  throw new ServiceError(400, name + " must be a string")
}

export function optionalString(value: unknown, name: string): string {
  if (value === undefined || value === null) return ""
  return asString(value, name)
}

export function asNumber(value: unknown, name: string): number {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string" && value.trim().length > 0 && Number.isFinite(Number(value))) {
    return Number(value)
  }
  throw new ServiceError(400, name + " must be a number")
}

export function asId(value: unknown, name: string): number {
  const id = asNumber(value, name)
  if (!Number.isSafeInteger(id) || id < 0) throw new ServiceError(400, name + " must be an integer")
  return id
}

// Cartesia sends dynamic variables as strings and leaves them empty when the
// dial did not set one, so an absent id is "" rather than missing.
export function optionalId(value: unknown, name: string): number | null {
  if (value === undefined || value === null) return null
  if (typeof value === "string" && value.trim().length === 0) return null
  return asId(value, name)
}
