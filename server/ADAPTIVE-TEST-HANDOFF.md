# Step 4 — adaptive information gathering

Implementation branch: `tony/adaptive-information`, based on the Step 3 branch.
This is a separate development version. Keep Vien's running Step 3 version until
the outbound saved-report and inbound-receipt checkpoints in #25 pass.

All compilation, program tests and phone tests for this change run on Vien's VM.
No runtime result is claimed from code inspection on Tony's remote workspace.

## What changed

An organizer can enable Claude to choose information questions within a case's
contact scope. New interpreted answers and organizer directions trigger another
decision. Each accepted decision records its evidence, reasons, revision and
created attempts. Queued questions are retained or cancelled explicitly.

The case starts in manual mode unless `coordination_enabled` is explicitly true.
Historical cases are not enrolled automatically. The server also requires
`AUTO_COORDINATE=1` to run the planner or dispatch its calls. Claude failures do
not substitute scripted questions. Reconciliation and report interpretation run
independently of planning.

This step does not add scheduled follow-ups, inbound case association, physical
assignments, or final closure. Waiting for a cooldown does not schedule a future
call: another report or organizer input is needed to reevaluate.

## Contract for Vien's frontend

Existing create/configuration routes gain two optional fields:

```json
{
  "coordination_enabled": true,
  "disclosure_facts": [
    {"id": "briefing", "text": "The organizer is collecting entrance information.", "profile_ids": null}
  ]
}
```

`profile_ids:null` allows that fact for any otherwise permitted contact. An array
restricts it to those profiles. The organizer approves these facts; the model
selects references and the server renders the outbound context. Incident text
and other callers' reports are not automatically approved for disclosure.
The question itself is model-generated and instructed to stay within those
facts; typed fields alone cannot verify every sentence's meaning.

`POST /cases/:id/input` accepts:

```json
{
  "command_id": "client-generated-stable-id",
  "expected_input_revision": 4,
  "text": "Please clarify whether the entrance is accessible to wheelchair users."
}
```

It saves an attributed organizer note and advances the case revision. Replays
reuse the command receipt. It does not change scope, consent or disclosure
permissions. Those changes require the configuration endpoint. Manual `/calls`
is unavailable while coordination is enabled, so there is one decision owner.

`GET /state` adds `adaptive_planning_available`, `information_planning` and
`information_decisions`. The shared view/plan types are in
`shared/information-plan.ts`. Decision evidence references are
`incident:<id>`, `objective:<revision>`, `note:<id>` and `report:<attemptId>`.
Only matched, interpreted reports are usable report evidence. A decision is
stale when its `based_on_revision` differs from the case's `input_revision`.

## Switch versions only after Step 3 passes

1. Record the tested Step 3 commit and keep its worktree available for rollback.
2. Fetch `origin/tony/adaptive-information` into a separate worktree. Copy the
   private local configuration and profile fixture; do not commit them.
3. Run `npm --prefix server ci`, `npm --prefix server run check` and the existing
   `npm --prefix server test`. Send any failure before placing a call. No new test
   framework or blanket regression suite is needed.
4. Publish the module additively using the retained database-owner login and the
   existing local CLI workflow (`--delete-data=never`). This adds two tables;
   existing case/attempt columns are unchanged. Do not wipe or reseed existing
   records. Stop on a migration error.
5. Restart the backend with the same secrets/database, `AUTO_COORDINATE=1`,
   `COORDINATOR_SCRIPTED=0`, `INBOUND_REQUESTS=1` and the intended `SIMULATE` mode.
   `CLAUDE_MODEL` can select an account-supported model; otherwise the existing
   repository default remains. No hosted-agent update is part of this change.
6. Keep the public callback tunnel running. Reuse the authenticated callback
   probe from Step 3 before dialing. Open the backend test console on Vien's VM.

## Test one addition at a time

### 1. Claude chooses the question

- Select consenting contacts. Enter any incident and information objective.
- Enter only the briefing that those contacts may hear. Enable automatic
  questions, then open the incident. This opt-in may initiate real calls.
- Expect a saved Claude decision, its evidence IDs, and attempts with distinct
  provider IDs. With two eligible contacts, use an objective for which both
  accounts are useful and observe overlap if the plan selects both.
- Pass when the question serves the objective and the report is saved/bound on
  the correct attempt. Do not require a particular sentence from Claude.

### 2. An answer changes the investigation

- Answer naturally, correcting a detail or providing relevant unexpected news.
- Inspect the saved raw account and notes. Wait for a decision at the new case
  revision. Another call is not mandatory: a grounded waiting/review reason can
  be the appropriate next action.
- Pass when the decision cites the new evidence and makes a useful change.
  Pending useful work should remain; obsolete queued work should be cancelled.
  The system must not redial an active or uncertain destination.

### 3. The organizer changes direction

- Enter a specific information gap in the organizer instruction field.
- Expect one attributed organizer note and a fresh accepted decision. If the
  recipient remains active or within cooldown, expect a truthful wait reason.
  After the cooldown, another organizer input can request reconsideration; no
  future follow-up scheduler exists in this step.
- If a decision requests organizer review, inspect the reason. Resuming is an
  explicit configuration action. It is not implied by accepting the summary.

Stop at a failed boundary, inspect the VM logs/database/provider record, fix
that cause and repeat the affected check. Do not advance on a ringing phone or
an unverified spoken acknowledgment.

## Return evidence

Record the commit and actual mode, case ID, accepted decision ID/revision,
created attempt/provider IDs, saved report/note IDs and Tony's observation.
Include the organizer instruction and resulting decision references if used.
Share redacted errors, not credentials, full phone numbers or private accounts.
Update #27 and #20; Step 4 is not live-verified until these observations exist.
