# Inbound integration — implemented source, live verification pending

Tony implemented Vien's `POST /requests` proposal on top of the durable case inputs.
The earlier `/inbound/intake` proposal is superseded. No hosted configuration was
changed during this implementation. See [PROVIDER-HANDOFF.md](PROVIDER-HANDOFF.md)
for setup and the remaining live checks. The frontend team retains UI ownership.

## Internal application input

The four agreed essentials are represented as six text fields because the child
name/description and caller name/relationship must each be present:

```json
{
  "child": {
    "name": "Ava",
    "description": "Age 7, red jacket",
    "last_seen_location_id": "park-bench",
    "last_seen_time": "about 3 pm"
  },
  "reporter": {"name": "Morgan", "relationship": "mother"}
}
```

Allowed locations are `park-bench` and `playground`. The time is retained as
reported, not replaced with incident creation time or parsed into invented
precision. Missing, blank, non-text or explicit unknown values require
clarification. This is field validation, not proof the statements are true or a
complete semantic check of arbitrary conversation text.

`assessDemoIntake(input)` returns either `complete` with normalized input and
reporter attribution `self_reported`, or `needs_clarification` with fixed questions.
It ignores caller-supplied `verified` flags/profile IDs. A complete validator result alone does not authorize outreach or verify identity.
The internal createCaseFromIntake service combines complete details with configured
reporter/helper IDs and an application event key to atomically create a case.

## Implemented provider boundary

`POST /requests` requires `Authorization: Bearer <CALLBACK_SECRET>` and:

```json
{"from_phone":"<system__caller_id>","provider_call_id":"<system__conversation_id>","direction":"inbound","text":"<complete caller account>"}
```

Only `text` is model-supplied. `report_request.json` binds the other fields; missing,
literal-placeholder or invalid bindings reject before case creation. These system
variable bindings still require a real inbound capture. Caller number is an
association hint, not proof of identity.

The response contains only `request_id`, `status`, and a short `reply`, never case
facts or a case identifier. Status is pending/prepared, needs_clarification,
recorded, or needs_review. The receiver durably saves input, then waits up to 20
seconds for processing; work continues on the startup/one-second scan if needed.
Repeat the exact body to retrieve progress. After needs_clarification, submit the
complete account including the answer; other changed-text retries return 409.

One row per provider call retains the raw input and accepted decision. A revision
check saves the action before execution; stable case-input keys recover a crash
after mutation but before completion. Retries back off and stop after three
failures. A reporter can have only one open demo intake case.

Enable with INBOUND_REQUESTS=1, AUTO_COORDINATE=1, COORDINATOR_REPORTER_ID and exactly
two COORDINATOR_HELPER_IDS. Only uniquely matched configured participants can
change cases. Unknown/ambiguous callers are retained for review without outreach
or case disclosure. Review receipts are queryable in incoming_request; no new
operator review UI is included. A helper's possible find cannot close a case;
only the original reporter's explicit child identity and physical reunion
confirmation does. This is reported confirmation, not verified caller identity.

The existing /calls/report and empty-attempt outbound check-in remain separate.
The database retains its baseline public-table/reducer access model; keep its
endpoint local/private for this demo. Callback bearer auth is not database access
control. Raw incoming requests are deliberately omitted from GET /state.
