import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { loadEnv } from './env'

type DrillOptions = { participantNames?: string[]; includeSimulated?: boolean }

export function parseDrillArguments(args: string[]): { file?: string; options: DrillOptions } {
  let file: string | undefined
  const options: DrillOptions = {}
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]
    if (arg === '--only') {
      const names = args[++index]
      if (options.participantNames || !names || names.startsWith('--')) throw new Error('--only requires a comma-separated list of saved participant names.')
      options.participantNames = names.split(',').map(name => name.trim())
      if (options.participantNames.some(name => !name)) throw new Error('--only requires nonempty participant names.')
    } else if (arg === '--no-neighbors') options.includeSimulated = false
    else if (arg.startsWith('-')) throw new Error('Unknown option: ' + arg)
    else if (file) throw new Error('Provide at most one roster JSON path.')
    else file = resolve(arg)
  }
  if (file && options.participantNames) throw new Error('Choose a roster JSON path or --only saved participant names, not both.')
  return { file, options }
}

/** Save a roster through the existing operator API; this command never starts a drill. */
export async function configureDrill(file = resolve(import.meta.dirname, '../mock/drill-participants.json'), options: DrillOptions = {}) {
  loadEnv()
  const secret = process.env.OPERATOR_SECRET?.trim()
  if (!secret) throw new Error('Set OPERATOR_SECRET in the root .env.local before configuring participants.')
  let payload: { participants?: unknown[]; participant_names?: string[]; include_simulated: boolean }
  if (options.participantNames) {
    payload = { participant_names: options.participantNames, include_simulated: options.includeSimulated ?? true }
  } else {
    let input: unknown
    try { input = JSON.parse(readFileSync(file, 'utf8')) }
    catch { throw new Error('Cannot read roster JSON. Use --only with saved participant names, or copy server/mock/drill-participants.json.example to server/mock/drill-participants.json and fill in consenting participants.') }
    if (!input || typeof input !== 'object' || !('participants' in input) || !Array.isArray(input.participants))
      throw new Error('The roster must contain a participants array.')
    if ('include_simulated' in input && typeof input.include_simulated !== 'boolean') throw new Error('include_simulated must be boolean.')
    payload = { participants: input.participants, include_simulated: options.includeSimulated ?? ('include_simulated' in input ? input.include_simulated as boolean : true) }
  }
  const expectedCount = (payload.participant_names ?? payload.participants)!.length
  const base = (process.env.BACKEND_URL || 'http://127.0.0.1:8787').replace(/\/$/, '')
  let response: Response
  try {
    response = await fetch(base + '/drills/participants', {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15000),
      headers: { Authorization: 'Bearer ' + secret, 'Content-Type': 'application/json', 'ngrok-skip-browser-warning': '1' },
      body: JSON.stringify({ command_id: 'configure-roster-' + randomUUID(), ...payload }),
    })
  } catch { throw new Error('Cannot reach the API. Start the database and API, then retry. No drill was started.') }
  if (!response.ok) {
    const result = await response.json().catch(() => null) as { error?: string } | null
    throw new Error('Roster configuration failed (HTTP ' + response.status + '): ' + (result?.error || 'Check API/database configuration.'))
  }
  const receipt = await response.json().catch(() => null) as { status?: string; profile_ids?: number[] } | null
  if (receipt?.status !== 'configured' || !Array.isArray(receipt.profile_ids) || receipt.profile_ids.length !== expectedCount)
    throw new Error('The API did not confirm the saved roster. Check the backend URL and API logs before starting a drill.')
  console.log('Saved ' + receipt.profile_ids.length + ' drill participants' + (payload.participant_names ? ': ' + payload.participant_names.join(', ') : '') + '. Simulated neighbors: ' + (payload.include_simulated ? 'included' : 'disabled') + '. No calls placed. Refresh the app before Start → Wildfire drill.')
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  Promise.resolve().then(() => {
    const { file, options } = parseDrillArguments(process.argv.slice(2))
    return configureDrill(file, options)
  }).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'Roster configuration failed')
    process.exitCode = 1
  })
}
