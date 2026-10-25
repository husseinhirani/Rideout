# Run and test Sealert from a fresh checkout

This is the current setup for the live dispatcher, parallel phone calls, coordinator,
transcripts, recordings, and returning callers. Commands below run from the repository
root on macOS or Linux (or a Linux shell in WSL).

## What each teammate needs

| Dependency | Purpose |
| --- | --- |
| Git and repository access | Clone `husseinhirani/Rideout`, branch `main` |
| Node.js 24 and npm | Frontend, API, and TypeScript tooling; use this tested runtime |
| [SpacetimeDB CLI](https://spacetimedb.com/install), version 2.13.0 | Local database and module publication |
| [ngrok CLI and account](https://ngrok.com/docs/gateway/agent) | Public HTTPS callbacks to the local API |
| Cartesia account/API key, managed agent, and outbound number ID | Voice calls, transcripts, recordings; account capacity for four concurrent calls |
| Anthropic API key with available credits and model access | Coordinator planning and chat; a Claude chat subscription alone does not supply API access |
| Consenting participants and their phone numbers | Private reusable call roster |

In Cartesia Playground, create a managed agent with an available voice/model and provision
or select a phone number. For return-call testing, assign that number to this same agent.
Record the number's provider **ID**, not its displayed phone number, as
`CARTESIA_FROM_NUMBER_ID`. [Cartesia's number guide](https://docs.cartesia.ai/line/integrations/telephony/cartesia-numbers)
explains provisioning and assignment. Cartesia-provisioned numbers support US outbound destinations.

Use a separate Cartesia agent/number and ngrok endpoint for independent simultaneous
teammate testing. `setup-agent` updates the selected hosted agent. Two laptops sharing an
agent can redirect each other's tools, while an existing event webhook may still point to
the first laptop. Sharing one environment requires coordinating who runs it.

Git includes application code, lockfiles, module source, tool definitions, map fixtures,
and the 12 drill neighbors. Git does **not** include API keys, local `.env` files, real
phone rosters, local database contents, past conversations, or hosted provider settings.
To reproduce the same four phones, obtain the roster privately; a fresh database starts
without the other machine's history. Needs and matches are determined during the run.

## 1. Get the current code and install packages

```bash
git clone https://github.com/husseinhirani/Rideout.git
cd Rideout
git switch main
git pull --ff-only origin main
npm ci
npm --prefix server ci
```

For an existing checkout, finish or save unrelated work before switching branches. Do not
reset someone else's work. If `--ff-only` fails, resolve the divergence rather than force
pushing. Use `git log -5 --oneline` to see the checked-out changes.

Install the database CLI using its official installation page above. Authenticate ngrok
with the authtoken command from its dashboard. Check `node --version`,
`spacetime --version`, and `ngrok version` before continuing.

## 2. Configure the environment once

```bash
cp -n .env.sample .env.local
openssl rand -hex 24
openssl rand -hex 24
```

Edit root `.env.local`. Use the two different generated values for `CALLBACK_SECRET` and
`OPERATOR_SECRET`. Fill in `CARTESIA_API_KEY`, `CARTESIA_AGENT_ID`,
`CARTESIA_FROM_NUMBER_ID`, `ANTHROPIC_API_KEY`, and `NGROK_URL` (the full HTTPS origin of
your ngrok endpoint, with no path). Keep these settings from the template:

```dotenv
SPACETIMEDB_URL=http://127.0.0.1:3000
SPACETIMEDB_DATABASE=rideout-local-stage1
BACKEND_URL=http://127.0.0.1:8787
SIMULATE=0
AUTO_COORDINATE=1
COORDINATOR_SCRIPTED=0
INBOUND_REQUESTS=1
```

The backend defaults to Claude Sonnet 5.5 (`claude-sonnet-5-5`). If an existing
`.env.local` or shell exports `CLAUDE_MODEL`, update it to that ID or remove the
override to use the default, then restart the API. No module publication or hosted
voice-agent setup is needed for this backend model change.

The database name here must match the publish command below. Choose a separate database
name for an independent local dataset and change both together. Legacy
`COORDINATOR_HELPER_IDS`, `COORDINATOR_REPORTER_ID`, and `WILDFIRE_DEMO_*` settings are not
required for the saved-roster flow.

Exported shell values override files; `.env.local` overrides `.env`. API and Vite must use
the same `OPERATOR_SECRET`. Restart both after changing it. Never prefix backend secrets
with `VITE_`. Optional `VITE_GOOGLE_MAPS_KEY` enables the Google photorealistic map layer;
it is a browser key and needs the appropriate API access/billing and referrer restrictions.
The phone/coordinator flow does not require that key.

## 3. Start the database, then publish

Terminal 1 — leave running:

```bash
spacetime start --listen-addr 127.0.0.1:3000
```

In another terminal:

```bash
spacetime publish rideout-local-stage1 \
  --server http://127.0.0.1:3000 \
  --module-path server/spacetimedb \
  --delete-data=never
```

Use this on a fresh database and for updates. Do not run `dev-clean-db`; it deletes data.
The drill roster command below creates the needed profiles, so `npm run seed` is not
required for this flow.

## 4. Start the API and tunnel

Terminal 2 — leave running:

```bash
npm --prefix server run server
```

Expect API/callbacks at `http://127.0.0.1:8787` and the local test console at
`http://127.0.0.1:8788`.

Terminal 3 — replace the example with the same HTTPS URL as `NGROK_URL`, and leave running:

```bash
ngrok http 8787 --url=https://YOUR-DOMAIN.ngrok-free.dev
```

If ngrok assigns a different URL, update `.env.local` and restart the API before setup.
Keep the tunnel alive throughout calls. A disconnected tunnel prevents tool reports and
live transcript events from reaching the application.

## 5. Configure the hosted agent and private roster

Only after the database, API, and tunnel are reachable:

```bash
npm --prefix server run setup-agent
```

Expect `callback API and voice protocol verified`, followed by tool/prompt setup. It
checks protocol 3 and incoming-report availability before changing hosted configuration.
This command does not place calls. The agent receives `coordinate_call`,
`inbound_context`, `report_request`, `report_call`, and the compatible check-in tool.

For an agent previously used elsewhere, its event webhook must target your
`NGROK_URL` + `/calls/events` with your `CALLBACK_SECRET`. The backend creates this webhook
before dialing when absent, but deliberately refuses to replace a different URL. Tool
setup alone does not migrate that existing event webhook. Correct it in the provider
configuration or use a dedicated agent.

Create the private roster once:

```bash
cp -n server/mock/drill-participants.json.example server/mock/drill-participants.json
```

Edit that ignored JSON file. Replace the four example names and empty phone fields with
the actual participants and E.164 numbers. It supports 1–10 consenting people; add/remove
entries as needed. No example phone numbers or assigned needs are supplied. Then run:

```bash
npm --prefix server run configure-drill
```

Expect `Saved 4 drill participants. No calls placed.` This saves the roster in the selected
database; it does not start a case or dial. Names and phone numbers do not encode pairings.
The drill assigns geographic starting points, which callers must confirm or correct.
Saving a roster does not override previously withdrawn contact consent. Do not commit the
private JSON file. This command also works for later roster changes, affecting future drills.

## 6. Start the app and rehearse

Terminal 4 — leave running:

```bash
npm run dev
```

Open **http://127.0.0.1:5173**. The backend should connect, and **Start → Wildfire drill**
should be available once the saved roster is ready.

1. Click Start → Wildfire drill **once**. Four saved real participants plus 12 drill
   neighbors produce 16 initial attempts. Follow-up calls can increase that count later.
2. The four real calls can overlap, subject to provider capacity. Tom introduces himself,
   confirms identity, and explains the drill. Answer naturally with imagined needs,
   capabilities, and corrections; nobody needs to travel.
3. Open each call to watch live transcript turns and saved findings. Unanswered calls
   remain unresolved for review. Recordings become available after the call and provider
   processing; this is not a live listen-in feature.
4. Ask the coordinator what changed and who needs help. Proposals depend on reported
   location, capacity, needs, willingness, and access. No named pairing is guaranteed.
5. Approve a suitable proposal to authorize obtaining commitments. Helper acceptance,
   recipient confirmation, pickup, and arrival are separate steps. Follow-up calls may
   be needed when an earlier conversation has ended.
6. To test return context, call the provider number from a participant's phone, state the
   participant's full name, and say you are returning the latest call. The agent should
   retrieve that participant's saved purpose/history for an open associated incident.
   Earlier reports are context, not newly confirmed facts. New incoming accounts enter review.
7. Pause outreach when finished. Existing calls can finish; paused work should not start
   new calls. Starting an API against an existing active database can resume authorized work.

Before a drill, the Map view shows the 3D neighborhood. Starting or selecting an
assistance incident switches to its flat coordination map. An open incident can be
selected automatically when the page reconnects. This is intentional; a fresh database
has no incident history until a drill is started. The app reports backend connection
failures explicitly instead of silently treating offline demo content as live data.

See [the assistance walkthrough](assistance-demo.md) for correction/reassessment and
location-based matching examples. An unfunded planning API cannot demonstrate autonomous
coordination; fix billing/access before using Retry planning.

## Updates and troubleshooting

For later updates: pull main, run both `npm ci` commands when lockfiles changed, publish
with `--delete-data=never`, restart API and Vite, keep ngrok running, then run setup-agent.
The roster is persisted and does not need re-registering unless you change it or databases.

| Symptom | Check |
| --- | --- |
| Connection refused on 3000 | Database terminal must remain running before publish/API access |
| Connection refused on 8787 | Start API; inspect its terminal for a configuration error |
| Address already in use | Use `lsof -nP -iTCP:8787 -sTCP:LISTEN`; stop the identified old process before restarting |
| Direct `/state` returns 401 | Expected without operator authentication; use the local app/console |
| UI says configure operator secret | Set the same nonempty `OPERATOR_SECRET` for API/Vite and restart both |
| Wildfire Start unavailable | Save the roster in the configured database and refresh |
| Setup rejects protocol/inbound capability | Pull/publish, set `INBOUND_REQUESTS=1`, restart API, then retry setup |
| Invalid provider input | Check agent/model/key access and the setup error details; preserve the exact error without sharing secrets |
| No transcripts or tool saves | Check ngrok, callback secret, event webhook URL, and API logs |
| Phones ring but planning fails | Check Anthropic credits/model access; fix the cause then Retry planning |
| Chat still shows an earlier billing failure | Restart the API after changing the key, then Send or Retry reply to make a fresh chat request. Planning remains held until Retry planning. |
| Returning caller has no history | Check phone→agent routing, same calling number, stated name, and an open associated incident in this database |

Local code checks (no phone calls):

```bash
npm --prefix server run check
npm run build
```

Build success does not verify provider credentials, phone delivery, or live conversation
quality. Those require the rehearsal above.
