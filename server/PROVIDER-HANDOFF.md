# Historical provider-integration handoff

This describes an earlier incident-specific runtime. The branch order and
scripted recording commands below are obsolete for the generic backend. Use
the current entry points in [README.md](README.md); keep existing data intact.

Tony's `tony/provider-integration` branch includes the stacked backend work and
Vien's `6164944` changes. Review/merge PRs in dependency order (#9 → #10 → #11 →
#12 → this provider PR), or check out this branch directly for testing. Do not
cherry-pick just the last commit: earlier commits contain the durable module.

## Recording first — no provider configuration

Use the isolated database setup and seed in RECORDING.md. A fresh seed normally
has helpers 1/2 and Morgan 4; inspect the printed IDs rather than assuming for an
existing database. From server/:

```bash
PORT=8791 SPACETIMEDB_URL=http://127.0.0.1:3303 SPACETIMEDB_DATABASE=rideout-recording-demo COORDINATOR_HELPER_IDS=1,2 COORDINATOR_REPORTER_ID=4 INBOUND_REQUESTS=1 CALLBACK_SECRET=recording-only-secret npm run server:recording
```

In a second terminal:

```bash
RECORDING_DATABASE=rideout-recording-demo RECORDING_URL=http://127.0.0.1:8791 CALLBACK_SECRET=recording-only-secret npm run demo:inbound
```

All intake, unsolicited updates and reunion confirmation use `/requests`; helper
reports use `/calls/report`. Metadata, conversations and interpretations are
explicitly simulated. The database, HTTP receiver, worker, ten-second timer and
case closure are real. No browser/frontend files changed.

## Live configuration

1. Install dependencies (`npm ci` in server/), then run `npm test` and `npm run check`.
2. Publish the additive module to the intended **dedicated demo database** before
   starting the updated API. Do not delete or reset the existing database.
3. Configure the known parent and two helpers with distinct consenting test
   numbers. Set COORDINATOR_REPORTER_ID and COORDINATOR_HELPER_IDS to their IDs.
   Old legacy probe attempts can block reuse of a destination conservatively;
   use a separate demo database rather than deleting call history.
4. Set INBOUND_REQUESTS=1 and AUTO_COORDINATE=1. Unset SIMULATE and
   COORDINATOR_SCRIPTED. Configure ANTHROPIC_API_KEY, CARTESIA_API_KEY,
   CARTESIA_AGENT_ID, CARTESIA_FROM_NUMBER_ID, NGROK_URL and CALLBACK_SECRET in
   `.env.local` or `.env`. Exported variables win; `.env.local` precedes `.env`.
5. Start `npm run server` and `./dev-tunnel` on matching ports. Keep SpacetimeDB
   local/private: public tables/reducers retain the existing access model.
6. Run `npm run setup-agent` from this checkout once the tunnel/API is ready.
   **This updates the shared hosted prompt and all three tool definitions.**
   It adds report_request and configures the callback bearer. No hosted change
   was made by Tony while implementing this branch.

## Live checks still required

- Call inbound and capture report_request reaching /requests with resolved
  system__caller_id, system__conversation_id and system__call_direction. Source
  bindings are supplied; their resolution is not yet proven.
- Give complete fictional intake. Confirm exactly one case and two overlapping
  calls. If essentials are missing, answer the returned clarification and submit
  the full account again. Missing metadata is rejected rather than guessed.
- Helpers explicitly accept. Follow-up becomes due ten seconds after acceptance
  and waits for getCall to confirm the preceding call completed.
- Phone back with a new clue; verify it changes a pending follow-up. A possible
  match must leave the case open. The original parent must explicitly confirm
  child identity and physical reunion before automatic closure.
- Verify the updated outbound tool still reports its attempt_id with bearer
  authentication. Vien previously verified this on 6164944; combined live
  coordinator behavior still needs this rehearsal.
- If a tool fails, inspect server/provider logs. No HTTP retry behavior is
  assumed. Pending means saved, not applied; the prompt polls the same report
  at most twice. Review-only receipts remain in incoming_request, without a new
  frontend review queue. Caller-number matching is not identity verification.

## Verification recorded by Tony

An additive module publish and full `demo:inbound` run passed on local SpacetimeDB
2.13: one intake despite replay, two helper calls, changed follow-up after ten
seconds, possible find open, original-reporter simulated confirmation closed.
HTTP checks passed for missing/wrong auth, missing metadata, unknown caller
review without case disclosure, and conflicting transcript replay. Automated
coverage includes crash recovery, stale decisions, clarification and limits.
No real phone calls, hosted writes or live Claude calls were made in this work.

The final automated run passed 120 tests plus both TypeScript checks. A real Node
restart also recovered a persisted prepared inbound action exactly once, recorded
the late update, and kept its case closed.
