# RideOut

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

Open **http://127.0.0.1:5173**. Without the backend, the UI shows disconnected
status. It never substitutes the offline story. You can choose the explicitly
labelled offline story yourself.

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

1. Confirm the mode and database in the connection strip. Existing investigations
   should appear in the top selector, with the same reports as the HTML console.
2. Click **New investigation**. Enter an incident and information objective.
   Choose contacts directly or use area, relationship or tag filters. Search never
   calls anyone. Record consent only when the selected people agreed.
3. Leave **Let Claude choose contacts and questions** off for the first UI check.
   Click **Open investigation**. Expect one saved case and no new calls.
4. Open **Coordinator**, save a direction or correction, and refresh. It should
   remain under **Evidence**. With automatic questions off, this does not dial.
5. Open **Incoming reports**. Review an appropriate pending account; choose its
   investigation and give a reason. Expect a persisted attachment or rejection.
6. Open **Organizer controls** to change scope, consent, pause or close. A paused
   case stays paused when evidence/settings change. Closure preserves history.
7. Stop the API temporarily. The dashboard should retain its last real snapshot,
   show its age and disable mutations. Restart it to reconnect.

When ready for one real call, either use **Calls → Call selected person** in manual
mode, or enable automatic questions in organizer controls. With automatic questions
enabled, creating/resuming an investigation may start calls. Confirm the saved
report, provider binding and actual terminal outcome in **Calls**, then inspect the
accepted decision in **Coordinator**. No repeated baseline call is required simply
to review the UI.

The map retains the teammate's Rockridge basemap. It plots stored coordinates
within that map's bounds; profiles elsewhere remain in the directory. It does not
invent current locations, safe areas or available helpers. Future timed follow-ups
and assistance assignment are not part of this integration.

## Checks

```bash
npm run build
npm test
npm --prefix server run check
```

Progress and remaining live checks: [#27](https://github.com/husseinhirani/Rideout/issues/27).
