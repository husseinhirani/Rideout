# Generic investigation and information calls

Step 4 adds opt-in automatic questions, organizer input and accepted decisions.
See [ADAPTIVE-TEST-HANDOFF.md](ADAPTIVE-TEST-HANDOFF.md) for the additive API
contract and VM verification sequence. Existing manual requests below retain
their behavior when `coordination_enabled` is omitted/false. These Step 4 changes
are implemented separately and await compilation/program/live checks on Vien's VM.

Step 3's human checkpoint (#25) passed; #27 tracks the remaining checkpoints.
With the manual configuration below no adaptive planner runs. Step 5 adds inbound
association and intake, pending VM verification. There is no timer follow-up.
Legacy cases remain readable history.

Run with a published module, private database URL/name, configured provider and
Claude credentials, distinct `OPERATOR_SECRET`/`CALLBACK_SECRET`, and:

```sh
SIMULATE=0 AUTO_COORDINATE=0 COORDINATOR_SCRIPTED=0 INBOUND_REQUESTS=1 npm --prefix server run server
```

The local manual console is `http://127.0.0.1:8788`. API/callbacks remain on
`127.0.0.1:8787`; point ngrok only at that API port. The local console injects
operator authorization server-side. Vien's product UI needs the same server-side
proxy behavior; never put either secret in browser code. See `ACCESS.md`.

Operator API requests use `Authorization: Bearer <OPERATOR_SECRET>`. Callback
routes use the callback secret. The server rejects cross-use. The database must
remain private because its existing public tables are not a second auth boundary.

## Create, inspect, call

`POST /incidents` now requires an explicit objective and stable command ID. This
replaces the legacy `{text}` route that inferred victims and immediately dialed.

```json
{
  "command_id": "client-generated-stable-id",
  "text": "Visitors need information about the event entrances.",
  "objective": "Find out which entrances are accessible.",
  "scope": {"profile_ids": [1]},
  "preferences": [{"profile_id": 1, "call_consent": true}]
}
```

Record consent only when actually supplied. Omitted consent is false. Existing
stored preferences remain unchanged if omitted. The result contains `incident_id`,
`support_case_id`, `input_revision`, and `status`. Creation never dials.

`GET /profiles?filter=<URL-encoded JSON>&limit=50&after_id=0` searches the directory.
Optional `case_id` intersects the query with that case's authorized scope;
`eligible_only=true` excludes ineligible contacts. Filter fields are `profile_ids`,
`radius:{lat,lng,radius_m}`, `related_to_profile_id` and `tags`. Combined filters
intersect. Results contain masked phone suffixes, eligibility reasons and a
pagination cursor. No match is an empty result; search never dials.

`POST /profiles` registers `{name, phone, lat, lng, contact_profile_ids}` for the
original UI registration form and returns `{profile_id}`. It validates coordinates,
phone format and contact references. Registration does not record call consent or
add the person to an investigation's scope.

`POST /simulation/incoming` is an operator-only route enabled only with `SIMULATE=1`.
It accepts incoming report metadata; `profile_id` may substitute for a phone number
so the UI can select a masked directory profile. The server resolves the number
and uses the existing incoming report pipeline. Live provider callbacks still use
`/requests` with callback authentication.

`POST /cases/:id/calls`:

```json
{
  "command_id": "another-client-generated-id",
  "expected_input_revision": 1,
  "profile_id": 1,
  "question": "What do you know about accessible entrances?",
  "context": "The organizer is collecting entrance information.",
  "queued": []
}
```

The result adds `attempt_id` and `status:"queued"`. The worker claims and dials
that exact authorized question. Existing queued work must be explicitly retained
or cancelled in `queued`; the manual console waits for it to leave the queue.
Scope, consent, revisions, destination locks and budgets are rechecked before
dialing. A retry with the same command ID returns the original result. Changed
content under the same command ID returns 409.

`POST /cases/:id/configuration` takes `command_id`, `expected_input_revision`, and
the changed `objective`, `scope`, `policy` or `preferences`. It advances the input
revision. Existing queued work remains visible but cannot dispatch until reviewed.

Step 6 uses that route for `policy:{paused:true|false}` and explicit
`preferences:[{profile_id,call_consent:true|false}]`. Resuming requires fresh
evaluation for automatic cases. Manual cases require an organizer call decision.
These actions do not stop active calls.

`POST /cases/:id/close` takes `command_id`, `expected_input_revision` and `reason`.
It returns `support_case_id`, `input_revision`, `note_id` and `status:"closed"`.
Closure cancels definitely-unsent queued work. Active/uncertain calls and late
reports remain recorded; neither a phone report nor summary acceptance closes a
case. The close reason is an organizer note.

`POST /attempts/:id/cancel` takes the same fields, with the case's current revision.
It returns the case/revision/note IDs, `attempt_id` and `status:"cancelled"`.
Only queued attempts without a claim, provider call ID or report are cancellable.
The cancellation reason becomes organizer evidence for reevaluation. Both routes
return the original result on exact command replay and reject stale/changed input.

Step 6 adds reducers but no tables. Publish the module before restarting the API;
do not reset the database. Compilation and program verification remain on Vien's VM.

`GET /state` preserves the familiar arrays and adds `profile_settings`,
`information_attempts`, `incoming_requests`, server time and read-model version 2.
Generic cases have `kind:"information"`, `goal`, `objective`, `scope`, `policy`
and revision fields. Their `victim_profile_id` is null. Profiles expose
`phone_last4` instead of full numbers. Existing frontend consumers must account
for these deliberate contract changes.

## Phone reports

`POST /calls/report` requires `attempt_id`, `provider_call_id`, `direction:"outbound"`,
`answer`, and optional `concern`. Provider identity fields come from tool bindings,
not voice-model arguments. A saved receipt returns the case ID, `status:"received"`
and a short acknowledgment before Claude interpretation runs. Exact replay is
inert; changed final content or a mismatched provider ID rejects. An early receipt
waits for matching dispatch metadata before interpretation.

`POST /requests` retains the bound inbound envelope: `from_phone`,
`provider_call_id`, `direction:"inbound"`, `text`. It saves the complete account
and returns a neutral receipt, without case details or a promised callback.
Step 5 associates clear updates, requests clarification for incomplete permitted
intake, and leaves unfamiliar or ambiguous accounts in review. Final retries must
repeat the same account; only a `needs_clarification` response permits a revised
complete account under the same provider call ID.
An inbound reporter need not provide an information objective: Claude may derive
one from the reported incident/needs, with that inference recorded in the decision
reason. This does not expand organizer scope or promise assistance. Explicit
objectives remain required for organizer-created investigations via `/incidents`.

## Incoming configuration and review — Step 5

`GET /intake-configuration` returns `revision`, `enabled`, `default_scope`,
`policy`, `coordination_enabled` and `disclosure_facts`. `POST` to the same route
takes `command_id`, `expected_revision` and supplied configuration fields, plus
optional `preferences:[{profile_id,intake_allowed}]`. Defaults disable intake and
automatic calls. Intake permission is separate from call consent. Defaults apply
to newly created cases; they do not reconfigure existing cases.

`POST /incoming-requests/:id/review` takes `command_id`, `expected_revision`,
`decision:"attach"|"reject"`, and `reason`. Attach also requires
`support_case_id` for an open generic case; reject must omit it. Results include
`request_id` and `status`, plus case/note/revision IDs for attachment. Repeating
the same command returns the stored result. Changed or stale commands reject.

`/state` adds `information_intake_configuration`,
`information_incoming_resolutions`, and incoming `review_reason`. Resolutions
link the original request to its note, case, actor and reason. Phone callbacks
map reviewed outcomes to a neutral receipt without exposing those associations.

Publish the additive module before starting this backend. The new tables are
`information_intake_configuration` and `information_incoming_resolution`;
existing records and hosted tools do not need replacement.

Real transport ends only after observing provider `completed` or `failed`.
Report receipt does not imply hang-up. Unknown dispatch is never blindly retried.
In simulated mode only, `/simulation/report` deliberately models both the final
account and hang-up. It is forbidden in live mode.

## Deployment and verification

Retain the SpacetimeDB publishing credential. Anonymous publishing creates a new
owner for each request and cannot later update the same database without the
original token. Publish additively; never use a wipe to resolve a migration error.

Observed checks: existing tests/type checks; real database creation, query,
command/report replay, call binding, durable receipt and real Claude interpretation
with simulated phones; browser filtering, saved result, reload and disconnect.
The human real-phone checkpoint is recorded separately in #27.

After the backend is ready, update the hosted tools once using `setup-agent`,
then read back URLs/auth/bindings. This mutates the shared agent; coordinate one
writer. A configuration readback is not a live-call pass.
