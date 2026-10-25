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
git pull --ff-only origin tony/ui-backend-integration
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

## First run: three consenting phone participants

1. Refresh the browser. Leave **Include 12 simulated neighbors** unchecked. Select
   **Start → Wildfire drill** once. Each saved participant receives an initial call.
2. Tom introduces himself, confirms each person's name, and explains the fictional drill.
   Speak naturally; important reported facts appear in the coordinator while calls continue.
3. To exercise a possible match, one participant can report needing a ride for one person,
   no wheelchair or pet, at the **West community pickup point**. Another can report being
   able to leave independently from West, willingness to help, and two passenger seats.
   The names can be swapped. The coordinator asks about missing information.
4. Read the proposed match and its source reports. Click **Approve proposal**. Approval
   authorizes asking the helper; it does not mean the helper has accepted.
5. The helper's agent receives the acceptance question at a natural tool check during an
   ongoing call. If that call has ended, the system queues a bounded follow-up after the
   cooldown. The recipient is asked to confirm only after the helper accepts.
6. Separate follow-ups ask both parties about pickup, then arrival, using a one-minute
   interval in this drill. Confirm imagined milestones only. Both reports are required
   before advancing. Nobody needs to travel.
7. Ask the coordinator chat, **“What is agreed, and who still needs attention?”** Its answer
   uses the saved incident state. Use the explicit buttons for approval, withdrawal and
   pausing; chat alone does not execute those actions.

Do not keep someone on the phone waiting for the planning model. The follow-up path is
part of the demonstration. Timing depends on provider/model latency and the person's
conversation. Missed calls and unanswered milestones remain in human review.

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
- On a later run, optionally include 12 simulated neighbors. They produce reports through
  the same backend workflow, are marked as simulated, and never dial phone numbers.

## What has been validated locally

Frontend build and server/module typechecks; actual isolated database transitions;
real planning-model proposals and coordinator chat with synthetic calls; duplicate-command
retries; eligibility, stale-plan and callback races; separate approval/acceptance/pickup/
arrival gates. Hosted phone conversations with the new tool require the deployment and
first live run above. No new automated test files were added at the user's request.
