# design.md

Shared vocabulary, workflow, tech stack, architecture, and decisions. Keep this in sync with the code.

Status markers used below: **Decided** (agreed), **Proposed** (suggested, needs confirmation), **Open** (not decided).

## 1. Glossary

Use these terms exactly in code, comments, UI copy, and docs.

| Term | Definition |
|---|---|
| **Profile** | A stored record of a person or entity: name, phone, location, needs, contacts. A contact is family or an assigned helper. |
| **Incident** | An evacuation for an area: `type`, `area {lat, lng, radius_m}`, `status` `active` or `closed`, `created_at`, `ended_at`. |
| **Victim** | A profile on an incident whose check-in says they cannot get out. Stored as that person's incident status `victim`. |
| **Helper** | The profile on a support case who has accepted. Not an incident-person status. A `safe` person stays `safe` when they accept. |
| **Support case** | One victim's need for help during an incident. Fields: `incident_id`, `victim_profile_id`, `helper_profile_id` (empty until accept), `call_id` (the live Cartesia `agent_call_id`, empty when no call is up), `status` `open`, `contacting`, or `accepted`. At most one helper at a time. |
| **Authority** | A human operator. Confirms escalation. Does not approve each support case opened from an explicit help request. |
| **Disaster** | The real-world event (example is simulated wildfire) affecting an area. |
| **Alert** | A notification raised by the alert feed that a disaster may be threatening an area. It is for the authority to review. |
| **Help signal** | An explicit check-in answer that the person cannot get out. That answer sets the incident person to `victim` and opens a support case. |
| **Candidate** | A profile being considered to be a helper in a support case. |
| **Availability** | A helper is *willing* and has the *minimum capability* to support the victim *without risk to themselves*. |
| **Escalation** | For now assume authority is the highest level of order and escalates mean delagating task / input to them for action. |
| **Portal** | The communication layer (voice, SMS, images) between the system and people. |
| **Coordinator** | The AI agent. It supports the victim and helper, relays information, and suggests escalation. It does not make final decisions. |
| **Case log** | Out of this slice. Attempt rows are state, not a log. |

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
- **Authorities**: review alerts, guide helpers, confirm escalations. An explicit help request opens the support case without them.
- **Server system**:
  - *Alert feed*: ingests the live source and raises an alert to authorities. No agent involvement.
  - *Help signal*: an explicit check-in of `victim`, which opens a support case.
  - *Profiles*: relational storage of users and entities, with location lookup.
  - *Scoring*: deterministic ranking of candidates, includes safety filters.
  - *Cases*: incident and support-case state, including the open attempt.

## 3. Workflow

1. **Incident.** `create_incident` opens an incident as `active` and marks every profile in the radius `checking_in`. Profiles are written with `insert_profile`.
2. **Check-in.** Cartesia calls that list as a batch. `safe` only updates the person. `victim` updates the person and opens a support case. Those results run in parallel. No answer stays `checking_in`.
3. **Pick one helper.** The support case calls the victim's contacts who are `safe` first, then other `safe` people on the incident. One open attempt per support case. The live `call_id` is stored on the case.
4. **Contact.** A decline or no answer closes that attempt and opens the next. Accept sets `helper_profile_id` and `accepted`.
5. **Dropped call.** The support case stays as it is. The server reads the ended call, places a new call to the same person with that context, and stores the new `call_id`.
6. **Escalation.** If no helper remains, the case returns to `open`. The coordinator suggests escalation. The authority confirms.

Incident-person status: `checking_in`, `safe`, `victim`. Support-case status: `open`, `contacting`, `accepted`.

## 4. Tech stack

| Layer | Choice |
|---|---|
| Server | TypeScript. Cartesia client in `server/src`. SpacetimeDB module in `server/spacetimedb` |
| Agent / language understanding | Claude, hosted inside the Cartesia agent for the phone call |
| Voice (speech in/out) | Cartesia Managed Agents |
| Telephony (calls, SMS) | Cartesia outbound calls. A from-number id is not set up yet |
| Backend / database | SpacetimeDB 2.0, TypeScript module |
| Disaster detection source | NASA FIRMS hotspot data and/or official alerts (proposed)|
| Maps / routing for ETA and safety | To be chosen |
| Authority dashboard | Simple web UI: alerts, cases, live map, guidance |

Notes:

- Backend choice should support a regular schema for profiles, location lookup, and real-time updates for the live case view.
- Sponsor tools must do real work in the product, not be decorative.
- Phone calls use the existing Cartesia hosted agent (`CARTESIA_AGENT_ID`). The support case stores the live `agent_call_id` in `call_id`. An explicit help request opens the support case. The authority confirms escalation.
- A developer verifies a hosted-agent phone call from `server/` with `npm run call -- +E164`. The script posts one call to `POST /agents/calls` for `CARTESIA_AGENT_ID`, from `CARTESIA_FROM_NUMBER_ID`, with `dynamic_variables.phase` set to `checkin`. It prints `agent_call_id`. It does not open a support case.
- SpacetimeDB writes are reducers: `insert_profile`, `create_incident`, `record_check_in`, `record_attempt`, `set_call_id`. `set_call_id` stores the live `agent_call_id` and leaves the victim, helper, status, and attempt unchanged. Redial is not implemented.

## 6. Decisions

| # | Decision | Why |
|---|---|---|
| 1 | Primary interface is phone calls | Target users are elderly or disabled and often not app users, and in emergency this is quickest interface |
| 2 | An explicit check-in help request opens a support case without authority approval. Escalation still waits for the authority | Approving every case does not scale to a large incident. Escalation stays a human decision |
| 3 | One Cartesia Managed Agent already exists. Its id is stored in `CARTESIA_AGENT_ID` and reused for every call. The server does not create an agent | Cartesia assigns the agent id once. Each dial is a new `agent_call_id` stored on the support case |
| 4 | Server and SpacetimeDB module are TypeScript | SpacetimeDB 2.0 modules can be TypeScript. The Cartesia client and the module both live under `server/` |
| 6 | A support case stores one live `call_id`. A dropped call is a new Cartesia call. The case status, victim, helper, and attempt stay | Cartesia variable values apply to the current call only. The same `agent_call_id` is not resumed |
| 5 | Outbound phone calls use the existing Cartesia hosted agent via `POST /agents/calls`. The server supplies the destination number. `npm run call -- +E164` is the developer check for one check-in call | Cartesia dials and speaks. The script does not open a support case or choose a helper |
