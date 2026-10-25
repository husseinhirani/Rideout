# Provider contract — Stage 1 (#22)

This describes source configuration. A hosted update and a real call must still
verify the bindings. Tony performs that update once the receiver is deployed.

## Outbound account

`report_call` posts to `/calls/report` using the configured callback bearer:

```json
{
  "attempt_id": "42",
  "provider_call_id": "ac_example",
  "direction": "outbound",
  "answer": "Complete account, including corrections and uncertainty.",
  "concern": ""
}
```

The provider binds `attempt_id`, `system__conversation_id` and
`system__call_direction`. Only `answer` and `concern` come from the voice model.
Bound fields are not in the tool's `required` array. Missing live metadata is a
failure to investigate, not a reason to let the model invent it.

The receiver must save the raw account before acknowledging receipt. An early
report may wait for binding to the call ID returned by the outbound request;
interpretation must wait for that binding. A successful receipt acknowledges
storage, not verified facts, dispatch or completion. Same final content can be
replayed; different content under a finalized receipt is a conflict.

## Inbound account

`report_request` remains separate at `/requests`: `from_phone` is bound from
`system__caller_id`, `provider_call_id` from `system__conversation_id`, and
`direction` from `system__call_direction`; `text` is the complete model-supplied
account. It has no outbound attempt variable. Stage 1 may save it for review;
generic case association is Stage 2. A receipt does not disclose a case or promise
a callback. Existing clarification and exact-text retry semantics remain.

## Provider reads and recovery

`getCall` retains `status`, `endReason` and `summary`. It also returns nullable
`id`, `agentId`, `agentVersionId`, `direction`, `fromNumber`, `toNumber` and
`attemptId`. These fields are optional in the TypeScript type for old adapters;
the real decoder returns them explicitly. No transcript or inferred answer is
manufactured when a report is absent.

`isTerminalCallStatus` recognizes `completed` and `failed`. The worker persists
terminal observations independently of report receipt. A summary or received
report is not a terminal signal.

For an uncertain dispatch with only a candidate call ID,
`verifyOutboundCallBinding` requires the provider ID, configured agent, outbound
direction, recipient destination and attempt metadata to agree. It returns
`{status: "matched" | "pending" | "conflict", reason}`. Missing metadata leaves
the attempt unresolved; a mismatch is a conflict. This helper does not redial or
write state. A call ID already saved from a successful outbound response does not
need recovery. The outbound `from` number is RideOut's line; use `to` for the
recipient.

## Setup and conversation

`setup-agent` requires a nonempty `CALLBACK_SECRET` before any provider request.
It never removes hosted authentication because the local secret is missing,
including when `SIMULATE=1`: setup still edits the real shared agent.

Tom introduces himself as an AI assistant from RideOut, asks the assigned question
with relevant clarification, preserves corrections/refusal, explains saving, and
acknowledges only the actual tool result. The prompt asks him to say goodbye and
use `end_call` after a completed outbound or inbound conversation. Wording remains
natural; the prompt contains no incident scenario. Actual speech, tool metadata
and automatic hang-up remain part of the human Stage 1 call checkpoint.

Provider references: [Get Call](https://docs.cartesia.ai/api-reference/agents/calls/get-call),
[dynamic variables](https://docs.cartesia.ai/agents/dynamic-variables), and
[webhook tools](https://docs.cartesia.ai/agents/webhook-tools). These document the
interfaces; they do not establish a successful live run for this source version.
