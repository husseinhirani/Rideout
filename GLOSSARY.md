# RideOut

- **Organizer / dispatcher:** the human who sets an information objective and the permitted contact scope.
- **Incident:** the situation described by the organizer or a reporting person. No particular incident type is required.
- **Case:** an investigation with an objective, permitted scope, evidence and current state.
- **Profile:** a directory entry with a phone destination, stored attributes and contact relationships. Directory coordinates are not proof of current whereabouts.
- **Attempt:** one authorized outbound conversation with a profile about a case. Its transport and report status are separate.
- **Report:** what a caller said, preserved with its source. A report is not a verified fact.
- **Note:** an attributed interpretation of a report or organizer input.
- **Coordinator:** the application and Claude planning loop that gathers useful information within the organizer's scope. Automatic selection is enabled explicitly per case; manual questions remain the default.
- **Accepted decision:** one validated plan at a case input revision, with evidence references, queued-work decisions and the IDs of any newly authorized attempts. Saving it does not count as new evidence.
- **Contact scope:** the explicit profiles or directory filters the organizer permits. Combined filters intersect. Consent is checked separately.
- **Command receipt:** the persisted input and result of an organizer action, allowing a retry without performing it twice.

The missing-child story belongs to earlier demo fixtures. Child, parent, victim and reunion are not required roles or completion rules for the generic product.

## Assistance coordination

- **Assistance session:** the persisted coordinator state for an incident case: reported facts, findings, tasks, arrangements, messages and revision.
- **Finding:** an attributed update from a bound voice call. It can correct earlier reported facts without claiming independent verification.
- **Task:** one authorized question or milestone check delivered to a voice agent, with pending, delivered, completed, cancelled or blocked status.
- **Arrangement:** a proposed pairing between someone who needs assistance and a suitable willing helper. Human approval, helper acceptance, recipient confirmation, pickup and arrival are separate states.
- **Scenario location:** a supplied incident location and access category. In the drill it is fictional, and is not a claim about actual whereabouts or road safety.

- **Starting position:** explicitly simulated, unconfirmed drill placement sampled from mapped geometry. It is not current whereabouts until the participant confirms it for the scenario.
- **Geographic comparison:** maximum eligible coverage followed by minimum total straight-line separation, subject to current needs, consent, access and vehicle capacity. It is not road routing or a safety determination.
