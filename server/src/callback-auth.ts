import { timingSafeEqual } from "node:crypto"
import { ServiceError } from "./service"

export function checkCallbackAuth(header: string | undefined, secret: string, required: boolean): void {
  if (!secret) {
    if (required) throw new ServiceError(503, "Inbound callback authentication is not configured")
    return
  }
  const actual = Buffer.from(header ?? "")
  const expected = Buffer.from("Bearer " + secret)
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new ServiceError(401, "unauthorized")
}
