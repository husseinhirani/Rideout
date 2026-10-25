# RideOut

RideOut calls neighbors during an emergency, finds the people who need help, and coordinates the neighbors who can help them.

- `src/` is the dispatcher frontend: Vite, React and a three.js map of one Rockridge block. See `DESIGN.md`.
- `server/` is the backend: a Node HTTP API, the SpacetimeDB module, Claude planning and Cartesia calls. See `server/README.md` and `server/RECORDING.md`.

## Frontend

```bash
npm install
npm run dev          # http://localhost:5173
```

With no backend running, the frontend shows the offline demo, which runs entirely in the browser.

## Server

```bash
cd server
npm install
npm test
npm run check
```

Run steps, environment variables and the webhook tunnel are in `server/README.md`. The scripted, persisted recording demo is in `server/RECORDING.md`.
