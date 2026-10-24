import { attempts, incidentPeople, incidents, notes, profiles, supportCases } from "./db"
import { loadEnv } from "./env"

loadEnv()

const tables = {
  profile: await profiles(),
  incident: await incidents(),
  incident_person: await incidentPeople(),
  support_case: await supportCases(),
  attempt: await attempts(),
  note: await notes(),
}

console.log(JSON.stringify(tables, null, 2))
