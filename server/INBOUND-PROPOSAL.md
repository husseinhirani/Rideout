# Inbound intake handoff — proposal, not an implemented endpoint

Tony owns receiving, validation, case matching and persistence. Vien owns hosted
routing, tools and provider-bound metadata. The frontend team owns the UI.
`src/intake.ts` implements only the internal completeness check below; no route,
phone payload, reducer, hosted configuration or closure behavior has changed.

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
It ignores caller-supplied `verified` flags/profile IDs. A complete result alone
does not authorize outreach, verify identity or create a case.

## Proposed provider boundary for agreement

A separate `POST /inbound/intake` would avoid changing `/calls/report` and the
empty-attempt check-in convention. The following envelope is illustrative;
Vien must confirm which fields can actually be bound by the provider/tool:

```json
{
  "provider_call_id": "<provider-bound call identifier>",
  "direction": "inbound",
  "from_phone": "<provider-bound caller number>",
  "intake": {
    "child": {
      "name": "Ava",
      "description": "Age 7, red jacket",
      "last_seen_location_id": "park-bench",
      "last_seen_time": "about 3 pm"
    },
    "reporter": {"name": "Morgan", "relationship": "mother"}
  }
}
```

The conversation model supplies reported details; it must not invent call/caller
identifiers. Caller number is a lookup hint, not verified identity. No auth header
or signature scheme is selected here. Direct knowledge of a case ID or a claimed
relationship must not grant access to case details or permission to close it.

Suggested responses, pending agreement:

```json
{"status":"needs_clarification","questions":[{"field":"child.last_seen_time","question":"Approximately when was the child last seen?"}]}
```

```json
{"status":"recorded","support_case_id":3}
```

Incomplete intake would return questions without opening a case or authorizing
helper calls. A complete report would atomically store the receipt, reported
facts, original reporter association and case before coordination begins.
If the provider-bound call ID is stable and available, a namespaced final-intake
key derived from it could deduplicate repeated final submissions. Partial
clarification attempts must not consume that final key. Identical final replay
would return the same case; conflicting final content would return 409. None of
this delivery/persistence behavior is implemented by the pure validator.

## Vien's concrete next input

1. Confirm whether the tool can bind call ID, direction and caller number, with a
   redacted captured request or exact supported binding example.
2. Confirm or amend the separate intake endpoint/envelope/response above.
3. Specify the callback authentication configuration with a redacted example.
4. Confirm the hosted conversation can use the clarification response and submit
   one final intake once the essentials are present.

After agreement: Tony implements the receiver and atomic deduplication/case
creation; Vien implements the hosted tool/bindings. Existing outbound reporting
must also be shown to reach `/calls/report` successfully.

Later updates and parent confirmation still need an explicit association rule.
Do not select the newest case on an ambiguous phone match. Do not interpret a
helper sighting as reunion or accept an arbitrary caller's claimed relationship
as authorization. No update/confirmation route is frozen by this document.
