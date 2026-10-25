# RideOut

RideOut calls neighbors during an emergency, finds the people who need help, and coordinates the neighbors who can help them.

- `src/` is the dispatcher frontend: Vite, React and a three.js map of one Rockridge block. See `DESIGN.md`.
- `server/` is the backend: a Node HTTP API, the SpacetimeDB module, Claude planning and Cartesia calls. See `server/README.md` and `server/RECORDING.md`.

## Frontend

```bash
npm install
npm run dev          # http://localhost:5173
```

With no backend running, the frontend shows the offline demo, which runs entirely in the browser,
labeled "Offline demo · not connected".

### Live mode

The dev server proxies the backend's routes (`vite.config.ts`). Point it at a running backend with
`BACKEND_URL` (default `http://127.0.0.1:8787`). If the backend sets `CALLBACK_SECRET`, give the dev
server the same value; it adds the bearer for local requests, so the secret never reaches the browser.

```bash
BACKEND_URL=http://127.0.0.1:8791 CALLBACK_SECRET=recording-only-secret npm run dev
```

With a backend connected, the dashboard runs from `GET /state`: the case card, the three desks
(calls, inbound requests, case input), the wildfire check-in sweep and registration. Simulation
controls appear only when the backend reports simulated calls. The header pill switches back to
the offline demo.

A scripted Rockridge setup with no Claude or phone calls, from `server/`:

```bash
spacetime publish --server http://127.0.0.1:3303 --module-path spacetimedb rideout-recording-rockridge
SPACETIMEDB_URL=http://127.0.0.1:3303 SPACETIMEDB_DATABASE=rideout-recording-rockridge npm run seed:rockridge
# use the printed COORDINATOR_HELPER_IDS and COORDINATOR_REPORTER_ID
PORT=8791 SPACETIMEDB_URL=http://127.0.0.1:3303 SPACETIMEDB_DATABASE=rideout-recording-rockridge \
  COORDINATOR_HELPER_IDS=2,6 COORDINATOR_REPORTER_ID=13 INBOUND_REQUESTS=1 \
  CALLBACK_SECRET=recording-only-secret npm run server:recording
```

Tony's recordings (`demo:recording`, `demo:inbound`) drive the same dashboard; see `server/RECORDING.md`.

```bash
npm test             # frontend adapter tests (vitest)
```

## Server

```bash
cd server
npm install
npm test
npm run check
```

Run steps, environment variables and the webhook tunnel are in `server/README.md`. The scripted, persisted recording demo is in `server/RECORDING.md`.
