import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { loadEnv } from './env'

/** Save a roster through the existing operator API; this command never starts a drill. */
export async function configureDrill(file = resolve(import.meta.dirname, '../mock/drill-participants.json')) {
  loadEnv()
  const secret = process.env.OPERATOR_SECRET?.trim()
  if (!secret) throw new Error('Set OPERATOR_SECRET in the root .env.local before configuring participants.')
  let input: unknown
  try { input = JSON.parse(readFileSync(file, 'utf8')) }
  catch { throw new Error('Cannot read roster JSON. Copy server/mock/drill-participants.json.example to server/mock/drill-participants.json and fill in consenting participants.') }
  if (!input || typeof input !== 'object' || !('participants' in input) || !Array.isArray(input.participants))
    throw new Error('The roster must contain a participants array.')
  const base = (process.env.BACKEND_URL || 'http://127.0.0.1:8787').replace(/\/$/, '')
  let response: Response
  try {
    response = await fetch(base + '/drills/participants', {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15000),
      headers: { Authorization: 'Bearer ' + secret, 'Content-Type': 'application/json', 'ngrok-skip-browser-warning': '1' },
      body: JSON.stringify({ command_id: 'configure-roster-' + randomUUID(), participants: input.participants }),
    })
  } catch { throw new Error('Cannot reach the API. Start the database and API, then retry. No drill was started.') }
  if (!response.ok) {
    const result = await response.json().catch(() => null) as { error?: string } | null
    throw new Error('Roster configuration failed (HTTP ' + response.status + '): ' + (result?.error || 'Check API/database configuration.'))
  }
  const receipt = await response.json().catch(() => null) as { status?: string; profile_ids?: number[] } | null
  if (receipt?.status !== 'configured' || !Array.isArray(receipt.profile_ids) || receipt.profile_ids.length !== input.participants.length)
    throw new Error('The API did not confirm the saved roster. Check the backend URL and API logs before starting a drill.')
  console.log('Saved ' + receipt.profile_ids.length + ' drill participants. No calls placed. Refresh the app before Start → Wildfire drill.')
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  configureDrill(process.argv[2] ? resolve(process.argv[2]) : undefined).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'Roster configuration failed')
    process.exitCode = 1
  })
}
