# design.md

Shared vocabulary, workflow, tech stack, architecture, and decisions. Keep this in sync with the code.

Status markers used below: **Decided** (agreed), **Proposed** (suggested, needs confirmation), **Open** (not decided).

## Coordinator fixture slice (issue #3)

`src/coordinator.ts` builds planning context and validates a complete proposal
against a supplied snapshot. `src/demo-coordinator.ts` runs five independent
fictional snapshots from `mock/coordinator.ts`: initial outreach, not-yet-due
follow-up, new sighting at the due checkpoint, possible find, and closed case.
These snapshot types are internal harness inputs, not a new HTTP/provider schema.

The agent-led demo permits two overlapping helper calls, a 10-second review delay
after acceptance and at most two outbound attempts per helper. Unknown or active
transport blocks another call to that destination. A report does not imply the
transport ended. Invalid proposals reject the entire call set without substituting
another helper. Closed snapshots bypass planning; possible-find evidence alone
does not close an open snapshot. Phone fields are omitted from planner context;
free-text reports are still untrusted data, not an implemented privacy filter.

`planStrict()` reuses the existing plan schema and SDK path but propagates failure
instead of using a fallback. The harness never imports Cartesia or the database,
and never dials or writes rows. Scripted mode illustrates policy with fixed output;
real mode calls Claude. Neither mode implements durable event ingestion, timers,
revision checks or verified parent identity. Those belong to subsequent tickets.

The fixture remains isolated. The automatic runtime below reuses its evaluator
without changing the hosted phone payload.

## Automatic coordination (issue #5)

This opt-in behavior supersedes the legacy dispatcher-only replanning rules below
for enrolled demo cases. `AUTO_COORDINATE=1` and `COORDINATOR_HELPER_IDS=1,2`
enroll newly opened cases with exactly two known helpers. The worker scans every
second and on startup. Existing cases with attempts are not automatically enrolled.
The predefined locations are Park bench and Playground. Structured intake now
comes from the internal case-input operation; phone binding remains pending #6.
Legacy cases retain their original incident text;
incident creation time is not presented as last-seen time.

`case_progress` stores input/evaluated revisions, helper IDs and bounded retry
state. `attempt_progress` stores claims, transport, raw report receipts,
interpretation state and acceptance/review times alongside existing attempts.
Reducers remain the only writes. Multi-query snapshots retry when the revision
changes; accepted plans commit only against their input revision. New input
cancels unclaimed queued work. Claims are exclusive, and uncertain dispatch is
never automatically redialed. Reports and timers cannot declare a real call ended.
Only a provider `completed` status releases a live destination in this slice.

For an enrolled attempt, `POST /calls/report` keeps the existing body and response
but acknowledges a durable raw receipt before interpretation. Exactly one final
report is accepted per attempt: identical replay is a no-op; different content
returns 409. The worker interprets receipts, stores attributed notes, updates
case/incident briefs and reconsiders the case. Briefs use deterministic report
summaries, explicitly labeled unverified. Claude failures execute no fallback
outreach and stop after three failures with persisted backoff. New input can
resume the case. No hosted tool, prompt, authentication or tunnel changes occur.

Follow-up becomes due 10 seconds after receipt of an explicit acceptance, not ten
seconds after dialing. It still waits for the previous call to end. A simulated
final report ends its simulated call. Each helper has at most an initial call
and one follow-up; different destinations can overlap. Legacy attempts have no
verified transport state, so any legacy attempt to the same destination blocks
an automatic claim conservatively. Use a dedicated demo database/helper pool.

`GET /state` adds `coordination` and `attempt_progress`; existing arrays remain.
Publish the additive module before starting this server, even in legacy mode.
Disabling `AUTO_COORDINATE` pauses enrolled cases rather than letting the old
planner take them over. Closing a case prevents new outreach; already active
phone conversations are not terminated. The current manual close route does not
verify parent identity. The internal confirmation operation below records an
original-reporter association and explicit reported reunion; real phone binding
still belongs to #6.

Tests execute the actual reducers in a transactional in-memory host and restart
worker instances over retained rows. They do not prove SpacetimeDB deployment,
real process/database restart recovery, Claude behavior, or phone delivery.

## Persisted recording replay

`COORDINATOR_SCRIPTED=1` selects explicit demonstration planner/interpreter fixtures,
never an automatic fallback. Startup rejects this flag without both `SIMULATE=1`
and `AUTO_COORDINATE=1`. Legacy summary calls are skipped in this mode; durable
coordination reducers still update briefs. Unset the scripted flag for real Claude.

`demo:recording` drives existing HTTP routes against a dedicated local database:
create a structured point incident and a case, submit two explicit acceptances,
record a new playground clue, wait for the real ten-second checkpoint, report a
possible find and manually close as the dispatcher. It labels scripted output,
unverified observations and manual closure. This does not implement inbound
phone intake or parent-identity verification. It never deletes rows or changes
hosted tools. Replays preserve prior closed cases and create a fresh incident.

`GET /state.demo_mode` contains simulate/scripted/auto_coordinate booleans,
database name and helper_ids. The runner refuses to write unless these match its
explicit dedicated database and the helpers have fictional phone numbers.
`seed:recording` inserts two fictional helpers, Morgan as the separate reporter,
and Ava with an empty phone only
into an empty database named rideout-recording-<name>.

## Durable internal case inputs (issue #6)

`shared/intake.ts` is the shared pure completeness check, re-exported by
`src/intake.ts` for callers. It preserves approximate time and self-reported
caller details. `src/case-inputs.ts` now exposes internal intake, update and
reunion operations; no phone route or hosted payload has been wired.

`recordCaseIntake` atomically creates the thin child profile, point incident,
case, original reporter association, initial note, coordinator progress and input
receipt. `case_intake` retains structured details and the original reporter's
configured profile ID separately from the two helpers. `case_input` uses an
opaque application event key to deduplicate delivery; identical canonical input
is inert, and conflicting reuse rejects without writes. Complete intake plus
three distinct configured participant destinations is required before enrollment.

`recordCaseUpdate` accepts the original reporter or a configured helper, adds an
attributed unverified note and advances the revision without making an outbound
attempt. An explicit case reference may identify a closed case for a late report;
without one, association must have exactly one open eligible case. An existing
event receipt preserves the original association on retries even after closure.
No newest-case guessing occurs.

`recordReunionConfirmation` requires the original reporter profile and explicit
child-identity/reunion booleans. Both true closes the case, records reported
confirmation and cancels queued work. Partial confirmation remains evidence only.
Late updates stay recorded without reopening. The existing manual operator close
route remains an override; manual closure does not set reunion_confirmed.

These operations enforce participant association, not authentication. Profile IDs
and event keys must come from a trusted application adapter, not model-produced
arguments. The recording uses explicit fictional profile bindings. Current public
reducers retain the baseline database access model; no authentication is added
here, and no real caller identity has been verified. Provider binding/auth and
live routes still await Vien's evidence.

The worker uses case_intake child/time/reporter details in its context, preserving
self-reported attribution. GET /state adds case_intakes; raw receipt payloads are
not added to that response. Deploy the new additive module before running this
server. `demo:case-inputs` exercises the internal operations and existing worker
with simulated calls; `demo:recording` keeps its earlier manual-close flow.

## Inbound provider receiver (issue #6)

`POST /requests` implements the raw-text provider envelope in INBOUND-PROPOSAL.md.
It requires callback bearer authentication and explicit INBOUND_REQUESTS enrollment.
The incoming_request table stores immutable prepared decisions and revisioned
clarifications; the worker reuses case-input reducers with stable receipt keys.
A demo reporter cannot open two concurrent cases. Unknown callers are retained
for review without case disclosure; no review dashboard is added. Raw requests
are omitted from GET /state. Source tool bindings exist but remain unverified on
an actual inbound Cartesia call. PROVIDER-HANDOFF.md lists the deployment steps.

## Local configuration

The backend loads `.env.local` before `.env`, checking the working directory,
repository root and server directory in that order. Exported process variables
always take precedence. Both local files stay gitignored.

## 1. Glossary

Use these terms exactly in code, comments, UI copy, and docs.

| Term | Definition |
|---|---|
| **Profile** | A stored record of a person or entity: name, phone, location, needs, `contact_profile_ids`. Contacts are family or neighbors, and they are the first call list for that person. A missing person is a thin profile with an empty phone, so she is never dialed and never swept into `incident_person`. |
| **Incident** | Whatever the dispatcher says is happening. Fields: `description` (the dispatcher's sentence, verbatim), `type`, `area {lat, lng, radius_m}`, `brief`, `status` `active` or `closed`, `created_at`, `ended_at`. An area incident has a radius. A single-person incident has radius 0. |
| **Victim** | A person who needs help. One victim is one support case. On an area incident a victim comes from a check-in that says they cannot get out, stored as that person's incident status `victim`. On a single-person incident the dispatcher's sentence names the victim. |
| **Helper** | A person the dispatcher sends to a victim. The agent never picks one and never dispatches one. Not stored on the support case. |
| **Support case** | One victim's case during an incident. Fields: `incident_id`, `victim_profile_id`, `goal` (what we are trying to find out), `brief`, `status` `open`, `needs_dispatcher`, or `closed`. |
| **Attempt** | One outbound call to one person on a case: `profile_id`, `ask`, `call_id`, `answer`, `concern`, `created_at`, `outcome` `null` (ringing), `answered`, or `no_answer`. A case can have many attempts ringing at once. |
| **Note** | One fact on a case: `support_case_id`, `attempt_id` (optional), `source` `call`, `dispatcher`, or `concern`, `text`, optional `lat`, `lng`, `radius_m`, `at`. Notes carrying coordinates are what the authority map renders. Notes with source `concern` are the safety flags. |
| **Brief** | What the dispatcher reads. A JSON string `{"summary": "...", "suggestions": [...]}` stored on `support_case.brief` and `incident.brief`. Regenerated after every answer. |
| **Ask / context** | `ask` is the question put to one person on one call. `context` is the only thing that person may be told. Both are written by `plan()` and built server-side. `context` never contains a phone number or a street address. |
| **Dispatcher** | The human operator, also called the authority. Describes the incident in plain language, reads the brief, decides what happens. Only dispatcher input re-plans a case. Does not approve each support case opened from an explicit help request. |
| **Disaster** | The real-world event (example is simulated wildfire) affecting an area. |
| **Alert** | A notification raised by the alert feed that a disaster may be threatening an area. It is for the authority to review. |
| **Help signal** | An explicit check-in answer that the person cannot get out. That answer sets the incident person to `victim` and opens a support case. |
| **Candidate** | A profile the server has filtered as callable for a case. `plan()` picks from the candidate list and writes the wording. |
| **Availability** | A helper is *willing* and has the *minimum capability* to support the victim *without risk to themselves*. |
| **Escalation** | For now assume authority is the highest level of order and escalates mean delagating task / input to them for action. |
| **Portal** | The communication layer (voice, SMS, images) between the system and people. |
| **Coordinator** | The AI agent: Claude, running in `server/src`, outside the call. It decides who to call and what to ask, turns answers into notes, and writes the brief. It gathers and synthesizes. It never dispatches help and makes no final decisions. |
| **Case log** | `note` rows. Attempt rows are call state, not a log. |

## 2. Architecture

```
   Victims ----+                                   +---- Dispatcher
               |                                   |  (describes incident,
   Contacts ---+--> Comms portal <--> Coordinator <-+   reads brief, decides
                       |  ^                |            what happens)
                       |  +-- dispatcher input re-plans --+
                       v                   v
        +----------------- Server system (source of truth) -----------------+
        | Alert feed | Help signal | Profiles | Candidates | Cases, attempts, notes |
        +--------------------------------------------------------------------+
              ^
        Live source (NASA hotspots, county alerts)
```

Responsibilities:

- **Comms portal**: sends and receives calls (SMS and images later), speech in and out. Just translation and connection.
- **Coordinator (agent)**: reads the dispatcher's sentence, picks who to call, writes what to ask, turns answers into notes, writes the brief. It gathers information. It never dispatches help.
- **Dispatcher**: describes the incident, reads the brief, decides what happens. Their input is the only thing that re-plans a case. An explicit help request opens the support case without them.
- **Server system**:
  - *Alert feed*: ingests the live source and raises an alert to the dispatcher. No agent involvement.
  - *Help signal*: an explicit check-in of `victim`, which opens a support case.
  - *Profiles*: relational storage of users and entities, with location lookup.
  - *Candidates*: deterministic filtering of who may be called, in code, before the agent sees the list.
  - *Cases*: incident and support-case state, attempts, and notes.

## 3. Workflow

The agent system is an information network. It calls people to gather information, synthesizes it, and presents it to the dispatcher. Claude decides who to call and what to ask, Cartesia does the talking, the dispatcher decides what happens.

1. **Incident.** `POST /incidents { text }`. `interpretIncident` turns the dispatcher's sentence into `{type, lat, lng, radius_m, victims[]}` and `createIncident` stores it, with the sentence verbatim in `description`. The structured body `{type, lat, lng, radius_m}` is still accepted as a bypass, so seeding and tests keep working. An area incident marks every dialable profile in the radius `checking_in` and places one check-in call each. Profiles are written with `insertProfile`. `npm run seed` loads `mock/profiles.json`.
2. **Check-in.** Cartesia calls that list. The agent POSTs the answer to `POST /check-ins`. `safe` only updates the person. `victim` updates the person and opens a support case. No answer stays `checking_in`.
3. **Plan.** Per case, the server builds the candidate list in code, then `plan()` picks who to call and writes the `ask` and `context` for each pick. The server inserts one attempt per pick and dials them all in parallel.
4. **Answer.** Each call posts to `POST /calls/report`. `interpretAnswer` turns what the person said into notes, a concern, and whether they were reached. `brief()` regenerates. Nothing blocks on the calls still ringing, so there is no round state to get stuck in. A per-call 90s `setTimeout` deadline writes `no_answer` if a call never reports. A late report still lands, because `recordAnswer` never overwrites an `answered` outcome.
5. **Dispatcher input.** `POST /cases/:id/input` writes the note, runs `plan()`, inserts the new attempt rows, and responds before dialing, so the dispatcher never waits on in-flight calls. Dispatcher input is the only thing that re-plans. Everything else only adds facts. Someone calling in to say "check the creek" becomes a suggestion in the brief, and only the dispatcher turns it into calls. The rule is enforced by which route is hit, not by a prompt.
6. **Decide.** The dispatcher reads the brief and decides what happens. `POST /cases/:id/close` accepts. The agent never dispatches help.

One structure, two sizes. The only difference between the two demos is how many cases an incident has.

| Dispatcher types | Incident | Cases |
|---|---|---|
| "wildfire in Altadena, about 2km around Lake and Altadena Dr" | area, radius 2000 | one per person whose check-in says they cannot get out |
| "7-year-old Ava Reyes missing near Loma Alta Park since 3pm" | point, radius 0 | one, on Ava |

A missing child is a thin profile: name, empty `phone`, last known lat/lng, and `contact_profile_ids` set to the family, which is the call list. No schema break.

Incident-person status: `checking_in`, `safe`, `victim`. Support-case status: `open`, `needs_dispatcher`, `closed`. Attempt outcome: `null` (ringing), `answered`, `no_answer`.

## 4. Tech stack

| Layer | Choice |
|---|---|
| Server | TypeScript. Cartesia client in `server/src`. SpacetimeDB module in `server/spacetimedb` |
| Coordinator (planning, synthesis) | Claude, model `claude-opus-5` through the Anthropic SDK. It runs in `server/src`, outside the call |
| In-call language model | Cartesia's hosted model on the agent. The live agent runs `gpt-5.5`. Claude is not in the call |
| Voice (speech in/out) | Cartesia Managed Agents |
| Telephony (calls, SMS) | Cartesia outbound calls. Check-in answers come back on `POST /check-ins`, case answers on `POST /calls/report` |
| Backend / database | SpacetimeDB 2.0, TypeScript module |
| Disaster detection source | NASA FIRMS hotspot data and/or official alerts (proposed)|
| Maps / routing for ETA and safety | To be chosen |
| Authority dashboard | Simple web UI: alerts, cases, live map, guidance. The test UI is `src/ui.html`, served at `GET /` |

Notes:

- Backend choice should support a regular schema for profiles, location lookup, and real-time updates for the live case view.
- Sponsor tools must do real work in the product, not be decorative.
- Phone calls use the existing Cartesia hosted agent (`CARTESIA_AGENT_ID`). The attempt stores the live `agent_call_id` in `call_id`. An explicit help request opens the support case. The dispatcher decides what happens.
- A developer verifies a hosted-agent phone call from `server/` with `npm run call -- +E164`. The script posts one call to `POST /agents/calls` for `CARTESIA_AGENT_ID`, from `CARTESIA_FROM_NUMBER_ID`, with the check-in dynamic variables, meaning an empty `attempt_id`. It prints `agent_call_id`. It does not open a support case.
- The HTTP server is `npm run server` in `server/`. It listens on `127.0.0.1:8787`. A phone that starts with `+1555555` is not dialed. `ANTHROPIC_API_KEY` goes in the repo-root `.env` next to the `CARTESIA_*` vars and `NGROK_URL`. `SIMULATE=1` makes `placeCall` log and return a fake call id instead of dialing, so the whole loop runs in seconds without spending call minutes. The test UI then shows a "what did they say?" box per ringing attempt.
- Cartesia webhook tools need a public HTTPS URL. `./dev-tunnel` runs ngrok in front of port 8787. `NGROK_URL` is that https origin. `npm run setup-agent` reads `server/tools/*.json` and upserts those tools onto `CARTESIA_AGENT_ID`, then patches that hosted agent's instructions, initial message, and dynamic-variable placeholders from `server/src/setup-tools.ts`. Existing voice and other config fields are preserved. `record_check_in` posts to `/check-ins`. `report_call` posts to `/calls/report`. `record_find_helper` is deleted. Ids sent on the dial are dynamic variables and are not in the tool's required list, because Cartesia rejects a required dynamic variable. A matching tool name is updated. A missing name is created. The hosted agent is shared by every call using that `CARTESIA_AGENT_ID`; matching webhook tool definitions are also updated and may be shared by other agents attached to the same tool ID. `POST /v1/agents/tools` on every run would duplicate the tools. `npm run agent:show` prints the live agent config.
- SpacetimeDB writes are reducers: `insertProfile`, `setContacts`, `createIncident`, `recordCheckIn`, `setIncidentBrief`, and in `apis/support-cases.ts` `openCase`, `addAttempt`, `setAttemptCall`, `recordAnswer`, `addNote`, `setBrief`, `setCaseStatus`. `createIncident` accepts `radius_m = 0` and skips profiles with an empty phone in the radius sweep. `recordAnswer` never overwrites an `answered` outcome, so a late report still lands after the deadline already wrote `no_answer`. Redial is not implemented. A check-in that nobody answers stays `checking_in`.

Routes:

| Route | Note |
|---|---|
| `GET /` | The test UI, `src/ui.html` |
| `GET /state` | Every row the UI needs in one poll: profiles, incidents, incident people, cases, attempts, notes |
| `POST /incidents` | Takes `{text}`. Structured `{type, lat, lng, radius_m}` still accepted |
| `POST /check-ins` | Unchanged shape. `victim` opens a case and starts the loop |
| `POST /calls/report` | The `report_call` webhook, outbound and inbound |
| `POST /cases` | Dispatcher opens a case directly |
| `POST /cases/:id/input` | Dispatcher free text. Re-plans, responds before dialing |
| `POST /cases/:id/close` | Accept |

## 5. Agent

Four Claude calls, sequenced by server code in `src/agent.ts`. Nothing else talks to Claude.

| Call | In | Out |
|---|---|---|
| `interpretIncident` | The dispatcher's sentence plus known profiles (id, name, lat/lng) | `{type, lat, lng, radius_m, victims[]}` |
| `plan` | Case facts, a pre-filtered candidate list, an optional dispatcher instruction | `[{profile_id, ask, context}]` plus a reason |
| `interpretAnswer` | What the person said on the phone | Notes (text, optional lat/lng/radius), a concern, whether they were reached |
| `brief` | Every fact on a case, or across an incident | A summary plus suggested next steps |

`brief()` serves both altitudes, the incident header and the case detail. Its output is stored as a JSON string in `support_case.brief` and `incident.brief`, shaped `{"summary": "...", "suggestions": [...]}`.

The candidate filter is code, not prompt. Before `plan()` runs, the server builds the list: the victim's `contact_profile_ids` first, then other people on the incident, minus the victim, minus anyone whose own incident status is `victim` because they need help themselves, minus non-dialable phones, minus anyone already attempted on this case. Claude picks from that list and writes the wording. An out-of-range pick falls back to the list in order, so the loop still works when the Claude API is down. Every Claude call has a fallback.

Two Cartesia webhook tools, not one. `record_check_in` stays for the triage sweep on an area incident, because triage needs a safe/victim classification. `report_call` is new and is what every case call uses: it posts the raw answer and any concern to `POST /calls/report`. `record_find_helper` is deleted, because picking a helper is the dispatcher's job.

Dynamic variables on every dial: `attempt_id`, `person_name`, `ask`, `context`. `ask` and `context` come from `plan()`. `context` is the only thing the person may be told, is built server-side, and never carries a phone number or an address. A check-in dial sends an empty `attempt_id`, and the agent instructions use that to choose between the two tools.

The hosted Cartesia phone coordinator uses short, plain, slightly brisk turns and skips social filler. Few-shot examples in `setup-tools.ts` demonstrate wording only; call branching, required questions, data collection, and tool use remain defined by the existing instructions. This prompt is distinct from Claude's planning and briefing prompts.

## 6. Decisions

| # | Decision | Why |
|---|---|---|
| 1 | Primary interface is phone calls | Target users are elderly or disabled and often not app users, and in emergency this is quickest interface |
| 2 | An explicit check-in help request opens a support case without authority approval. Escalation still waits for the authority | Approving every case does not scale to a large incident. Escalation stays a human decision |
| 3 | One Cartesia Managed Agent already exists. Its id is stored in `CARTESIA_AGENT_ID` and reused for every call. The server does not create an agent | Cartesia assigns the agent id once. Each dial is a new `agent_call_id` stored on the attempt |
| 4 | Server and SpacetimeDB module are TypeScript | SpacetimeDB 2.0 modules can be TypeScript. The Cartesia client and the module both live under `server/`. The module directory has its own `package.json` because `spacetime publish` detects TypeScript only from that file. Dependencies are installed with `npm install` in `server/` |
| 6 | Each attempt stores its own `call_id`. A case can have many attempts ringing at once, and nothing blocks on a call in flight | Cartesia variable values apply to the current call only. Parallel dialing is the point, and one open attempt per case was the thing stopping it |
| 5 | Outbound phone calls use the existing Cartesia hosted agent via `POST /agents/calls`. The server supplies the destination number. `npm run call -- +E164` is the developer check for one check-in call | Cartesia dials and speaks. The script does not open a support case or choose a helper |
| 7 | The local API stays HTTP. ngrok is the public HTTPS URL. `npm run setup-agent` upserts `server/tools/*.json` and patches the hosted prompt on the existing agent; it does not create a duplicate tool when that name already exists | Cartesia cannot call localhost. `POST /v1/agents/tools` creates a new tool every time. The hosted voice remains unchanged |
| 8 | The agent gathers information and the dispatcher decides what happens. The agent never dispatches help | A hackathon demo cannot responsibly auto-dispatch a person toward a disaster, and a human dispatcher is the real-world authority |
