# Context

Global context and working conventions. Read before making any change.

## What this is

**RideOut** (working name): an information network for human-first evacuations. It calls the people around an emergency (family, neighbors, the person themselves), turns what they say into a picture of what is happening, and presents that to a human dispatcher who decides what happens. Mainly phone calls, because the people who cannot evacuate on their own are elderly, disabled, without a car, and often not app users. The agent gathers and synthesizes. It never dispatches help.

This is a **hackathon project**. Time is the scarcest resource.

## Layout

Put a file where its job lives. Do not park new behavior in whichever file you already have open.

The repo root is the browser demo. It does not import `server/`. `server/` is the backend. It does not import the demo.

| Path | Put here | Do not put here |
|---|---|---|
| `server/src` | The process outside the database: HTTP routes, calls to Cartesia, reading rows, choosing the next reducer. `llm.ts` is the only file that talks to the Anthropic SDK. `agent.ts` holds the four Claude prompts. `setup-tools.ts` holds the hosted Cartesia phone-agent instructions and setup command. `loop.ts` holds the loop, the candidate filter, and the call deadline. `ui.html` is the test UI | Table definitions, reducer bodies |
| `server/spacetimedb` | The database module. `src/models.ts` is tables only. `src/apis/` is reducers, one file per area (profiles, incidents, support cases). `src/index.ts` re-exports them | HTTP, Cartesia, scripts that only a developer runs |
| `server/tests` | Checks that a behavior works. A manual check is still a test | Product behavior the running server needs |
| `server/mock` | Shared fixtures the team can load, including typed fictional coordinator snapshots. No one's real phone number | Runtime behavior |
| `server/tools` | Cartesia webhook tool JSON, one file per tool. `api_schema.url` is a path such as `/calls/report`. `npm run setup-agent` prefixes `NGROK_URL` and attaches the `CALLBACK_SECRET` bearer | Phone numbers, secrets |
| `server/` root | `package.json`, docs (`AGENTS.md`, `CONTEXT.md`, `DESIGN.md`), and short dev commands such as wiping the local database or opening the ngrok tunnel | Feature logic |

A reducer records a fact. The process in `server/src` is what may call Cartesia and then call that reducer. If a change only stores or validates a row, it belongs in `spacetimedb`. If it places a call, reads a result, or serves HTTP, it belongs in `src`.

## Problem

- People who cannot evacuate on their own die in wildfires even when help is nearby. In the 2025 Eaton Fire, 18 of the 19 deaths were in west Altadena, mostly elderly or disabled residents.
- Official alerts are one-way: they say "leave" but never ask "can you?".
- Neighbors do most life-saving rescues after large disasters, but nothing coordinates them in the moment.
- One line: cars with empty seats drive past people who cannot leave, and nothing connects them.

## Target user

People who in a disaster case cannot evacuate on their own. Example: an elderly or disabled resident in a wildfire zone, often living alone, without a car or unable to walk, and often not an app user. Primary interface is therefore **phone calls** (text and images later).

## MVP scope

The next demo is agent-led missing-child coordination with two known helpers and
two predefined locations. Its agreed scope is GitHub issue #2. Ticket #3 adds an
isolated planning harness (`npm run demo:coordinator`); it does not activate
automatic outreach in the HTTP server. Follow-up becomes due 10 seconds after
acceptance, with at most two outbound calls per helper and parent confirmation
required before closure. Ticket #5 adds opt-in automatic coordination (`AUTO_COORDINATE=1`) to the
HTTP backend using persisted attempts, notes and progress records. It uses the
same worker with simulated or real calls. `npm run server:recording` explicitly
substitutes scripted model responses and simulated calls for reproducible recording,
while keeping HTTP, the worker and SpacetimeDB intact. Internal intake, attributed updates and reported-reunion operations are implemented
under ticket #6. The provider receiver and hosted tool source are implemented using Vien's /requests
envelope; live metadata binding and confirmation remain unverified. The recording
uses explicitly simulated participant associations. The workflow below describes
legacy cases when automatic coordination is disabled.

One neighborhood, one simulated fire, one complete loop:

1. The dispatcher describes the incident in plain language, and the server turns that sentence into an incident and its victims.
2. A support case opens per victim: from a check-in that is an explicit help request, or named directly by the dispatcher.
3. Claude plans who to call and what to ask, and the server dials them all in parallel.
4. Answers come back, become notes, and the brief regenerates.
5. The dispatcher reads the brief and either accepts the case or sends more input, which re-plans.

The fire is simulated and we say so clearly in the demo.

## Hackathon targets

Primary: Meta ("Bringing People Closer Together with AI"), Anthropic (Claude), Microsoft ("Built for the Real World"). Likely also relevant: Cartesia (voice) and SpacetimeDB. Check track rules before submitting. Sponsor tech must be used meaningfully, not bolted on.

## Conventions

These apply to every change, by humans and agents.

1. **Move fast, but correctly.** A working simple thing beats an ambitious broken one.
2. **Smallest change that meets the requirement.** Prefer the cleanest, most minimal diff. Do not refactor unrelated code.
3. **Do not over-engineer.** No premature abstractions, extra layers, generic frameworks, config systems, or "future-proofing". If it is not needed for the MVP loop, do not build it.
4. **MVP only.** Do not solve hard or complex requirements yet. When a requirement is vague, pick the simplest reasonable interpretation, state the assumption, and move on.
5. **Black boxes are fine as subproblems until explicitly touched on.** Parts marked as black box in `DESIGN.md` should be stubbed with a simple interface, not implemented deeply.
6. **Humans decide escalation.** An explicit check-in help request opens a support case without an authority approval. The agent still does not confirm an escalation. It suggests.
7. **Safety rules live in code not just not in prompts.** Anything that must never happen is enforced deterministically. Two rules today: never call someone whose own incident status is `victim`, because they need help themselves, and never put a phone number or a street address into what a called person is told.
8. **Use the shared vocabulary.** Terms are defined in `design.md`. Use them exactly.
9. **Keep docs current.** If your change affects behavior, terms, decisions, or server capabilities, update `design.md` or `api.md` in the same change.
10. **Server code is TypeScript.** The SpacetimeDB module is `server/spacetimedb`. The Cartesia client and the HTTP server are `server/src`. `npm run seed` loads `server/mock/profiles.json` into an empty local database. `npm run server` serves the test UI at `GET /`, `GET /state`, `POST /incidents`, `POST /check-ins`, `POST /calls/report`, `POST /cases`, `POST /cases/:id/input`, and `POST /cases/:id/close`. `./dev-tunnel` exposes that port through ngrok. `npm run setup-agent` upserts the webhook tools in `server/tools` onto the existing Cartesia agent. `ANTHROPIC_API_KEY` lives in the repo-root `.env` with the `CARTESIA_*` vars, `NGROK_URL`, and the optional `CALLBACK_SECRET` that authenticates `/calls/report` and `/check-ins`. `SIMULATE=1` runs the whole loop without dialing. `spacetimedb/package.json` is there so the SpacetimeDB CLI can detect a TypeScript module. `npm install` stays in `server/`. Node resolves `spacetimedb` from `server/node_modules`, and the install links `tsc` into the module because `spacetime publish` looks for it there.

## Out of scope for now

Automatic dispatch of anyone to anywhere, assigning a helper to a case, route optimization, historical analytics, multi-language support, roles and permissions beyond "authority", real emergency-system integration, and anything not needed for the MVP loop. Check-in calls for one incident run as a batch.
