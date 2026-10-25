# Running the server

For a repeatable recording through the **actual persisted backend**, see
[RECORDING.md](./RECORDING.md). It includes startup, replay and frontend field
mapping. Model answers and calls are explicitly scripted in this mode.

## Coordinator demo without phone/database setup

From `server/`, install dependencies with `npm ci`, then run:

```bash
npm run demo:coordinator -- --scripted
npm test
npm run check
```

The scripted command uses fictional snapshots and fixed proposals. Expect two
initial questions, no outreach at 9 seconds, a changed playground question at
10 seconds after new evidence, an open possible-find case waiting for parent
confirmation, and no outreach for the parent-confirmed closed case. These are
independent snapshots, not a persisted event replay. It makes no network calls.

To use real Claude with the same simulated communications, set
`ANTHROPIC_API_KEY` in the environment or an existing local `.env`, then run:

```bash
npm run demo:coordinator
```

This uses the model already configured in `src/llm.ts`. It exits with an explicit
failure on unavailable/invalid model output and never falls back to scripted
calls. Compare the printed before/after questions to assess actual model behavior;
a scripted pass is not evidence of model adaptation. Both modes leave the database,
phone tools, live agent and tunnel untouched. No extra provider setup is needed.

Design and vocabulary are in `DESIGN.md`. Conventions are in `CONTEXT.md`. This file is only
how to start it and how to run a real phone call end to end.

---

## Automatic follow-up backend (issue #5)

This uses the actual HTTP backend and persisted state. First publish the updated
SpacetimeDB module to a dedicated test database: it adds `case_progress` and
`attempt_progress`, which the server now reads. Use the existing database setup
for that isolated environment; do not run `dev-clean-db` against Vien's database.
Seed two helpers with distinct destinations and a separate child profile with an
empty phone. Substitute the actual helper IDs below. Claude credentials are still
required in simulated-call mode; this is not the offline scripted snapshot demo.

```bash
# Same backend, calls simulated for recording/development:
AUTO_COORDINATE=1 COORDINATOR_HELPER_IDS=1,2 npm run server:sim

# Same backend, real calls through Vien's existing provider adapter:
AUTO_COORDINATE=1 COORDINATOR_HELPER_IDS=1,2 npm run server
```

Start a point incident with the full child description/location/time via the
existing typed incident UI, or open a case for a separately seeded child through
`POST /cases`. Two helper calls may overlap. Submit one final report per attempt
through the existing simulation box or `POST /calls/report`:

```json
{"attempt_id":"7","answer":"Yes, I can check the park bench.","concern":""}
```

The callback returns after saving the receipt. Interpretation and planning happen
in the worker. An explicit acceptance makes a follow-up due after 10 seconds;
a real call must also have ended before another call reaches that helper.
Exact report replays are harmless; changed final reports for the same attempt
return 409. New unsolicited updates need the forthcoming inbound interface.

Inspect `/state`: `coordination` exposes revision, backoff and blocked status;
`attempt_progress` exposes transport, receipt and acceptance state. `unknown`
transport is not retried automatically. Each helper gets at most two calls.
Close through the existing case route to verify queued outreach stops. Do not
represent that manual closure as verified parent confirmation.

Verification for this change: `npm test` and `npm run check`. Tests include real
reducer functions with an in-memory transaction host, fake provider/model calls,
worker recreation, report replay, stale plans and simultaneous worker claims.
Live DB publishing/restart, real Claude, incoming calls and end-to-end phone
rehearsal remain separate checks. Initial phone intake is not yet implemented.

## 1. One-time setup

```sh
cd server
npm install
```

**Environment.** The repo-root `.env` (not `server/.env`) needs all five:

| Variable | What it is |
|---|---|
| `CARTESIA_API_KEY` | Cartesia API key |
| `CARTESIA_AGENT_ID` | The shared hosted agent. Every call reuses it |
| `CARTESIA_FROM_NUMBER_ID` | The number Cartesia dials *from* |
| `NGROK_URL` | Your reserved ngrok https origin, e.g. `https://xxx.ngrok-free.dev` |
| `ANTHROPIC_API_KEY` | Claude, for the coordinator |
| `CALLBACK_SECRET` | Optional. Shared bearer for the two routes Cartesia calls |

`.env.sample` lists them. `./dev-tunnel` also reads `.env` from either `server/` or the repo
root.

**`CALLBACK_SECRET`.** The ngrok URL is public, so without this anyone who learns it can post
notes into a live case. Set it (`openssl rand -hex 24`) and `npm run setup-agent` configures
Cartesia to send `Authorization: Bearer <secret>` on every webhook tool call, while the server
rejects `/calls/report` and `/check-ins` without it. Leave it unset and both sides stay off, so
a teammate who does not have it still runs the loop. **Change it and you must re-run
`npm run setup-agent`**, or every real call reports into a 401.

**Profiles.** `mock/profiles.json` is gitignored because it holds real phone numbers. Create
your own from the template:

```sh
cp mock/profiles.json.example mock/profiles.json
```

The template ships `+1555555…` placeholders. **A placeholder number is never dialed in real
mode**, so if you leave them in, the server plans calls and then silently dials nobody. For a
real test you need at least one genuine number. Two ways:

```sh
# A. Edit mock/profiles.json and put real numbers in. Needed for the multi-phone demo.

# B. Keep the template untouched and inject one real number at seed time:
SEED_PHONE=+14155550123 npm run seed                    # overrides the FIRST profile
SEED_PHONE=+14155550123 SEED_PROFILE=Blair npm run seed # overrides Blair instead
```

`SEED_PHONE` overrides exactly one profile, so option B is for single-phone tests. Everyone
else stays a placeholder.

---

## 2. Start it — four terminals

Run all four from `server/`. Order matters: 0 before 2, and 1 before 2.

### Terminal 0 — the database engine

```sh
spacetime start
```

Leave running. **This is the one everyone forgets.** It dies quietly when its terminal closes,
and every other step fails with `Connection refused (os error 61)`. Verify before moving on:

```sh
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3000/v1/ping   # want 200
```

### Terminal 1 — the public tunnel

```sh
./dev-tunnel
```

Leave running. Cartesia cannot reach `localhost`, so its webhook tools need a public HTTPS URL.
This reuses `NGROK_URL` as a reserved domain, so the URL does not change between runs.

If `NGROK_URL` is unset, ngrok assigns a random URL instead — put that URL in `.env` and re-run
`npm run setup-agent`, or the tools will point at a dead address.

### Terminal 2 — load the database and configure the agent

```sh
./dev-clean-db && npm run seed && npm run setup-agent
```

This exits when done; it is not a server. In order it:

1. wipes and republishes the SpacetimeDB module (`--delete-data`),
2. loads `mock/profiles.json`,
3. upserts the webhook tools from `tools/*.json` and writes the agent prompt onto
   `CARTESIA_AGENT_ID`.

`seed` prints each profile and whether it is dialable:

```
1 Alex  +15555550101 placeholder, not dialed
2 Blair +15555550102 placeholder, not dialed
```

**If every line says `placeholder, not dialed`, stop.** No real call can happen. Go back to §1.

`setup-agent` is idempotent — a second run should print `unchanged`.

> ⚠️ `CARTESIA_AGENT_ID` is **shared with your teammates**. `setup-agent` overwrites its prompt
> and initial message. Coordinate before running it during someone else's demo.

### Terminal 3 — the server

```sh
npm run server
```

Leave running. Prints `listening on http://127.0.0.1:8787`.

Use `npm run server` for real calls. Do **not** use `npm run server:sim` — that is simulate mode
and never dials a phone.

---

## 3. Real integration test, step by step

Everything above must be running, with at least one real phone number seeded.

### Step 1 — confirm the agent is configured

```sh
npm run agent:show
```

In the JSON, check three things:

- `instructions` mentions `{{person_name}}` and `{{ask}}` — not Cartesia's stock greeting.
- `tools` contains exactly `record_check_in` and `report_call`.
- Each tool's URL starts with your current `NGROK_URL`.

If the URL is stale, re-run `npm run setup-agent`.

### Step 2 — warm-up: one call, no case

```sh
npm run test:call -- +14155550123
```

Your phone should ring within a few seconds and an automated voice should ask whether you are
safe and can get out on your own. This proves Cartesia, the agent prompt, and the from-number
all work, before any coordinator logic is involved.

> ⚠️ **This script is currently stale.** It still expects `POST /incidents` to return a `calls`
> array, which the coordinator rewrite removed. The phone does still ring — the dial now happens
> in background triage — but the script always exits with
> `POST /incidents did not call …`. Treat a ringing phone as the pass signal and ignore the
> error, or skip to Step 3.

### Step 2b — the provider probe: one answered call, reported back

```sh
npm run test:report -- +14155550123
```

This is the one check that covers the whole provider path in isolation. It builds a throwaway
case in the middle of the Pacific, dials you with a real `attempt_id`, and waits. Answer, say
one sentence, and let the agent finish talking. It then prints the attempt row and the notes
Claude derived:

```
attempt_id 5, case 4
dialing +14155550123 as ac_... Answer it, then wait.
outcome   answered
answer    "I'm at the park bench and I'm fine."
note      probe-witness-...: The person is at the park bench and reports being safe.
```

A pass here means all of it works: the dial, the `attempt_id` dynamic variable, the hosted
`report_call` tool, the `CALLBACK_SECRET` bearer, `POST /calls/report`, and Claude's
interpretation. It calls nobody but the number you pass, so it is safe to re-run.

If it times out, the call reached you but `report_call` never fired or never landed. Check the
server log for a `401` (the bearer is out of sync — re-run `npm run setup-agent`) and
`npm run agent:show` for the tool URL.

### Step 3 — open an incident

Open `http://127.0.0.1:8787` and type a plain sentence into the entry box:

```
Alex is missing, last seen near Loma Alta Park around 3pm today
```

Expected, in order:

1. The response returns in roughly 3–6 seconds — that is Claude's `interpretIncident`.
2. An INCIDENT section appears with a type like `missing person`.
3. One case appears.
4. Terminal 3 logs one line per dial, and the phones you seeded start ringing.

If no call rows appear, the candidate list came back empty. Almost always this is placeholder
numbers — see §1.

### Step 4 — answer the phone

The agent states it is automated, then asks the one question Claude wrote for *that* person.
Different people get different questions from the same incident.

Answer naturally. Mention a place ("I saw them near the creek behind the school") — the
coordinator geocodes places into map coordinates, and that is the thing worth seeing work.

### Step 5 — watch the answer land

Before hanging up, the agent calls `report_call`, which posts to `POST /calls/report`. Within
about 20 seconds of the call ending:

- the call row flips from `ringing` to `answered`,
- notes appear under the case, with coordinates if you named a place,
- the brief rewrites itself to account for what you said.

Calls still ringing are unaffected. Nothing blocks on anything.

### Step 6 — steer it

Type into the dispatcher box on the case, e.g. *"also ask the neighbours on Marengo"*.

New call rows should appear **immediately**, without waiting for in-flight calls. Dispatcher
input is the only thing that re-plans; everything else just adds facts.

### Step 7 — close

Press **Accept**. The case status goes to `closed` and no further calls are planned for it.

---

## 4. Simulate instead of dialing

```sh
npm run server:sim      # SIMULATE=1
```

Use this for everything except verifying real audio. The entire loop runs in seconds with no
call minutes spent: `placeCall` logs and returns a fake id (`src/cartesia.ts`), and the UI shows
a "what did they say?" box on every ringing call so you type the answer by hand.

Simulate mode also keeps `+1555555` placeholders in the call list, since nothing is dialed. That
is why the template fixture works out of the box here but produces zero calls in real mode.

---

## 5. Command reference

| Command | Does |
|---|---|
| `npm run server` | The server, real calls |
| `npm run server:sim` | The server, no calls |
| `npm run check` | Typechecks `src` and the SpacetimeDB module |
| `npm test` | Candidate filter, SQL decoding, tool JSON. No DB, no network |
| `npm run seed` | Loads `mock/profiles.json`. Honours `SEED_PHONE` / `SEED_PROFILE` |
| `npm run inspect` | Dumps every table as JSON |
| `npm run agent:show` | Prints the live Cartesia agent config |
| `npm run test:call -- +E164` | One check-in call, opens no case. Stale: see Step 2 |
| `npm run test:report -- +E164` | One real answered call through `report_call`. See Step 2b |
| `./dev-clean-db` | Wipes and republishes the database module |
| `./dev-tunnel` | ngrok in front of port 8787 |

---

## 6. Troubleshooting

| Symptom | Cause |
|---|---|
| `Connection refused` on port 3000 | `spacetime start` is not running (Terminal 0) |
| `seed` says `ENOENT mock/profiles.json` | You skipped `cp mock/profiles.json.example mock/profiles.json` |
| Incident opens but no calls appear | Every seeded number is a `+1555555` placeholder, so the call list is empty |
| Port 8787 already in use | An old `npm run server` is still alive: `pkill -f "tsx src/server.ts"` |
| The agent gives Cartesia's stock greeting | `setup-agent` never ran against this agent id |
| Call ends, nothing appears in the UI | `report_call` did not fire, or the tunnel is down. Check Terminal 1 and `agent:show` URLs |
| The agent says a tool failed | `/calls/report` passed its 45s timeout. It runs a Claude call first, normally ~20s |
| A retired tool keeps firing | `setup-agent` leaves tools it does not own attached. Detach it on the agent by hand, once |
