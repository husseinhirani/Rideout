# RideOut — frontend

During wildfire evacuations, cars with empty seats drive past people who can't leave. RideOut calls registered
residents, finds the ones who can't get out, and asks a neighbor who is already leaving (and whose route passes
the home) to pick them up. If nobody can help in time, the case goes to responders.

This is the demo frontend. It runs entirely in the browser with a simulated fire, so it works with no backend.

```bash
npm install
npm run dev          # http://localhost:5173
```

## Server

The server is TypeScript under `server/`. Cartesia calls are `server/src`. The SpacetimeDB module is `server/spacetimedb`. The frontend above still runs without either.

```bash
cd server
npm install
npm run check
```

### Cartesia check-in call

Copy `.env.sample` to `.env` in the repo root and set:

- `CARTESIA_API_KEY`
- `CARTESIA_AGENT_ID`
- `CARTESIA_FROM_NUMBER_ID` (the Cartesia phone-number id, `ap_...`, not the destination)
- `NGROK_URL` (https origin for the webhook tunnel, for example `https://rideout.ngrok.app`)

From `server/`, this places one real hosted-agent check-in call and prints `agent_call_id`. It does not open a support case.

```bash
cd server
npm run call -- +14155550123
```

The number has to be E.164. `CARTESIA_FROM_NUMBER_ID` is still required before this can dial.

### SpacetimeDB

Install the CLI and start a local node. `spacetime start` keeps running.

```bash
curl -sSf https://install.spacetimedb.com | sh
spacetime start
```

In another terminal, from `server/`, publish the module. `spacetimedb/package.json` is what tells the CLI this module is TypeScript. `npm install` in `server/` installs the dependency and links `tsc` into the module, because `spacetime publish` looks for `tsc` there.

```bash
cd server
spacetime publish rideout --server local --module-path spacetimedb
```

`setContacts` is part of the module. Republish after pulling it.

```bash
cd server
npm run server
```

`POST /incidents` creates the incident and places one check-in call per dialable profile in the radius. It returns when the calls are placed. The agent later POSTs the answer to `/check-ins`. `victim` opens the support case and places the first helper call. The agent POSTs `accepted` or `declined` to `/find-helper`.

```bash
curl -s -X POST http://127.0.0.1:8787/incidents \
  -H 'content-type: application/json' \
  -d '{"type":"wildfire","lat":37.8708,"lng":-122.272,"radius_m":1000}'
```

### Webhook tunnel

Cartesia can only reach a public HTTPS URL. The API stays on `http://127.0.0.1:8787`. ngrok is the HTTPS front. Each developer reserves their own domain. One `CARTESIA_AGENT_ID` has one tool URL, so whoever last ran `npm run setup-agent` is the machine that receives `POST /check-ins` and `POST /find-helper`.

```bash
brew install ngrok
ngrok config add-authtoken <token>   # https://dashboard.ngrok.com/get-started/your-authtoken
```

Do not commit the authtoken. In the ngrok dashboard, reserve a domain, then set `NGROK_URL` in the repo-root `.env` to that https origin, with no path (`https://your-name.ngrok-free.dev`).

From `server/`, in two terminals:

```bash
npm run server
./dev-tunnel
```

`./dev-tunnel` runs `ngrok http 8787 --url "$NGROK_URL"`. Leave it running. Ctrl-C takes the URL down. The request log is `http://127.0.0.1:4040`.

Then point the existing agent at your domain. This reads `server/tools/*.json`. `record_check_in` posts to `{NGROK_URL}/check-ins`. `record_find_helper` posts to `{NGROK_URL}/find-helper`. A second run updates the same tool ids and prints `agent tools unchanged`. Run it again after a tool JSON change or when the domain changes.

```bash
cd server
npm run setup-agent
```

A request through the public URL should return the local API, not an ngrok HTML page:

```bash
curl -sS -m 15 -X POST "$NGROK_URL/check-ins" \
  -H 'content-type: application/json' \
  -d '{}'
```

That body is missing `incident_id`, so the API returns 400 `{"error":"incident_id must be a number"}`.

Writes are the reducers `insertProfile`, `setContacts`, `createIncident`, `recordCheckIn`, `recordAttempt`, and `setCallId`. `spacetime call rideout <reducer> --server local` invokes one. Redial is not implemented.

## Screens

| Route | What it is |
| --- | --- |
| `/` | **Command center**: live map, resident list, case detail (call transcript, Claude's read, ranked helpers with reasons), activity feed, and responder queue |
| `/stage` | **Demo stage**: resident's phone call, map, and helper's phone side by side. Use this one for judges. |
| `/register` | Resident and helper registration (family, senior center, or self) |
| `/resident/:id` | Full-screen resident phone (e.g. `/resident/margaret`) |
| `/helper/:id` | Full-screen helper phone (e.g. `/helper/daniel`) |

All open tabs on one machine stay in sync, so you can put the map on one monitor and a phone view in another window.
State survives a refresh. Use **Reset** to start over.

## Running the demo

1. Open `/stage` and press **Start simulation**. 6× speed is about right, and 12× works for rehearsing.
2. Satellite hotspots appear in Claremont Canyon. When one is within 1.8 km, the zone activates and the AI agent starts calling residents.
3. **Margaret (resident, LIVE)**: her phone rings. Press answer and the agent's voice plays. Answer out loud with the mic (Chrome), type, or tap a quick reply such as *"I use a walker and my daughter has the car…"*
4. **Daniel (helper, LIVE)**: his phone gets *"Your neighbor 2 blocks away, 84, can't drive… about 3 extra minutes. Can you pick up Margaret?"* Tap **Yes**.
5. Margaret hears: *"Daniel, your neighbor, is coming in a gray Honda CR-V. About 4 minutes."* His route draws on the map and the car drives there.

The rest of the neighborhood runs on a script:

- Harold (wheelchair) is matched with Priya, the only helper whose car fits a wheelchair.
- Sofia declines Linh (Vietnamese speaker), so the request goes to Aisha.
- Walter lives closest to the fire. Every pickup route passes within 500 m of it, so his case goes to **responders** instead of a neighbor.
- James never answers. After two calls his case is escalated.
- Rosa's son is already coming for her, and Esther is driving herself.

**Autopilot** (top bar) also plays Margaret and Daniel, so the whole loop runs hands-free.

## Where the real backend plugs in

The browser engine is a stand-in. The SpacetimeDB module and Cartesia client are in `server/` (see Server above). The UI is not wired to them yet. Everything is designed so you can swap it out piece by piece:

- **`src/store/sim.ts`**: every state change as a named function (`answerCall`, `residentSays`, `respondToOffer`,
  `acknowledgeEscalation`, `registerResident`, `registerHelper`, `tick`, …). These are the backend mutations. Port them to
  Convex mutations or SpacetimeDB reducers, and run `tick` as a scheduled function.
- **`src/store/store.ts`**: `dispatch(name, ...args)` is the only way the UI writes, and `useSim(selector)` is the only way it
  reads. Point `dispatch` at mutations and `useSim` at a live query (e.g. Convex `useQuery`), and the components don't change.
  Today it syncs tabs with BroadcastChannel. Phones on **other devices** need the real backend.
- **`src/lib/ai.ts`**: `interpret(text)` is a keyword stand-in for the Claude call. Its return type, `Interpretation`, is the
  tool schema Claude should fill. It works in English, Spanish, Vietnamese, and Cantonese. Keep the Claude call server-side.
  `agent.*` holds everything the voice agent says, in each language.
- **`src/lib/voice.ts`**: browser TTS and speech recognition for the demo phone. In production the resident gets a real phone
  call (Cartesia voice plus telephony), and the resident phone screen becomes a view of that call's transcript.
- **`src/lib/matcher.ts`**: matching rules. Hard constraints come first: the route stays at least 500 m from every hotspot,
  there's a free seat, and the car fits a wheelchair or pet if needed. Then helpers are ranked by detour, then distance. The
  rules decide; Claude only explains. That way a model mistake can't route anyone toward the fire.
- **`src/data/scenario.ts`**: the neighborhood, people, scripts, and simulated FIRMS hotspots. Road routes in `routes.json`
  were precomputed with OSRM (`node scripts/gen-routes.mjs`). Swap the hotspots for the NASA FIRMS API when ready.

`npx tsx scripts/simulate.ts` runs the whole scenario headlessly and prints the event log. Add `--live` to leave Margaret and Daniel unplayed.

The fire, people, addresses, and phone numbers are all fictional. The map uses Esri Dark Gray Canvas tiles, which need no API key.
