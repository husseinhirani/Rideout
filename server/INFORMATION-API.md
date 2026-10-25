# Generic investigation and information calls

Step 4 adds opt-in automatic questions, organizer input and accepted decisions.
See [ADAPTIVE-TEST-HANDOFF.md](ADAPTIVE-TEST-HANDOFF.md) for the additive API
contract and VM verification sequence. Existing manual requests below retain
their behavior when `coordination_enabled` is omitted/false. These Step 4 changes
are implemented separately and await compilation/program/live checks on Vien's VM.

The current Step 3 human checkpoint is GitHub #25, tracked in #27. With the
manual configuration below no adaptive planner runs. There is no timer follow-up
or inbound case matching in either current slice. Incoming
accounts are saved for review. Legacy cases remain readable history.

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
Stage 1 leaves association to the next stage. The console shows these reports.

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
