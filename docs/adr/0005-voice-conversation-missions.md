# Voice conversation missions

Status: accepted, 2026-10-25. Extends ADR 0003 and 0004.

The incident coordinator owns the assistance outcome and selects authorized work. A voice
agent owns the conversation toward that work's outcome. It receives a mission containing
the outcome, rationale, attributed participant reports, current information gaps and why
those gaps matter. The model chooses wording, order and useful follow-ups. Supplied starting
positions are explicitly unconfirmed scenario context, separate from reported findings.

An assessment is ready when the coordinator has enough relevant information to evaluate
assistance: a recipient's location and transport requirements, or an independent willing
helper's location and available vehicle capacity. Independent non-helpers need no pickup
location; zero-seat helpers need no vehicle preferences or pickup location. The backend
defines decision requirements, not a mandatory sequence of questions. This implementation
still supports a bounded transport domain, rather than arbitrary rescue actions.

The same information-gap calculation drives voice completion and geographic comparison
readiness. Premature `answered` updates preserve discoveries and keep the current mission
active. The planner does not create overlapping information tasks for a live mission.
Corrections within an open conversation can reopen a completed information mission; a
final correction with unresolved information creates a review hold instead of a callback.
Finishing without a task ID resolves the currently bound task rather than leaving it active.

Explicit unknown/declined answers remain valid outcomes and stop questioning. An urgent or
unsupported need can be recorded as free text with `human_review`; it holds that participant
and withdraws outstanding arrangements before any new commitment advances. The voice agent
clarifies possible real urgency during a drill rather than assuming it is fictional. A stop
request takes precedence over reporting tools. This does not dispatch emergency services.
There is no automatic release of a participant review hold; human resolution and renewed
authorization are separate work, not permission implied by a chat response or retry button.

Consent, contact scope, evidence attribution, human approval, explicit acceptance, pickup
and arrival remain deterministic constraints. Mission completion is not incident resolution
and never establishes that help is on the way. Synthetic neighbors retain their internal
provenance and scripted behavior; their activity is not evidence of model autonomy.

Incremental findings and final call summaries are separate records. Missing final summaries
must not hide saved findings or present a reached person as unknown. Planning failures are
also separate: billing/authentication failures hold planning until an explicit retry after
repair, while transient failures use bounded retries. New findings do not clear an
environmental hold. Failure text must identify the actual class without exposing provider
credentials or raw payloads.

Deploy the API and database module before updating hosted voice tools and instructions.
The new fields are optional in persisted JSON; no existing call evidence is rewritten.
