# Coordinator mission handoff and dispatcher reassessment

Status: accepted, 2026-10-25. Extends ADR 0005.

The coordinator can revise an active information mission with a desired information
outcome, rationale, supporting finding IDs and optional focus fields. This changes the
existing task, not the call destination or authorization. It neither starts another call
nor creates an arrangement. Milestone, completed, held and finishing tasks cannot receive
these revisions. Information requirements and arrangement approval gates remain intact.

Each coordinator brief has a monotonically increasing revision within its task. Voice
updates echo the revision they addressed. An `answered` update for an earlier revision
saves its discoveries but cannot finish a newer mission: the next tool response returns
the current brief. Completion requires the relevant facts and an answer addressing the
latest information objective. Refusal, unknown and stop take priority; finishing with an
unresolved brief creates a review hold instead of another automatic call.

The latest authorized mission takes precedence over the initial generic call question.
The voice agent chooses how to pursue the goal at a natural conversational pause. This is
an HTTP tool handoff, not an unsolicited audio interruption, and callers are not kept on
hold awaiting a planning model. Only authorized arrangement tasks permit disclosure of
their specific pickup terms; a mission revision cannot authorize a commitment.

Follow-up agents receive bounded, attributed history for their own participant, including
narrative-only findings and prior final reports. Current versus prior call sources are
explicit, superseded structured fields are marked, and truncated/omitted history is
identified. Prior reports are not new confirmations. Other participants' narrative
accounts are not copied into this history. Coordinator priorities may be justified by
other reports, but must not disclose private peer details in the caller-facing objective.

The dispatcher can explicitly authorize reassessment of a reached participant held for
information review, with a mandatory clarification note and a current case revision.
This preserves findings and old task history, creates one bounded assessment with the
note as its versioned objective, and leaves cancelled arrangements cancelled. It does not
restore withdrawn consent, permit unknown contact outcomes to be retried, or resume a
closed/paused case. Outstanding calls must finish first. Existing facts alone cannot
complete this reassessment; its new clarification objective must be addressed. Matching
and approval remain held until that assessment is resolved.

Legacy billing/authentication failures are classified when old session JSON is read, so
new findings cannot erase the hold and the UI can explain the actual operational problem.
Chat saves the human's message but avoids another model request while such a hold exists.
Restoring provider credits is an external prerequisite, not something code or retry can fix.

Persisted additions are optional. The API exposes `assistance_protocol_version: 2` in
`GET /state` to identify this handoff deployment. Publish the module and restart the API
before running hosted agent setup; new voice tools include `mission_revision`.
