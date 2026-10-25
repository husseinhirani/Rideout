# Live assistance coordination with human approval

Status: accepted implementation scope, 2026-10-25. Live telephone validation is a separate deployment checkpoint.

RideOut's parallel calls are workers for one incident coordinator. A voice agent reports
important findings during a conversation and retrieves the latest authorized task at
natural pauses. This first implementation uses an HTTP tool response, not an interrupt
pushed into the caller's audio. If the conversation finishes, bounded follow-up calls
can carry outstanding tasks. No caller is kept waiting for a planning model.

Each case has a durable assistance session with attributed findings, reported facts,
tasks, proposed arrangements and coordinator messages. The planning model chooses
useful information questions and eligible pairings. Database reducers validate current
revision, contact scope/consent, vehicle suitability, capacity, scenario route access,
reservations, task ownership and milestone transitions. A model summary is not an
executed action. Provider callbacks are bound to their saved outbound attempt before
findings or task instructions are exchanged.

The human's Start action authorizes the configured initial contacts and bounded
information gathering. Each proposed arrangement needs explicit human approval before
asking the helper to accept it. Recipient confirmation follows helper acceptance.
Pickup and arrival require separate reports from both participants. Completion records
reported arrival, not independent verification of safety. A changed pickup location or
passenger requirement invalidates prior approval. Refusal, missing data, unknown access,
missed deadlines and unreachable participants remain visible for human review.

The demonstration is a fictional evacuation incident with consenting real phone
participants. Supplied locations and community routes are simulation assumptions, not
live navigation or evacuation advice. A specialist-only location creates a human review
request; this version does not contact emergency services or dispatch specialist teams.
Real participants' roles are discovered from their answers. Every new drill includes 12 synthetic neighbors. They
are explicitly marked and use the same durable workflow without provider dialing.
Their hidden simulation answers are excluded from model snapshots and browser state.

This extends the information-gathering foundation in ADR 0002. The previous restriction
against coordination/dispatch describes that earlier milestone, not the product's scope.
The older information planner remains disabled for assistance cases to avoid two planners
competing for the same work. Existing non-assistance cases keep their prior behavior.

Deferred: live alert feeds and routing, SMS, multilingual workflows, independent shelter
check-in, and recovery services. These require additional data and action integrations.
