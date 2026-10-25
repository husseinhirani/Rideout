# Plan: the master coordinator harness

Status: proposed 2026-10-25. Owner: Tony (backend), Vien (product UI). Replaces the
one-shot planner described in ADR 0003 and 0005 with a goal-and-constraints agent system.

## The idea in one paragraph

A human talks to one master coordinator. The master talks to every voice agent, gives
each a goal, takes back what it learned, and talks to them again until it has a solution
or a reason it cannot. Then it hands the human one package to dispatch. The code does
not script that path. The code holds the goal, the hard constraints and a few safety
nets. The agent chooses every move inside them.

## Why the current system cannot do this

All of this is verified at commit 0d41d20.

- Claude is called once per state change with the whole incident as JSON and returns one
  plan (`server/src/assistance-worker.ts:11-14`). No loop, no tools, no memory.
- Code picks the pairs. Claude may only repeat them (`server/shared/assistance.ts:312`).
- Nothing is proposed until every reachable person has answered everything
  (`server/shared/spatial.ts:96`, `server/shared/assistance.ts:310`).
- The follow-up chain is fixed: helper accepts, recipient confirms, pickup at 60 s,
  arrival at 60 s (`server/shared/assistance.ts:217-229`).
- Voice agents pull a mission when they choose and are told not to call back often
  (`server/src/setup-tools.ts:346-347`). The master cannot reach a live call.
- Unresolved needs are one string that the last writer overwrites
  (`server/shared/assistance.ts:23` and seven more sites).

## What code keeps, what the agent gets

Code keeps three things.

1. **The goal**, as data per incident, plus a deterministic check: every person who
   reports a need ends in an accepted arrangement or an explicit escalation to the human,
   and nobody reachable is left unaccounted.
2. **Hard constraints** in reducers. A violating action is rejected with a reason the
   agent can read: consent and do-not-call; no community helper into a specialist or
   unknown zone; no commitment to anyone before human approval; no peer's private details
   in a brief; one live call per phone; call budget and cooldown per person; capacity and
   needs must match; completion needs both parties' reports; only the human closes a case.
3. **Safety nets**, not strategies: a problem with no progress for N minutes is forced to
   the human; a loop that spins without new information is paused.

The agent gets the rest: whom to call, in what order, what to ask, when to compute
matches, whether to pre-check a helper, when to call back, when a solution is good enough
to show, when to give up on a person.

## Call briefs

The goal, must-tell, must-learn, must-not, done-when and report-back requirements for
every call, the coordinator and the dispatcher update are in `docs/call-briefs.md`. M2 and
M3 implement them; the per-task scripts in `taskInstruction` go away.

## Milestones

Each milestone ends in something you can run. Do not start the next one until the done
condition is met and recorded in the work map.

### M0. Baseline, flags and the goal check (half day)

Outcome: the current demo is frozen and we can score any drill against the goal.

1. Tag the current main as `demo-baseline` so the old flow can always be shown.
2. Move `include_simulated` from a hard-coded `true` (`server/src/wildfire-drill.ts:63`)
   to drill configuration. Scenario is data; strategy is not.
3. Write `server/shared/goal.ts`: the goal spec type (objective text, success criteria,
   stop conditions) and `goalStatus(state)` returning needs found, solved, escalated,
   unaccounted, constraint violations, minutes to first solution.
4. Add `npm --prefix server run drill:score` that prints `goalStatus` for a session.

Done when: the score runs against an existing saved session and against a fresh
simulated drill, and the numbers match what you see on the board.

### M1. Problem model and the end of hardcoded strategy (1 day)

Outcome: the session carries a real list of problems, and the reducers enforce only
constraints.

1. Add `problems[]` to the assistance session: id, person, need, severity, status
   (open, working, waiting_human, resolved, abandoned), what was tried, waiting_on,
   next_step, updated_at. Reducers `openProblem`, `updateProblem`, `resolveProblem`.
2. Replace every write to the single `review` string with a problem update.
3. Remove the six strategy rules: the wait-for-everyone gate, proposal-must-equal-matcher,
   the question kind enum and the six-per-plan limits, the fixed milestone chain and its
   60 s timers, the wipe-all-proposals-on-any-change rule, the reject-one-cancels-all rule.
4. Keep and test the constraints: write one reducer test per constraint that proves the
   reducer rejects the violation with a readable reason.
5. Turn `spatialMatching` into pure advice (candidates, distances, blocking reasons) with
   no gate.

Done when: `npm --prefix server run check` passes, the constraint tests pass, and a
simulated drill still reaches the goal through the old planner, now only constraint
checked.

### M2. The master agent loop (1.5 days)

Outcome: one Claude agent per incident drives the drill through tools.

1. New `server/src/master.ts`: a tool-use loop with the Anthropic SDK tool runner on
   `claude-opus-5-5`, adaptive thinking, effort `high`, stable system prompt first for
   caching, incident state appended as the volatile tail.
2. Tools, each a thin wrapper on a reducer or read: `read_incident`, `person_dossier`,
   `compute_matches`, `brief_call`, `request_call`, `end_call_request`, `open_problem`,
   `update_problem`, `resolve_problem`, `propose_solution`, `tell_human`. A reducer
   rejection returns as a tool error with the reason.
3. Wake on events: finding saved, call ended, inbound call, human message, timer, zone
   change. Run until no useful move, then sleep. One run per incident at a time.
4. Working memory: the problems list plus a short `master_notes` field the agent updates.
5. Safety nets: no-progress timer forces `tell_human`; a spin guard pauses the loop after
   N tool calls with no state change.
6. Retire `planAssistance` and `commitAssistancePlan`. Keep `answerCoordinator` for free
   chat, reading from the problems list.
7. Save every run's tool-call transcript per incident for review.

Done when: a simulated drill with real Claude reaches the goal, the score shows needs
solved, no constraint violation is logged, and the tool transcript shows the agent
briefing, re-briefing and proposing on its own.

### M3. The voice contract (1 day)

Outcome: voice agents report to the master as they go, and the master's words reach a
live call.

1. Prompt and tool: update after each meaningful answer, not only at the end
   (`server/src/setup-tools.ts:288-293, 346-347`; `server/tools/coordinate_call.json:28`).
2. Tool response carries `brief_changed`, a free-text `ask` list and an optional `tell`
   sentence (`server/src/assistance.ts:73-78`, `server/shared/voice-mission.ts`).
3. Structured debrief at hang-up: reached, facts, willingness, free text, open questions,
   needs_human. Separate from the final report.
4. Facts gain `urgent_now`, `already_left`, `mobility_need`, `eta_minutes`,
   `location_note` (`server/shared/assistance.ts:6-10`, `coordinate_call.json:40`).
5. `pre_tool_speech` on, call binding cached per provider call, `facts_json` parse guarded,
   server-assigned sequence.
6. Greeting and name: Sealert, "checking on residents in your area".
7. Run `setup-agent`.

Done when: one live call with one phone shows a brief the master changed mid-call being
spoken, and the debrief is saved and visible in the tool transcript.

### M4. The human contract and the screen (1.5 days, UI lane)

Outcome: the dispatcher sees three lines, one next action, one solution card, and a map
that reads at a glance.

1. `tell_human` shape: what is happening, what is solved or proposed, do I need you
   (yes with one question, or no). The status panel renders only this.
2. Solution package card: arrangements, distance, what was pre-checked, what is unsolved
   and why. One Approve, one Edit. Alert when it appears.
3. Problems list as the main drill view, worst first, with age.
4. Map: the 3D view stays during the drill; zone rings from scenario data with severity
   (red, yellow, green); one dot per person colored by worst open problem; a line to the
   helper once paired; a Next action card; everything else in a details drawer.
5. Remove from the live view: the one-pairing compact board, missing-child card, offline
   demo residents, 3D controls that do nothing during a drill, RideOut naming.

Done when: the video script beats play on screen with simulated neighbors, and a person
who has never seen the app can say what the next action is.

### M5. Scenario behaviors and hill-climb (1 day)

Outcome: the hard paths can be shown without a real person, and the agent's strategy has
a number.

1. Simulated neighbor behaviors as scenario data: decline, silent, moved, late, needs
   change. Today they always answer fully and accept
   (`server/src/assistance-worker.ts:63-71`).
2. Zones as data with optional time progression.
3. `drill:score` over N simulated runs; a table of needs solved, escalated, calls used,
   minutes to first solution, violations.
4. Tune the goal spec and master prompt against that table. Do not add strategy code.

Done when: five simulated runs in a row reach the goal with zero violations, and the
score table is in the work map.

### M6. Live rehearsal and the video (half day plus recording)

1. Two phones: Tony as the person who needs help, Vien as the helper. Simulated neighbors
   on or off per take.
2. Rehearse once end to end; record the approval click.
3. Fallback: the `demo-baseline` tag.

Done when: a recorded take covers every beat of the script.

## Risks and what we do about them

- Cartesia tool-call frequency and latency. Pre-tool speech hides it; if the agent still
  will not update often, the master calls back instead of pushing. Not verified yet.
- Claude loop cost and latency. Prompt caching on the stable prefix; effort `high`; one
  run per incident; spin guard.
- Revision races. Keep per-incident serialization of master runs; reducers already check
  revision.
- Scope. Each milestone stands alone and can ship. If time runs out after M3, the demo is
  still better than today.

## Working rules for this plan

- Targeted tests first, full suite at most once per change, never left running.
- Scenario is data, strategy is the agent's. If you find yourself writing "if need found
  then call helper", stop and put it in the goal or the prompt.
- Update `GLOSSARY.md` and an ADR (0007, master coordinator) in the M2 change.
