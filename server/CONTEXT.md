# Context

Global context and working conventions. Read before making any change.

## What this is

**RideOut** (working name): a rescue coordination system for human-first evacuations. It connects people who cannot evacuate on their own (elderly, disabled, no car, often not app users) with guardians and neighbors who can help, mainly through phone calls, with an AI agent supporting the coordination and human authorities making the key decisions.

This is a **hackathon project**. Time is the scarcest resource.

## Problem

- People who cannot evacuate on their own die in wildfires even when help is nearby. In the 2025 Eaton Fire, 18 of the 19 deaths were in west Altadena, mostly elderly or disabled residents.
- Official alerts are one-way: they say "leave" but never ask "can you?".
- Neighbors do most life-saving rescues after large disasters, but nothing coordinates them in the moment.
- One line: cars with empty seats drive past people who cannot leave, and nothing connects them.

## Target user

People who in a disaster case cannot evacuate on their own. Example: an elderly or disabled resident in a wildfire zone, often living alone, without a car or unable to walk, and often not an app user. Primary interface is therefore **phone calls** (text and images later).

## MVP scope

One neighborhood, one simulated fire, one complete loop:

1. An alert is raised and an incident is opened for an area.
2. A check-in is an explicit help request, and the server opens the support case.
3. One helper is selected and contacted.
4. The helper accepts and the victim is told who is coming.
5. The authority can guide the helper, and the case can be escalated.

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
7. **Safety rules live in code not just not in prompts.** Anything that must never happen (for example routing a helper toward danger) is enforced deterministically.
8. **Use the shared vocabulary.** Terms are defined in `design.md`. Use them exactly.
9. **Keep docs current.** If your change affects behavior, terms, decisions, or server capabilities, update `design.md` or `api.md` in the same change.
10. **Server code is TypeScript.** The SpacetimeDB module is `server/spacetimedb`. The Cartesia client is `server/src`.

## Out of scope for now

Multiple cases per helper, calling more than one helper for the same support case at once, route optimization, historical analytics, multi-language support, roles and permissions beyond "authority", real emergency-system integration, and anything not needed for the MVP loop. Check-in calls for one incident run as a batch.
