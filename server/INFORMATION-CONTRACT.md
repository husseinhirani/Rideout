# Generic information cases — Stage 1

This additive path stores free-text incident context and a separate case objective.
It creates no victim/child profile and makes no incident-specific inference.
Legacy cases remain historical records. Both case kinds share numeric ID allocation,
attempts and notes; generic cases have no legacy `case_progress` row and cannot enter
the legacy automatic planner.

The organizer creates a case with `command_id`, `text`, `objective`, optional `scope`,
optional `policy`, and explicit profile `preferences`. Omitted scope permits nobody;
explicit `{}` permits the consenting directory. Filters (IDs, radius, relationship,
tags) intersect. Directory coordinates retain provenance and are not current sightings.
Call consent defaults false. A query never dials. Phone numbers stay out of directory
responses; the authenticated server resolves the destination for execution.

`POST /cases/:id/calls` commits an organizer-sourced call intent with `command_id`,
`expected_input_revision`, `profile_id`, `question`, and optional empty `context`.
If queued attempts already exist, `queued` must retain/cancel each exactly once.
Configuration/evidence leaves queued records intact but blocks stale claims. Retained
work keeps its authorized question/context. The stable command receipt returns the
same result for a retry and rejects changed content under the same command ID.

Claims recheck scope, consent, revision, budgets and destination occupancy. A report
is not terminal transport. Legacy calls need a verified terminal observation before
reusing their destination. Definitely-unsent claims may be released by their token;
expired claims become unknown, never automatically redialed.

Outbound receipt fields are `attempt_id`, `provider_call_id`, `direction:outbound`,
`answer`, and `concern`. The receiver persists before returning `status:received`.
An early callback waits for its provider ID to match the saved dispatch ID. A mismatched
ID cannot enter evidence. Interpretation creates attributed unverified notes once;
explicit do-not-call revokes consent. Interpretation errors have bounded retries and
remain visible, without substituting a fabricated answer. Provider completed/failed
observations are recorded independently and preserve any missing report.

The Node exports in `src/information.ts` provide reads and command receipt lookup.
HTTP authentication, worker scheduling, test console and live phone verification are
integrated separately. No additive deployment or real call is claimed by these source
checks. Stage 1 must pass the human gate before adaptive planning begins.
