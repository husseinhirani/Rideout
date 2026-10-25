# RideOut

## Tony's single-call wildfire drill

On `tony/ui-backend-integration`, **Start → Wildfire drill** now queues one call
to the participant configured privately on the backend. In the root `.env.local`,
set `WILDFIRE_DEMO_NAME=Tony Nguyen` and `WILDFIRE_DEMO_PHONE` to the consenting
participant's E.164 number. Keep the number out of committed files. The current
local implementation has Tony's number in ignored configuration; it is not
transferred by Git and must be configured on the machine running the backend.

Publish the updated `server/spacetimedb` module to your existing database using
`--delete-data=never`, then restart the API and Vite. Keep the existing database
and callback tunnel running. Use `SIMULATE=0` for a real call. Clicking Start
creates/reuses the profile and saves one queued attempt atomically; it does not
call other directory profiles. The existing worker places the call. No automatic
follow-up calls are enabled for this initial slice. Existing withdrawn consent
must be renewed explicitly through organizer settings.

Open **Checks → Outgoing calls → Tony Nguyen** for actual call state and the
saved report. **Listen · delayed audio** requests real provider audio; **Mute**
stops playback on this device while the phone call continues. Cartesia may only
make its recording available after hang-up. This control does not establish
live monitoring, and it does not synthesize the transcript. Call states and
reports remain visible even while audio is unavailable.

Only build/type checks have been performed for this slice; the actual click,
phone conversation and audio availability need verification on the running app.

RideOut helps an organizer collect information about an incident. Claude chooses
questions and contacts within an authorized scope; Cartesia conducts phone calls;
reports become attributed evidence for the organizer. Incident details are free
text. The product does not require a particular scenario or participant count.

- `src/`: React operator dashboard and map.
- `server/`: Node API, SpacetimeDB persistence, Claude coordination and Cartesia.
- `server/src/ui.html`: separate backend test console.

## Run the connected UI locally

Use Node 24 and the same checkout for the UI and backend. Preserve local changes
before switching branches.

```bash
git fetch origin
git switch tony/ui-backend-integration
git pull --ff-only
npm ci
npm --prefix server ci
```

Keep private configuration in root `.env.local`. The UI proxy needs the same
`OPERATOR_SECRET` as the backend, plus:

```dotenv
BACKEND_URL=http://127.0.0.1:8787
OPERATOR_ORIGINS=http://127.0.0.1:5173,http://localhost:5173
```

Do not put secrets in `VITE_*` variables. The UI proxy uses only the operator
credential; Cartesia callbacks use the separate `CALLBACK_SECRET`.

If your configured backend and database are already running, restart the backend
after changing `OPERATOR_ORIGINS`, then run:

```bash
npm run dev
```

Open **http://127.0.0.1:5173**. The mode badge distinguishes the connected
backend from UpdatedUI's offline demo. The original UI shows the offline demo
when disconnected; offline actions do not submit backend requests.

For backend startup on an existing configured database:

```bash
# Real Claude, simulated phones: no provider dialing.
SIMULATE=1 AUTO_COORDINATE=1 COORDINATOR_SCRIPTED=0 INBOUND_REQUESTS=1 npm --prefix server run server
```

For a deliberate live-phone session, use `SIMULATE=0` instead. Starting a live
backend can resume eligible work in existing automatic investigations. Keep the
local database private and point the callback tunnel at API port 8787, never the
UI port. See [local setup](server/LOCAL-TEST-HANDOFF.md),
[API contract](server/INFORMATION-API.md) and [access](server/ACCESS.md).
Do not wipe or reseed an existing database. This UI change adds no database schema.

## First UI checkpoint

The product uses the original `UpdatedUI` screens and styles. Backend operations
are translated by `src/updated-ui-api.ts`; the backend still stores generic
investigations. Start retains the original Wildfire drill, Missing child and
Register a neighbor entries. The coordinator also accepts a free-text incident
when no open case is selected.

1. Confirm the badge says **Live**. Check the saved case, reports and notes on the
   map and Checks views.
2. Try Side, Aerial, Nodes and Simple. Select a directory node.
3. Open **Start → Register a neighbor**. Registration saves a profile and its
   contact relationships. It does not grant call consent.
4. Send a coordinator direction on an existing case, then refresh. The saved
   organizer input and coordinator decisions remain in the conversation.
5. Use **Export log** to download the original ZIP with backend state and reports.
6. Inspect a call's details. The original manual-call panel records an organizer's
   separate phone conversation; it does not transfer a Cartesia call into the browser.

Configure contact consent, default contact scope, approved disclosures and automatic
coordination in the backend console at **http://127.0.0.1:8788** before a live call.
New investigations use these defaults; the Wildfire drill entry supplies its map
area as the contact scope. `AUTO_COORDINATE=1` and enabled default coordination are
both required for automatic outreach. Only eligible consenting contacts can be called.
The scenario intake form converts its fields into free-text incident context; it
adds no scenario-specific backend schema or fixed helper count.

The original UI's safety/check-in and helper-acceptance panels read their corresponding
stored records. Generic caller evidence does not automatically populate those legacy
classifications or create ride assignments. Scope changes, incoming association,
pause/resume and the manual information-call form remain available in the backend
console. No database migration or hosted-agent setup is needed for this UI update.

The app opens on the teammate's 3D Side map. Side, Aerial, Nodes and the Simple
toggle use the original map components and assets. Google photorealistic tiles
require `VITE_GOOGLE_MAPS_KEY`; without it the original Esri/OSM view is used.
The map retains the teammate's Rockridge basemap. It plots stored coordinates
within that map's bounds; profiles elsewhere remain visible in Nodes. Nodes use stored
contact relationships and actual attempt states, not invented ride matches. It does not
invent current locations, safe areas or available helpers. Future timed follow-ups
and assistance assignment are not part of this integration.

## Checks

```bash
npm run build
npm test
npm --prefix server run check
```

Progress and remaining live checks: [#27](https://github.com/husseinhirani/Rideout/issues/27).
