# RideOut — frontend

During wildfire evacuations, cars with empty seats drive past people who can't leave. RideOut calls registered
residents, finds the ones who can't get out, and asks a neighbor who is already leaving (and whose route passes
the home) to pick them up. If nobody can help in time, the case goes to responders.

This is the demo frontend. It runs entirely in the browser with a simulated fire, so it works with no backend.

```bash
npm install
npm run dev          # http://localhost:5173
```

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

The browser engine is a stand-in. Everything is designed so you can swap it out piece by piece:

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
