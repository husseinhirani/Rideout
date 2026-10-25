# design.md

## Assistance coordination (current)

New drills atomically create `assistance_session` and initial assessment tasks alongside
the existing case and attempts. A JSON session holds its revision, attributed findings,
reported participant facts and source IDs, tasks, arrangements, messages, human review,
and bounded planning retry state. The database remains the authority for transitions.
`server/shared/assistance.ts` defines and validates these transitions; the process owns
model/provider I/O. Existing cases without sessions retain their earlier behavior.

`POST /calls/coordinate` uses provider callback authentication and verifies the provider
call ID, agent and destination against the saved attempt. `coordinate_call` lets the
hosted voice agent check for tasks and report discoveries without ending a conversation.
Sequence numbers make exact retries idempotent and reject out-of-order overwrites.
The response includes current known facts, an authorized task and the next sequence.
No assignment is delivered after pause, closure, loss of permission or a final report.
A delayed callback may preserve facts but cannot resurrect a cancelled task.

The coordinator wakes on meaningful session revisions. It selects supported information
questions or proposes eligible arrangements, citing current finding sources. Hard gates
check consent/scope, reported location, need, willingness, capacity, vehicle requirements,
supplied access/routes, and existing reservations. Each helper has at most one reserved
pickup. A declined pairing is not automatically repeated. Changed approved pickup details
withdraw the old approval and allow a fresh proposal. Old information planning remains off.

The worker delivers pending tasks through ongoing calls, or atomically queues bounded
follow-up attempts after terminal status and cooldown. There is no speculative redial of
an unknown provider state. A task permits at most two callback attempts and a participant
at most eight calls in a drill. Consent withdrawal and task cancellation are checked at
claim and immediately before provider dispatch. Calls without final reports receive a 15-second grace period, then block their
unfinished tasks for review. Late reports are still processed without restarting blocked
work. Finishing calls cannot receive new tasks. Current permissions for both arrangement
parties are checked again before dispatch, delivery, and milestone acceptance. Temporary
availability restrictions remain separate from withdrawn consent. Deadline failures and unresolved milestones remain visible.

`POST /cases/:id/coordinator` accepts revisioned/idempotent operator actions: message,
approve/reject/cancel arrangement, pause/resume, scenario location-access changes and
planning retry. Messages are persisted and answered by Claude using the current incident;
chat replies alone cannot execute actions. Proposal approval authorizes asking the helper,
then recipient confirmation. Pickup and arrival each require both parties' reports.
Completion means reported arrival in the scenario, not independently verified safety.

`GET /state` exposes `assistance_sessions` without hidden synthetic persona answers.
The dashboard shows proposals/evidence, task progress, reported needs, explicit controls
and persistent coordinator chat. Polling does not duplicate chat entries. Only a changed
message advances the scroll position. New sessions do not use the old scripted UI wave.
Every new wildfire drill includes 12 backend-simulated neighbors; their `mode=simulated` is checked
before provider calls, and their non-dialable synthetic destinations also fail ordinary
contact eligibility. Simulations follow the same task/report/milestone state transitions.

Deployment: publish the module without deleting data, restart API and Vite, then run
`npm --prefix server run setup-agent` to attach `coordinate_call` and its prompt. Do not
apply the hosted prompt before the new callback route is running. No real call is made
by database publication, startup or agent setup; an explicit Start action creates work.
Existing active authorized work can resume after restart. Only saved real participants receive phone calls; the 12 simulated neighbors also
participate in the same coordination workflow and remain labeled as simulated.

## Wildfire drill calling (foundation and compatibility)

`POST /drills/participants` accepts an authenticated operator command ID and
`participants: [{ name, phone }]`. The reducer upserts by normalized phone, updates
names, preserves existing consent, rejects duplicate destinations and records a
private roster of profile IDs in the command log. Configuration places no calls. `npm --prefix server run configure-drill` submits this
operator command from ignored `server/mock/drill-participants.json`; it does not seed
predetermined needs, pairings, or start a drill.
It supports 1–10 participants; real phone numbers are not committed as fixtures.

`POST /drills/wildfire` accepts an operator command ID. New drills always include 12 simulated neighbors; legacy `include_simulated` inputs cannot disable them. Existing command receipts replay their original roster and payload, preserving old successful drills without adding calls. The backend resolves
the saved roster, with the earlier environment/prior-drill participant fallback
for existing installations. The reducer atomically creates one case with the roster
as its permitted scope, and queues one call for each person. Initial calls cover the roster; bounded follow-up calls are included in the
assistance session policy. Existing destination locks, withdrawn consent
and exact command replay remain enforced. The worker staggers provider requests
without waiting for other conversations to end; the calls can run concurrently.
The old information planner remains off; assistance sessions now own bounded follow-up planning.

Each call receives a fictional wildfire drill context. The hosted Tom prompt
introduces the AI assistant and confirms the recipient's name before disclosing
situation details. A wrong/unconfirmed person is recorded as such, never attributed
to the intended recipient. An outbound attempt ID takes priority over provider
direction to prevent an outgoing call from entering inbound intake. Inbound intake
has no predefined missing-child scenario. An explicit hang-up request overrides identification, questions and report saving
on its first occurrence. The agent acknowledges briefly and ends immediately; if
no report was saved, the transcript remains available but the UI must not claim a
saved report. Explicit refusal of future contact is still reported to persist consent
withdrawal, without further questions. Interrupted identification is completed briefly on the next turn,
unless the person asked to stop. Questions are not restarted once finished. The
final goodbye is spoken once; end_call has pre-tool speech disabled. Voicemail
skips the identity flow and records not reached, without an invented identity concern.

Report interpretation receives the call context so drill answers remain hypothetical.
It preserves stated needs and unresolved questions without inferring comprehension,
medical or language problems or prescribing follow-up that nobody requested.
This affects new interpretations; existing saved accounts are not silently rewritten.

The Checks board shows outgoing calls and the facilitator. Accepted/check-in summary
cards and the case/timer/mode pills are removed in both live and offline layouts.
Mock rows remain individually labeled. Not-reached outcomes use the missed-call color
and label even when the phone transport ended normally. Notifications share one
bottom-right portal stack above modal backdrops, with dismissible concern notices;
queued-call confirmations expire after eight seconds.

The live board has a follow-up inbox reconstructed from saved attempts across open
cases. It includes not-reached/no-answer outcomes, unresolved provider status,
calls that ended without a report and reported concerns. A retry in progress does
not erase the previous unresolved result. A later completed result supersedes the
earlier result for that case/person; case closure removes its inbox items. Dismissing
a toast does not affect this inbox. The coordinator conversation includes attributed
call starts and results from the same saved records, so results appear without the
operator typing a message and survive refresh. These are status updates, not new
model decisions or invented reports. SMS, automatic retries and rescue assignments
are not implemented by this display change.

Transcript and recording reads retry transient connection/5xx failures twice with
bounded delays. Cancel/unmount aborts pending reads and retries. Preparing recordings
stop polling after two minutes and can be requested again; playback remains restricted
to ended calls. HTTP and network failures get distinct useful messages. The Vite proxy
uses the configured backend host for upstream requests, including HTTPS tunnels, and
requests API responses rather than ngrok's browser warning page. The reported recording
failure recovered after a browser refresh; authenticated reads of that saved transcript
and WAV succeeded. No provider recording loss was observed.

Use `npm --prefix server run setup-agent` to apply the tracked prompt and tool
configuration to the hosted agent, preserving unrelated voice configuration.
The latest investigated call used an older hosted missing-child prompt despite a
correct wildfire task. Hosted settings must be read back after setup, not inferred
from local source. Database module publication is required for roster and multi-call
reducers; no table/schema changes are introduced.

`GET /state` includes the participant names, count and readiness, with no phone numbers. The UI keeps an uncertain
start command in session storage so retry/refresh cannot create a second case.
The outgoing row uses the existing backend profile/attempt join. Readiness uses
that same participant resolver. If initial setup is missing, clicking the menu
shows an explanation instead of silently doing nothing. Consent and duplicate-call
checks remain enforced by the reducer.

A fresh browser page starts with zero outgoing calls unless a queued, dispatching,
active or unresolved call needs attention. Completed cases remain selectable under
Map → Previous cases. New cases opened during the session take focus; finishing a
call does not clear the current view. This separates history from a new drill
without deleting any database records.

`GET /state` also returns saved wildfire drill case/profile IDs and start times
from the existing operator command log. The UI reconstructs the existing 12-person
mock wave (plus its three scripted follow-ups) from that time, below the real
participants. Refreshing preserves the script's elapsed time. Mock rows and the
combined counts are explicitly labeled; they never enter the directory, evidence,
reports, or dispatch worker. Only the configured participants receive phone calls.

Before any real outbound call or batch is sent, the shared provider client ensures
the configured Cartesia agent has an event webhook at `NGROK_URL` + `/calls/events`. It creates and attaches
one if absent, reuses the matching URL, and refuses to replace another destination.
The webhook secret must match `CALLBACK_SECRET`; after changing that secret, update
it in the agent's webhook settings too. Keep `ngrok http 8787 --url=crawlers-quail-unwieldy.ngrok-free.dev` running.

`POST /calls/events` checks `x-webhook-secret` and the configured agent. Spoken
`call_turn` events are deduplicated by turn ID and retained in a bounded, two-hour
memory cache. `GET /attempts/:id/transcript` verifies the provider call's agent,
destination and attempt binding before returning either live turns or the stored
provider transcript. The expanded UI polls every two seconds while active and
five seconds after ending until a saved transcript arrives. Provider history
restores completed conversations after server restart; live delivery requires the
tunnel. Transcripts are display data, distinct from reports and model evidence.

`GET /attempts/:id/audio` verifies the same binding and refuses playback until the
provider reports a terminal status. The recording button is shown only for ended
real calls. It retries while Cartesia prepares the WAV, then plays the recording.
Closing the row or stopping playback releases local audio resources. No active-call
listening button or second-call action appears while the agent is on the phone.

Provider reference: [turn webhooks, transcripts and recordings](https://docs.cartesia.ai/line/infrastructure/observability).

## UI/backend integration

The integration branch combines the dashboard at `3a5b293` with the generic
backend at `f453df8`. The product UI now uses `INFORMATION-API.md`: generic
incident creation, directory filtering, manual calls, decisions, organizer input,
review, settings, consent, pause/closure and phone intake configuration. No backend
schema or provider configuration changes are needed for the UI migration.

The loopback Vite proxy injects only `OPERATOR_SECRET`, checks Host/Origin and
forwarded headers, and exposes only operator API paths. Configure port 5173 in
`OPERATOR_ORIGINS`. Live/offline selection is explicit; a failed poll preserves the
last snapshot and disables mutations. Commands retry an uncertain response with
the same ID and payload. Settings drafts preserve their original revision so new
evidence cannot be silently overwritten. The map uses stored coordinates and
suppresses fictional household descriptions in live mode. Backend decisions and
transport/report states replace legacy assignments and invented review timers.

The HTML console remains available. Browser fixture checks establish UI wiring,
not real Claude/provider behavior; the combined local live checkpoint is tracked
in #24 and #27.

Strict Claude requests use `messages.create().withResponse()` and parse the
structured JSON text before application validation. This preserves request IDs
without relying on the installed SDK's `parse()` returning an APIPromise at runtime.

## Organizer controls — Step 6

Pause/resume and contact consent reuse the configuration reducer. Explicit close
and queued cancellation require a command ID, current case revision and reason.
They save an organizer note and replayable result. Closing cancels only queued
work with no claim, provider ID or report; dispatching, active and unknown calls
remain tracked. Late reports remain history and cannot reopen a case.

An explicit request not to call again revokes consent for profiles sharing that
phone destination. Renewal requires an explicit organizer action. The console
exposes these controls without clearing stored evidence or pretending to hang up
active calls.

Restart recovery already scans durable work and marks expired dispatch claims
unknown instead of redialing. Reconciliation and report interpretation continue
while paused or closed. If call creation returns an ID but saving it fails, the
worker retries saving that same ID, never the call. A crash before persistence
can still leave an unresolved dispatch; no automatic redial is permitted. A
pause/close racing after the final eligibility check cannot atomically prevent an
external request already being started.

No tables or future-review timers are added. VM verification remains pending.

## Incoming information — Step 5

`/requests` saves the raw account before classification. A unique phone match is
an association hint, not verified identity. Claude can associate a clear update
with an open case linked through explicit contact selection, dispatched calls,
or that caller's original intake. Ambiguous and unfamiliar reports need review.

Phone intake requires an enabled line and a profile with `intake_allowed`.
The caller reports what happened and their needs; they do not need to supply an
organizer's information objective. Claude can derive a narrow information objective
from that account, identifying the inference in its reason. Missing incident
essentials prompt clarification. The organizer's stored scope, policy and disclosure facts
govern the new case. Intake permission never grants call consent.

Two additive tables store line configuration and incoming resolutions. Reducers
check request, configuration and candidate-case revisions before atomically
saving a case/note and resolution. Attach/reject commands are replay-safe and
preserve the original report. Attachment adds unverified evidence without
enrolling the caller; paused cases stay paused. Phone replies disclose neither
case association nor operator decisions. Existing provider bindings are unchanged.

Implementation is source-reviewed; compilation and live verification await Vien's VM.

Tom's hosted instructions guide calm, situation-sensitive acknowledgment and short
questions, without scripted sympathy or promises of safety/help. Immediate danger
must not be mistaken for a dispatched emergency response. This prompt change needs
Vien to run `setup-agent` after active calls finish; tone remains live-unverified.
Conversation guidance now respects an explicit finish, asks for unclear words instead
of inventing a meaning, and uses natural receipt acknowledgments. The built-in
`skip_turn` tool waits quietly when requested, with a 30-second check-in timeout.
Inbound accounts preserve a stated voicemail callback; this does not implement
retrieval of the previous call's context. Voice selection and backend processing
latency are unchanged. Verify the updated behavior in a real conversation after setup.

## Adaptive information path — Step 4

On the separate Step 4 branch, an organizer explicitly enables coordination for
a case and approves disclosure facts, optionally restricted to recipients.
`AUTO_COORDINATE=1` enables the worker; it never enrolls historical cases.
Manual call commands are rejected while that case is automatically coordinated.

The worker brackets snapshot reads with the case revision. Real Claude returns
a bounded plan with evidence references, a complete retain/cancel partition of
queued work, at most two new information calls, and waiting/review reasons.
The commit reducer checks current scope, consent, evidence, disclosure, budgets
and queue state before saving the whole decision and attempts atomically.
Array-size limits are enforced in application/reducer validation; the provider
schema omits `maxItems`, which the live API rejected during the Step 4 checkpoint.
Claims do not dirty the case, so one claim does not invalidate a sibling call.
New answers and organizer input do dirty it. There is no timed follow-up here.

The additive `information_planning` table stores opt-in, disclosure facts and
bounded revision-specific failure retries. `information_decision` stores accepted
plans, model/request metadata and created attempt IDs. Context is rendered from
approved facts, not free model-written context. Questions remain model-generated
under information-only/disclosure instructions; semantic privacy cannot be
guaranteed by the schema alone. Reports remain attributed claims.

Planning, interpretation and transport reconciliation have separate in-flight
guards. Failed planning cannot stop recording reports or observing hang-up.
An organizer-review decision pauses new calls. Explicit configuration can resume
it. The console displays reasons, evidence IDs and whether the summary is stale.
Inbound association is added in Step 5; final closure remains a later checkpoint.

After three interpretation failures, an operator can explicitly retry the same
saved, matched account via `POST /attempts/:id/retry-interpretation` with a stable
`command_id`. The reducer records the command and resets interpretation retries
only. It cannot redial, replace the receipt, reopen the case or bypass binding.
The console exposes this action only for exhausted, unprocessed matched reports.

See `ADAPTIVE-TEST-HANDOFF.md` for the API and VM checks. This implementation has
been inspected as code only; compilation and runtime checks await Vien's VM.

## Generic information path — Stage 1

Current domain language is in root `GLOSSARY.md`. New investigations use additive
information incident/case records; existing cases, calls and notes remain intact.
The manual console creates a free-text objective, searches profiles without
dialing, and commits an explicit organizer call at the current revision. Calls
share persisted attempts, exclusive claims and destination locks.

Bound raw reports are saved before acknowledgment. Claude interpretation runs
separately from transport polling. A report can be saved while the call remains
active. Both completed and failed provider states are terminal; dispatch
uncertainty never authorizes an automatic redial. Inbound accounts are received
without disclosure and await association; automatic matching is the next stage.

The new live server does not run legacy child-specific intake or planning.
Legacy history is readable; old fixture modules remain available for regression
commands. See `INFORMATION-API.md`, `ACCESS.md` and `PROVIDER-CONTRACT.md`.


## Manual baseline console (issue #16)

`GET /` serves the backend test console, separate from the product frontend.
It shows configured profiles with masked phone numbers, backend mode/database,
attempt and provider IDs, and report status separately from transport. Legacy
attempts without progress rows explicitly have untracked transport; an absent
report does not mean the phone is ringing. Connection loss retains the last
snapshot, shows its age and disables mutations until the next successful poll.
The close button explicitly says "Close case".

Use a dedicated empty test database for the live baseline. Profile seeding refuses
to change an already populated directory and never prints full phone numbers.
Current product scope is GitHub #15; #27 records human test results. These console
changes do not implement the later generic coordinator or establish a live
provider pass.

The first real baseline call exposed a hosted-prompt failure: an outbound call
with an attempt ID followed the inbound closing script and invoked no report
tool. The phone prompt now prioritizes the supplied attempt ID, keeps the question
and context task-specific, and acknowledges saving only after tool success.
Scenario-specific intake instructions and promises of future callbacks were
removed from the phone prompt. This does not generalize the existing intake
interpreter: inbound processing remains disabled for this baseline and is tracked
in #19. A natural correction/refusal is reported as information, not an instruction
to switch workflows. Live retry results are recorded in #27.

The phone identity is Tom, an AI assistant from RideOut. The prompt explains report
submission before waiting and acknowledges only the actual tool result. Setup
enables Cartesia's built-in `end_call`, preserving other system-tool settings, so
Tom can say goodbye and end a completed conversation. This does not shorten the
legacy handler's interpretation-before-response latency; durable early receipt
is part of #22. Hang-up configuration readback and actual live hang-up are separate
verification steps.

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

Historical runtime description: the current generic server rejects scripted
planning. `server:recording` now exits with a retirement message. Real-Claude
simulation uses `server:adaptive:sim`; the old fixtures remain available.

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

The hosted Cartesia phone coordinator uses short, plain, slightly brisk turns and skips unnecessary social filler. This style applies within the current identity, consent, stop-request, reporting and live-coordination instructions; an explicit stop request takes priority over further questions or reports. This prompt is distinct from Claude's planning and briefing prompts.

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
