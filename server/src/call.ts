import { placeCheckInCall } from "./cartesia"
import { loadEnv } from "./env"

const E164 = /^\+[1-9]\d{1,14}$/

loadEnv()

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

