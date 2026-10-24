# Running the server

Design and vocabulary are in `DESIGN.md`. Conventions are in `CONTEXT.md`. This file is
only how to start it.

## Prerequisites

`npm install` in `server/`. The repo-root `.env` needs `CARTESIA_API_KEY`,
`CARTESIA_AGENT_ID`, `CARTESIA_FROM_NUMBER_ID`, `NGROK_URL`, and `ANTHROPIC_API_KEY`.
`.env.sample` lists them.

## Four terminals

| # | Command | Leave running |
|---|---|---|
| 0 | `spacetime start` | yes |
| 1 | `./dev-tunnel` | yes |
| 2 | `./dev-clean-db && npm run seed && npm run setup-agent` | no, it exits |
| 3 | `npm run server` | yes |

Terminal 0 is the database engine. Nothing else works without it, and it is easy to forget
because it dies quietly when its terminal closes. Check it with:

```sh
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3000/v1/ping   # want 200
```

Terminal 1 gives Cartesia a public HTTPS URL for the webhook tools. It reuses `NGROK_URL`,
so that value does not change between runs.

Terminal 2 wipes and republishes the module, loads `mock/profiles.json`, then upserts the
webhook tools and the agent prompt onto `CARTESIA_AGENT_ID`. `setup-agent` is idempotent and
should print `unchanged` on a second run.

Then open `http://127.0.0.1:8787` and describe an incident in plain English.

## Simulate instead of dialing

```sh
npm run server:sim    # SIMULATE=1
```

The whole loop runs without spending call minutes. `placeCall` logs and returns a fake call
id (`src/cartesia.ts`), and the test UI shows a "what did they say?" box on every ringing
call so answers can be typed by hand. Use this for everything except verifying real audio.

`SIMULATE=1` also keeps `+1555555` placeholder numbers in the call list, which are otherwise
excluded so a real dial never reaches a fake number.

## Other commands

| Command | Does |
|---|---|
| `npm run check` | typechecks `src` and the SpacetimeDB module |
| `npm test` | candidate filter, SQL decoding, tool JSON. No DB, no network |
| `npm run inspect` | dumps every table as JSON |
| `npm run agent:show` | prints the live Cartesia agent config |
| `npm run test:call -- +E164` | one check-in call, no case opened |

## When a live call misbehaves

| Symptom | Cause |
|---|---|
| The agent gives the stock Cartesia greeting | `setup-agent` did not run against this agent |
| The call ends and nothing appears in the UI | `report_call` never fired, or the tunnel is down |
| The agent says a tool failed | `/calls/report` passed the 45s tool timeout. It runs a Claude call first, normally about 20s |

`setup-agent` leaves tools it does not own attached to the agent, so a tool that is retired
has to be detached by hand once.
