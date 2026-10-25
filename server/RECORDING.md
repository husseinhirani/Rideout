# Persisted recording demo

This is a fictional, scripted rehearsal through the actual HTTP server, coordinator
worker and SpacetimeDB. It makes no phone or Claude calls. It is separate from
`demo:coordinator`, which only evaluates independent snapshots.

Use a dedicated local database and port. The commands below assume SpacetimeDB
CLI/server 2.13 and installed server dependencies (`npm ci` from `server/`).

## Start

In one terminal, start an isolated local SpacetimeDB server on port 3303 using a
separate data directory. See the [SpacetimeDB CLI reference](https://spacetimedb.com/docs/cli-reference/)
for `spacetime start --listen-addr` and your installation's data-directory option.
Do not reset Vien's database or rewrite the shared hosted agent.

From `server/`, publish the module and seed only the new recording database:

```bash
spacetime publish --server http://127.0.0.1:3303 --module-path spacetimedb rideout-recording-demo
SPACETIMEDB_URL=http://127.0.0.1:3303 SPACETIMEDB_DATABASE=rideout-recording-demo npm run seed:recording
```

The seed prints the two helper IDs. Substitute those IDs below (a fresh database
normally starts at 1 and 2):

```bash
PORT=8788 SPACETIMEDB_URL=http://127.0.0.1:3303 SPACETIMEDB_DATABASE=rideout-recording-demo COORDINATOR_HELPER_IDS=1,2 npm run server:recording
```

Keep that server running. In another terminal:

```bash
RECORDING_DATABASE=rideout-recording-demo RECORDING_URL=http://127.0.0.1:8788 npm run demo:recording
```

The runner emits JSON stage events. Redirect stdout to a local file to save a
transcript; `/state` contains the live frontend state during the sequence.
Each successful replay leaves a closed case and four completed simulated attempts.
Run it again without reseeding to retain the previous history. An interrupted
replay leaves its case intact: inspect it, submit final simulated reports for
outstanding simulated calls, wait until processed, then close through the UI or
case route before a fresh replay. Closing a case does not end active calls.
The runner refuses unresolved prior work instead of creating another waiting
case. No command here deletes data.

## What the sequence proves

1. Structured fictional incident opens a case for Ava and two helper calls overlap.
2. Two reports explicitly accept the assignments; receipts and acceptance times persist.
3. Dispatcher input adds an unverified playground clue.
4. After the ten-second deadline, two follow-up questions include that clue.
5. A possible match becomes a report while the case stays open.
6. The dispatcher manually closes the case; the four-call budget remains enforced.

Both model responses and calls are explicitly simulated. The manual final step
is not a parent phone call and does not verify reunion. Real intake, caller
matching, successful Cartesia report delivery and parent-confirmed closure remain
issue #6. The runner uses structured incident input. The existing free-text
incident UI is outside this scripted sequence and still uses Claude for intake;
use the runner for a no-Claude recording. Unset `COORDINATOR_SCRIPTED` to use real Claude; unset `SIMULATE` only for
a deliberately configured live phone test. Scripted mode refuses real-call mode.

## Frontend handoff

Poll `GET /state` on the running backend. Existing arrays remain; no frontend
needs to simulate progress locally.

| View | Backend source |
| --- | --- |
| Case objective and state | `cases[].goal`, `status`, `brief` (JSON summary/suggestions) |
| Who was asked to do what | Join `attempts[].profile_id` to `profiles`; show `ask` per attempt |
| Call progress | Join `attempt_progress[].attempt_id` to `attempts[].id`; use `transport` |
| Report content and source | `notes` filtered by `support_case_id`; preserve attribution and uncertainty |
| Next queued question | `attempts[].ask` where matching progress is `queued` |
| Follow-up due time | `accepted_at_ms + 10000`; eligibility still depends on transport and remaining budget |
| Planning pending/blocked | `coordination`: compare `input_revision`/`evaluated_revision`, display `blocked_reason` |
| Recording label | `demo_mode.scripted` and `demo_mode.simulate` |

Transport is `queued`, `dispatching`, `active`, `ended`, `unknown` or `cancelled`.
An answered report is not proof of call completion. `unknown` means unresolved,
not safe to retry. “Not seen” is not a cleared search area. A possible match is
not confirmed identity. Don't show a successful reunion merely because an
operator used the close route.

No stored assignment/location object exists yet: the actual authorized question
is in `ask`. Do not infer new map regions or separate assignments from prose.
Current routes are same-origin; this change does not add browser CORS policy.

## Verification recorded for this change

The full runner completed against an isolated SpacetimeDB 2.13 database on
2026-10-25. Initial calls appeared at 02:01:59 UTC, changed follow-ups at 02:02:09,
and manual closure at 02:02:11 (about 12 seconds for the scripted sequence).
This is backend replay timing, not the duration of a real phone rehearsal.

The database process was stopped and restarted using the same data directory;
the closed case and its brief remained. A subsequent replay stopped the Node
worker after saving acceptances and a new clue, kept it down beyond ten seconds,
and restarted it. The overdue follow-ups resumed with the clue, and the replay
completed. An interrupted test run also confirmed that closing a case alone
does not release outstanding simulated calls; the runner now checks this before
creating another case.
