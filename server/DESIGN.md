# design.md

Shared vocabulary, workflow, tech stack, architecture, and decisions. Keep this in sync with the code.

Status markers used below: **Decided** (agreed), **Proposed** (suggested, needs confirmation), **Open** (not decided).

## 1. Glossary

Use these terms exactly in code, comments, UI copy, and docs.

| Term | Definition |
|---|---|
| **Profile** | A stored record of a person or entity: name, phone, location, needs, guardian link. Whether someone is a victim or helper is determined by context (see Victim, Helper). |
| **Victim** | A profile that has been flagged as needing help in a case. Not a stored role. |
| **Helper** | A profile contacted to assist a victim. Any profile can be a helper if it is willing and capable of helping safely. Not a stored role. |
| **Support case** | One victim's need for help during a disaster, from when it is opened until it is resolved or escalated. For now assume a case has at most one helper at a time. |
| **Authority** | A human operator (e.g. emergency responder or coordinator). The only party that authorizes important decisions like escalation and maintain judgement of case a support case. |
| **Disaster** | The real-world event (example is simulated wildfire) affecting an area. |
| **Alert** | A notification raised by the alert feed that a disaster may be threatening an area. It is for the authority to review. |
| **Help signal** | The (for now not decided on implemenation) detection that a specific profile cannot evacuate themselves and need emergent help (for example from a check-in answer or a missed call). |
| **Candidate** | A profile being considered to be a helper in a support case. |
| **Availability** | A helper is *willing* and has the *minimum capability* to support the victim *without risk to themselves*. |
| **Escalation** | For now assume authority is the highest level of order and escalates mean delagating task / input to them for action. |
| **Portal** | The communication layer (voice, SMS, images) between the system and people. |
| **Coordinator** | The AI agent. It supports the victim and helper, relays information, and suggests escalation. It does not make final decisions. |
| **Case log** | The recorded history of a case: states, agent actions, contact attempts, authority actions. Write-only for now. |

## 2. Architecture

```
   Victims ----+                                   +---- Authorities
               |                                   |  (open case, guide
   Helpers ----+--> Comms portal <--> Coordinator <-+   helpers, confirm
                       |  ^  ^            |            escalation)
                       |  |  +-- authority guides helpers --+
                       v  v                v
        +----------------- Server system (source of truth) -----------------+
        | Alert feed | Help signal | Profiles | Scoring | Cases (state+logs) |
        +--------------------------------------------------------------------+
              ^
        Live source (NASA hotspots, county alerts)
```

Responsibilities:

- **Comms portal**: sends and receives calls (SMS and images later), speech in and out. Just translation and connection.
- **Coordinator (agent)**: Agentic part that interprets replies, chooses the next step in a case, writes the wording for outreach, suggests escalation.
- **Authorities**: review alerts, open cases, guide helpers, confirm escalations.
- **Server system**:
  - *Alert feed*: ingests the live source and raises an alert to authorities. No agent involvement.
  - *Help signal*: black box, flags a profile as needing help.
  - *Profiles*: relational storage of users and entities, with location lookup.
  - *Scoring*: deterministic ranking of candidates, includes safety filters.
  - *Cases*: case state, plus history (agent actions, contact attempts, event log).

## 3. Workflow

1. **Alert.** The alert feed pulls from the live source and raises an alert. The coordinator tries to relay evacuation guidance and establish people that need help for quick infor relay to authority. An authority reviews summary and manage cases for the area. (Authority can also open alert for a region)
2. **Help needed.** The help signal flags a profile as needing help.
3. **Pick one helper.** The coordinator scores for for the best candidate.
4. **Contact.** The portal contacts that one candidate. If they accept, the victim is told who is coming. If they decline or time out, the next candidate is tried. Never several at once.
5. **Guidance.** The authority can talk with the helper during the case to coordinate.
6. **Escalation.** If candidates run out or time passes, the coordinator suggests escalation. The authority confirms and takes over.
7. **Logging.** Every step above is written to the case log.

Suggested case states (Proposed): `open` -> `contacting` -> `accepted` -> `in_progress` -> `resolved`, with and `cancelled` as exits.

## 4. Tech stack

| Layer | Choice |
|---|---|
| Agent / language understanding | Claude (Anthropic) |
| Voice (speech in/out) | Cartesia | 
| Telephony (calls, SMS) | To be chosen (Twilio is the common default) |
| Backend / database | Convex or SpacetimeDB not yet decides |
| Disaster detection source | NASA FIRMS hotspot data and/or official alerts (proposed)|
| Maps / routing for ETA and safety | To be chosen |
| Authority dashboard | Simple web UI: alerts, cases, live map, guidance |

Notes:

- Backend choice should support a regular schema for profiles, location lookup, and real-time updates for the live case view.
- Sponsor tools must do real work in the product, not be decorative.

## 6. Decisions

| # | Decision | Why |
|---|---|---|
| 1 | Primary interface is phone calls | Target users are elderly or disabled and often not app users, and in emergency this is quickest interface |
| 2 | AI supports and coordinates, and can suggest escalation, but does not decide | Keeps humans in control and limits harm from AI mistakes |
