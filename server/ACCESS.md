# Local operator and provider access

Stage 1 uses separate credentials for the operator and Cartesia. This is a
single-laptop access boundary; it is not participant identity verification.

## Integration

Load the environment, then call `readAccessConfig()` once at startup. It requires
`OPERATOR_SECRET` in every mode and `CALLBACK_SECRET` in live mode. The two values
must differ. Do not put either value in browser code or a `VITE_*` variable.

Call `authorizeRequest(req, access)` at the beginning of the API handler, before
reading the body or invoking any mutation. It classifies these exact POST paths
as provider callbacks:

- `/calls/report`
- `/requests`
- `/check-ins`

They require `Authorization: Bearer <CALLBACK_SECRET>`, including in simulation
when used. Every other path, including `/`, `/state`, `/profiles`, and all case
mutations, requires `Authorization: Bearer <OPERATOR_SECRET>`. Missing, wrong or
cross-purpose credentials return 401. Callback paths without configured callback
authentication return 503; they never become public in simulation.

Operator requests with an `Origin` header must match an allowed exact origin.
Defaults are `http://127.0.0.1:8788` and `http://localhost:8788`, using `CONSOLE_PORT`
if configured. `OPERATOR_ORIGINS` can add comma-separated exact origins for the
product UI's server-side proxy. Do not add wildcard origins or paths. Direct
server-side/API clients may omit Origin and still need the operator bearer.

All `/simulation/` API routes require `SIMULATE=1`; call
`assertSimulationEnabled(access)` for any simulation control outside that prefix.
The current HTML simulation box posting directly to `/calls/report` must move to
an explicit operator simulation endpoint. The local proxy intentionally refuses
to forward provider routes or provider credentials.

## Manual console

Use the separate loopback server:

```ts
const access = readAccessConfig()
const consolePort = Number(process.env.CONSOLE_PORT ?? 8788)
const consoleServer = createLocalConsole({
  port: consolePort,
  apiPort: Number(process.env.PORT ?? 8787),
  operatorSecret: access.operatorSecret,
  htmlPath: UI,
})
consoleServer.listen(consolePort, "127.0.0.1")
```

Open `http://127.0.0.1:8788`. HTML uses ordinary same-origin requests. The proxy
adds the operator bearer server-side; it never returns that secret to the browser.
GET `/state`, `/profiles`, and `/intake-configuration` and the known operator POST
routes are forwarded. Unknown paths and callbacks are not forwarded.

Only exact local Host values are accepted. POST requires the matching Origin.
Forwarded headers and cross-origin browser requests are rejected. This prevents
an accidentally repointed ordinary ngrok tunnel from turning the console into an
authenticated public proxy. Never configure the tunnel to this port. The tunnel
must target the API on 8787; operator API requests there still require their own
bearer. Keep SpacetimeDB private to the backend machine as well.

For Vien's frontend, use a server-side proxy holding the operator credential,
bound to the local interface, with an equivalent Host/Origin check. Forward only
operator paths and reject cross-origin writes. Merely adding an origin here does
not grant access, inject credentials, or enable CORS. The actual frontend bundle
must contain no operator or callback secret.

## Verification checkpoint

Before the shared Stage 1 phone test, verify that the local console reads state,
the direct API rejects missing/wrong/callback credentials for state and mutations,
and the console refuses callback paths and foreign Origin/Host. Use the same live
call as the generic investigation checkpoint to confirm Cartesia's separate
callback credential still delivers its report. Code checks alone are not that
live pass.
