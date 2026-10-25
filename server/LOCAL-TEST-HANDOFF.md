# Vien: run the Stage 1 checkpoint locally

Tony owns backend implementation. Vien is hosting this test locally and can keep
frontend work separate. Source checks passed at `618511c`; the remaining checkpoint
is a real phone conversation. PR #29 is stacked on #28; this branch contains both.

Tony's remote backend, console, ngrok and SpacetimeDB are stopped. Their data is
preserved. Do not restart them. Local secrets and real-number fixtures are not
committed and must be supplied on Vien's computer.

## 1. Get an isolated checkout

From Vien's existing RideOut checkout:

```bash
git fetch origin
git worktree add --detach ../Rideout-backend-test origin/tony/stage1-integration
cd ../Rideout-backend-test
npm --prefix server ci
```

Use a different directory name if that worktree already exists. This leaves the
frontend checkout and any unfinished changes alone. Tested tooling was Node 24
and SpacetimeDB 2.13; ngrok must also be installed locally.

## 2. Configure private local inputs

Copy the existing credentials into this checkout's root `.env.local` privately.
Required keys:

```dotenv
ANTHROPIC_API_KEY=<your existing value>
CARTESIA_API_KEY=<your existing value>
CARTESIA_AGENT_ID=<the shared agent>
CARTESIA_FROM_NUMBER_ID=<the assigned number>
NGROK_URL=<your actual HTTPS tunnel origin>
CALLBACK_SECRET=<the provider callback secret>
OPERATOR_SECRET=<a different operator secret>
SPACETIMEDB_URL=http://127.0.0.1:3000
SPACETIMEDB_DATABASE=rideout-vien-stage1
PORT=8787
CONSOLE_PORT=8788
SIMULATE=0
AUTO_COORDINATE=0
COORDINATOR_SCRIPTED=0
INBOUND_REQUESTS=1
```

Replace the angle-bracket descriptions with values. Generate a new secret locally
with `openssl rand -hex 24` if needed. Do not post credentials in chat or GitHub.
Exported shell variables take precedence over `.env.local`.

Copy the existing private `server/mock/profiles.json` into this checkout, or copy
`server/mock/profiles.json.example` and edit it. Use the agreed real test numbers.
Names, coordinates and relationships can be fictional. Placeholder numbers are
not dialable. Check which profile corresponds to Tony's intended test phone.

## 3. Start SpacetimeDB — terminal A

```bash
spacetime start --listen-addr 127.0.0.1:3000
```

If Vien already has a local SpacetimeDB on port 3000, use that instance instead of
starting another one. The dedicated database name below separates this test's data.

## 4. Publish, seed and run — terminal B

From the new checkout root:

```bash
spacetime login
spacetime publish rideout-vien-stage1 \
  --server http://127.0.0.1:3000 \
  --module-path server/spacetimedb \
  --delete-data=never

SPACETIMEDB_URL=http://127.0.0.1:3000 \
SPACETIMEDB_DATABASE=rideout-vien-stage1 \
npm --prefix server run seed

SPACETIMEDB_URL=http://127.0.0.1:3000 \
SPACETIMEDB_DATABASE=rideout-vien-stage1 \
PORT=8787 CONSOLE_PORT=8788 SIMULATE=0 \
AUTO_COORDINATE=0 COORDINATOR_SCRIPTED=0 INBOUND_REQUESTS=1 \
npm --prefix server run server
```

Use the retained CLI login; do not publish anonymously. Seeding is only for an
empty directory. On subsequent runs, preserve the existing profiles and skip seed.
Do not use `dev-clean-db`, which wipes data. If a port is occupied, identify the
existing process before stopping it.

## 5. Start ngrok — terminal C

If ngrok has not already been authenticated on this computer:

```bash
ngrok config add-authtoken "YOUR_ACTUAL_NGROK_TOKEN"
```

Then, from the checkout root:

```bash
PORT=8787 ./server/dev-tunnel
```

The helper reads `NGROK_URL` from `.env.local`. It does not read the ngrok auth
token from that file; configure ngrok as above. Only API port 8787 is tunneled.
Console 8788 and database 3000 stay local. Avoid a second tunnel claiming the
same reserved URL.

## 6. Point the hosted agent at this receiver — terminal D

Once the API and tunnel are running:

```bash
npm --prefix server run setup-agent
```

Vien is the single hosted-configuration writer for this test. This command updates
the shared prompt, tools, metadata bindings and callback authentication. If the
tunnel URL or callback secret changes, rerun it after correcting local config.
Read back the configuration with `npm --prefix server run agent:show` locally;
do not paste its complete output into shared messages. Check URLs, bearer auth,
`report_call`/`report_request` bindings and the enabled `end_call` system tool.

## 7. First human checkpoint — one outbound call

Open **http://127.0.0.1:8788** on Vien's computer. Expect REAL CALLS and the seeded
profiles. Coordinate with Tony so he can answer the agreed test phone.

1. Select the intended contact and check the explicit consent box.
2. Enter any incident description and information objective. For example, current
   entrance conditions and which entrances are accessible.
3. Click **Open incident**. This must save a case without calling anyone.
4. Choose the intended contact in the case, enter the question and permitted
   context, and click **Call selected person**.
5. Tony answers naturally, corrects a detail or expresses uncertainty, and lets
   Tom finish. Do not require scripted wording.
6. Verify the raw answer and notes under the correct case. Refresh to confirm
   persistence. Report status and transport status are separate.

Expected: Tom introduces himself as an AI assistant from RideOut, asks the actual
question, explains saving briefly, acknowledges a saved report and ends the
completed conversation. The report should save before Claude interpretation
finishes. The UI should preserve uncertainty; it should show the phone as active
until Cartesia reports terminal status.

Stop here for Tony's feedback. If it fails, capture the relevant error and fix or
report that boundary before adding more features. Do not start adaptive planning.

## 8. After the outbound checkpoint passes

Make one inbound call and give a complete account. It should produce a neutral
saved receipt and appear in the incoming list without disclosing case details.
Stage 1 leaves it awaiting review. Automatic association, new intake interpretation
and adaptive contact selection are the next stage, not expected results here.

## Return this evidence

- Source commit from `git rev-parse --short HEAD` and database name.
- Case/attempt IDs and actual provider call ID; no full phone numbers.
- Whether the report arrived, notes appeared and refresh retained them.
- Whether Tom's greeting, saving acknowledgment and automatic hang-up worked.
- Relevant error/status if anything failed, with credentials redacted.

Update GitHub #27 with observed results. Keep “configured,” “program checked” and
“real phone passed” distinct. Existing 120 tests, type checks and a real-Claude /
simulated-phone database run passed remotely; they do not replace this live gate.
