# Run the assistance coordination demo

This is a fictional evacuation drill. The names and numbers come from the private saved
roster. Nobody has a predetermined helper or recipient role: their answers determine it.

## Update the Mac

Keep SpacetimeDB running in its own terminal:

```bash
spacetime start --listen-addr 127.0.0.1:3000
```

From the repository, update and publish without deleting existing data:

```bash
git switch main
git pull --ff-only origin main
spacetime publish rideout-local-stage1 --server http://127.0.0.1:3000 --module-path server/spacetimedb --delete-data=never
```

Restart the API and Vite in their existing terminals (stop the old process first):

```bash
npm --prefix server run server
```

```bash
npm run dev
```

Keep ngrok running, using the hostname configured as `NGROK_URL` in your local environment:

```bash
ngrok http 8787 --url=YOUR_NGROK_HOSTNAME
```

After the new API is running, update the hosted voice agent's tools and instructions:

```bash
npm --prefix server run setup-agent
```

This attaches `coordinate_call`; it does not initiate calls. Existing authorized work can
resume when the API restarts. The coordinator requires `ANTHROPIC_API_KEY`, and real calls
require the existing Cartesia and callback configuration. Do not set `SIMULATE=1` for the
real-phone run. Never place provider keys in frontend variables.

## First run: Tony and Vien only

After deployment and agent setup, save the two-person roster from the existing saved
participants, with simulated neighbors disabled:

```bash
npm --prefix server run configure-drill -- --only 'Tony Nguyen,Vien Nguyen' --no-neighbors
```

The command resolves those names against the saved roster and retains their saved phone
numbers. It places no calls and needs no private JSON file. It should report two saved
participants and **Simulated neighbors: disabled**. If either name is missing or ambiguous,
correct the saved roster before starting. Refresh the browser so the Start menu shows the
new selection. This selection persists for future drills until reconfigured.

1. Select **Start → Wildfire drill** once. Only Tony and Vien receive initial calls, and
   no simulated neighbors join this incident.
2. Tom introduces himself, confirms each person's name, and explains the fictional drill.
   Speak naturally; important reported facts appear in the coordinator while calls continue.
3. Confirm or correct the supplied fictional starting positions. To exercise a possible
   match, one participant can report needing a ride for one person, no wheelchair or pet.
   The other can report being able to leave independently, willingness to help, and two
   passenger seats. Either person can take either role. The coordinator asks about missing
   information; names do not determine the pairing.
4. Read the proposed match and its source reports. Click **Approve proposal**. Approval
   authorizes asking the helper; it does not mean the helper has accepted. There is one
   approval gate for the proposal, with no second dispatcher approval after acceptance.
5. New drills use separate callbacks (`handoff_mode: callback`). Assessment calls finish
   before a bounded helper-acceptance callback is queued after the cooldown. After the
   helper accepts, the recipient receives a separate confirmation callback. An active
   assessment call is not repurposed into an acceptance or confirmation call.
6. When the helper accepts and the recipient confirms, the board shows **Ride arranged**
   and adds one to **rides arranged**. That is the endpoint for a new drill. No pickup or
   arrival calls follow, and neither pickup nor arrival is confirmed. Nobody needs to travel.
7. Ask the coordinator chat, **“What is agreed, and who still needs attention?”** Its answer
   uses the saved incident state. Use the explicit buttons for approval, withdrawal and
   pausing; chat alone does not execute those actions.

Do not keep someone on the phone waiting for the planning model. The follow-up path is
part of the demonstration. Timing depends on provider/model latency and the person's
conversation. Missed calls and unanswered acceptance or confirmation requests remain in
human review. Existing incidents that track pickup and arrival retain their original scope;
start a new drill to demonstrate the arrangement endpoint.

Before acceptance, the board can show a supplied **Drill route estimate**. After acceptance,
the **Drill pickup estimate** stays anchored to that acceptance time, including during the
recipient callback. It never restarts at the callback. The supplied route between the first
two drill positions assumes 13 minutes, including fictional congestion and preparation;
it is not calculated from straight-line distance or live traffic. The source is available
under **Route estimate source**. A pickup described as on the modeled route does not mean
the helper has departed. Missing, changed or expired route information produces no current
pickup estimate, and elapsed time never confirms pickup.

## Demonstrate adaptation

- Change a pickup location or passenger requirement before pickup: the old approval is
  withdrawn, and any suitable revised proposal needs fresh approval.
- Decline a proposal: the coordinator considers another eligible option rather than
  repeating that same pairing automatically.
- Report the **Ridge restricted area** or an unknown location: community matching is
  blocked and the coordinator asks for human/specialist review. It does not call emergency
  services or claim a specialist team was dispatched.
- Pause outreach: no new tasks or calls are authorized; already active calls may finish
  reporting what they learned.
- For an optional larger run, the 12 simulated neighbors produce reports through the same backend workflow,
  retain their simulated mode internally, and never dial phone numbers. The interface uses
  one drill roster without per-person mode badges. Their reported needs and capabilities
  also affect matching, so the coordinator may propose a suitable simulated helper. They
  are disabled for the two-person run above. To include them again with the selected roster,
  run `npm --prefix server run configure-drill -- --only 'Tony Nguyen,Vien Nguyen'`.

## What has been validated locally

Frontend build and server/module typechecks; actual isolated database transitions;
real planning-model proposals and coordinator chat with synthetic calls; duplicate-command
retries; eligibility, stale-plan and callback races; separate approval/acceptance/pickup/
arrival gates. Hosted phone conversations with the new tool require the deployment and
first live run above. No new automated test files were added at the user's request.

## Optional larger location-based run

To restore a larger roster, configure it from the local private roster file, for example
`npm --prefix server run configure-drill -- /absolute/path/to/drill-participants.json`.
The file contains `participants` with names and phone numbers; `include_simulated` is
optional and defaults to `true`. This only changes future drills and does not place calls.

The selected real participants use distinct starting positions sampled from the
bundled mapped building footprints. These are explicitly simulated positions, not their
actual addresses. Tom first asks each participant to confirm or correct the starting point.
Confirming it supplies the exact coordinate-backed location to the matching calculation;
simply displaying the initial marker does not authorize a match.

To exercise two possible matches, two participants can each report needing a ride for one
person, no wheelchair or pets. Two others can report independent evacuation, willingness
to help and one passenger seat (answer the wheelchair/pet capability questions too).
Any participant can take either role. Use the actual confirmed positions and reported needs
to review the resulting proposals. Displayed separations are straight-line distances,
not driving distances or arrival estimates.

The 12 simulated neighbors participate too, so no pairing is guaranteed.
Review the actual proposals, then approve the ones you want to
exercise. The coordinator waits for outstanding
relevant information so an early report does not reserve the only suitable helper before
comparing the group. The map shows the same reported positions used in this comparison.
A location correction changes the matching inputs; swapping names alone does not.
Finish each demonstration when its helper accepts and its recipient confirms the ride.

## Validate the conversation mission update

After publishing and restarting, run `npm --prefix server run setup-agent` before starting
another drill. Backend deployment alone does not update the hosted phone agent prompt.
Use natural answers rather than memorizing a question order:

- A willing helper says they can leave and are willing to help. The agent should gather
  available passenger capacity and relevant vehicle capabilities in that same conversation,
  without ending merely because the initial independence question was answered.
- A person needing assistance provides some details together, then corrects one. The agent
  should preserve the correction, skip already answered questions, and clarify only the
  remaining useful gaps. A change can alter matching; no named pairing is guaranteed.
- An explicit unknown/refusal should be respected and become a human-review item. An urgent
  or unsupported need should be preserved in their own words, rather than rejected because
  no structured field exists. During a drill, possible real urgency should be clarified.
- A stop request should end the call promptly. Previously saved findings remain visible even
  if no final summary is submitted. Recordings remain available after provider processing.
- If model-provider credits or authentication fail, the coordinator shows the actual issue,
  retains findings, and offers Retry planning. Fix the provider configuration before retrying.
  The retry control does not clear participant consent or information-review holds.

The implementation has been checked with local mission walkthroughs and isolated database
transitions. Natural conversation quality and provider timing still require the next live
phone run. No new automated test files were added for this change.

## Coordinator handoff and review resolution

Deploy the module and restart the API/Vite before `npm --prefix server run setup-agent`.
The updated API includes `assistance_protocol_version: 3` in authenticated `/state`.
Fix any outstanding provider billing/authentication problem, then use **Retry planning**.
A new call run cannot demonstrate model coordination while that provider remains unavailable.

During an active assessment, give the dispatcher new relevant context in chat. The planner
can revise that existing mission's information goal; the voice agent receives it on its
next coordination tool exchange. The call/task identity stays the same. The coordinator
feed records the updated objective. A response to an older goal saves findings but cannot
silently finish the revised mission. Delivery timing depends on the conversation and model.

For a reached participant with an unresolved information hold, open **Coordinate help**,
find the participant, enter what needs clarification, and choose **Authorize reassessment**.
This may place a bounded follow-up call; the button explicitly says so. Wait until their
previous call has finished. The follow-up receives their prior findings/reports with source
labels and the dispatcher’s clarification goal. It should not repeat already known facts
unless those are what needs clarifying. Existing unknowns and the new objective must be
resolved before matching. Refusal or continued uncertainty returns to human review.

Reassessment does not clear withdrawn consent, retry an unreachable person, reopen a
cancelled arrangement or invent a pickup confirmation. Names and phone numbers never
select a predetermined pairing.

## Returning calls and interrupted updates

Publish the module and restart the API with `INBOUND_REQUESTS=1` before running
`npm --prefix server run setup-agent`. Keep ngrok forwarding to the API on port 8787.
Setup checks the authenticated callback endpoint for the matching voice protocol before
changing hosted configuration. This check cannot prevent a tunnel disconnecting later.

A returning caller supplies their full name and explains which call they are returning.
The agent retrieves that caller’s saved call purpose and incident history using provider
metadata and the directory. If several incidents are possible, it clarifies which one;
it never combines unrelated histories. Earlier reports remain attributed historical
accounts, and the caller can correct them. No named participant or pairing is encoded
in this lookup.

Accepted incoming reports associated with an existing participant reach the coordinator
as unverified accounts for review. They do not automatically change consent, confirm a
pickup, or reserve a helper. Unknown or ambiguous callers remain in incoming review.

During an outgoing call, a correction after an interrupted tool request uses a new update
sequence. A stale sequence returns current saved state so the agent can preserve the
unsaved correction. The agent must not claim an account was saved when the callback
failed, and should end only for a clear stop request or normal conversation completion.
Natural conversation behavior still needs a live phone run after hosted setup.
