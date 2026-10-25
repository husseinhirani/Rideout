# District agents and a checkable core briefing

Status: proposed on `feature/district-trust`, 2026-10-25. Extends ADR0003 and ADR0004.

With `DISTRICT_AGENTS=1`, one district agent reports on each top-level scenario area,
plus one for people with no confirmed location. A core agent combines those reports into
a briefing for the human. The existing incident-wide planner still proposes pairings,
because helpers can cross districts. District agents choose next questions for their own
people, and those questions go through the same plan validation. Any proposal still
needs human approval.

The human trusts the core agent because nothing it says has to be taken on faith:

- A deterministic ledger (`server/shared/districts.ts`) computes every count from saved
  findings and arrangements. The UI shows the ledger's numbers, never numbers from agent
  text. Unknown and unreachable people are unaccounted for, never safe. Only a confirmed
  location places someone in a district; a seeded start is shown as a hint.
- Each status carries its evidence strength: both people in a ride confirmed it, one
  person's own report, or no report. It also records when the person was last heard from.
- Claims cite people and record IDs. `server/shared/trust-check.ts` checks each claim's
  district membership, ledger status, cited evidence, and every stated number in its
  role. For example, "7 arrived" is false even when 7 is the head count. The database
  reducer recomputes these checks, so the worker cannot vouch for itself. Failed
  statements stay visible, struck through, with the reason.
- The human can drill down from core line to district claim, person, report and call
  conversation, spot-check random people counted as accounted for, see contradictions,
  and step back through earlier briefings.
- Only the human declares a district clear. The reducer refuses while anyone there is
  unaccounted for or still needs a ride, unless the human acknowledges each person by
  name. That records a decision, not verified safety.

If a model is unavailable, the reports and briefing come from the ledger alone and are
labelled that way.

Limits: the number check reads digits and number words, and it understands roles only
for arrived, out, unaccounted and needs-a-ride phrasing. Free-text meaning beyond that is
not verified. That is why every line links back to records instead of being trusted.
