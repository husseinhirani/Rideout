# Call briefs: goals and constraints for every agent

Status: agreed 2026-10-25 (Tony). Implements the "goal plus constraints" principle in
`docs/plan-master-coordinator.md`. Replaces the per-task scripts in
`server/shared/assistance.ts` (`taskInstruction`) once the coordinator loop lands.

## The contract

Every brief has six parts. The model chooses wording, order, follow-up questions and tone,
and may ask anything it judges important to the goal.

- **Goal:** the outcome we need, in one sentence.
- **Must tell:** facts the person has to hear.
- **Must learn:** what the coordinator needs back.
- **Must not:** hard limits. Enforced in reducers wherever code can check them.
- **Done when:** the condition that ends the call.
- **Report back:** structured fields the code validates. A task cannot close without them.

## Briefs per call

### 1. First contact (emergency announcement)

- Goal: the person knows what is happening and what to do; we know whether they are OK,
  can leave, need help, or can help.
- Must tell: who is calling (AI assistant from Sealert); the hazard, area and how soon;
  where to go and by when; call 911 for immediate danger.
- Must learn: right person reached or not; safe now or in danger now; where they are; can
  they leave on their own and how; if not, what help and for how many; anything that
  changes the kind of help (mobility, medical, kids, pets) only if relevant; can they help
  others, only if they raise it or the coordinator asks.
- Must not: give details before the name is confirmed; leave details on voicemail; promise
  a ride or time that is not approved; give road or safety advice beyond the official
  instruction; share other people's information.
- Done when: status is clear (leaving alone, needs help, can help, or unknown with reason),
  or they ask to stop.
- Report back: reached, safe_now, location, can_leave, need {kind, party_size, urgency},
  can_help, own words, open questions.

### 2. Helper commitment

- Goal: a clear yes or no to a specific pickup the dispatcher approved.
- Must tell: who needs help (first name); where in plain words; why this helper (on their
  way, close by); pickup time if they leave now.
- Must learn: yes or no; seats against party size; conditions; whether their situation
  changed.
- Must not: offer an unapproved pickup; count "maybe" as yes; share the rider's phone or
  private details beyond what the pickup needs.
- Done when: explicit yes with enough seats, a no, or a condition the coordinator decides.
- Report back: decision, seats, conditions, ready time, changes.

### 3. Rider confirmation (help is coming)

- Goal: the rider knows who is coming and when, and confirms they will be ready.
- Must tell: good news; helper's first name; pickup time; be ready at their place.
- Must learn: ready yes or no; changes (location, party size, already left).
- Must not: promise a time the helper did not accept; say the helper left or arrived when
  that was not reported.
- Done when: confirmed, or a change is reported.
- Report back: ready, changes.

### 4. Change or cancel notice (new)

- Goal: everyone affected by a changed plan knows the new plan.
- Must tell: what changed in one sentence; what to do now (stay put, new helper and time,
  no longer needed).
- Must learn: acknowledged; any new constraint.
- Must not: blame anyone or explain beyond "they can't make it".
- Done when: acknowledged.
- Report back: acknowledged, new information.

### 5. Status check (picked up, arrived, still waiting)

- Goal: know the real state of an agreed pickup.
- Must learn: what actually happened, in their words.
- Must not: count a guess as confirmation.
- Done when: clear status or "unknown".
- Report back: status, time, issues.

### 6. Inbound call

- Goal: understand why they are calling and update the right case.
- Must learn: who they are (name, phone match if possible); what they need or what changed.
- Must not: reveal anyone else's case; treat an unmatched caller as a known person; promise
  action beyond what is approved.
- Done when: their report is clear.
- Report back: identity match (matched, needs_review, unknown), update, urgency.

## Coordinator

- Goal: every person who needs help ends with an accepted plan or is escalated to the
  dispatcher with a reason, as fast as possible, with nobody reachable left unaccounted.
- May: call anyone in scope; ask any question through a brief; re-brief a live call; propose
  any pair that passes the rules; cancel and replan; decide pacing within the call budget.
- Must not: commit anyone without dispatcher approval; contact anyone who withdrew consent;
  send a helper into a restricted zone; exceed seats or the call budget; tell someone a
  pickup is set before both sides agreed.
- Done when: every need is resolved or with the dispatcher.
- Report back: the problem list (person, need, status, next step).

## Dispatcher update

- Goal: the dispatcher knows the situation at a glance and whether they are needed.
- Must say: what is happening (one line); what is agreed (one line); needed: yes plus the
  one decision, or no.
- Must not: list IDs, tasks or evidence unless asked; claim anything not in saved state.

## What stays in code, and how we check the agent

- Reducer rules (reject the action and tell Claude why): consent, approval before
  commitment, zone access, seat capacity, call budget, privacy, "agreed needs both yes".
- "Done when" is checked through the structured report: a task cannot close without its
  required fields.
- "Must tell" is checked after each drill by a second Claude pass that scores every
  transcript against its brief. That score is what prompts are tuned against.

## Acceptance cases

Each must reach a sensible end state with zero rule violations and no code change between
cases: helper declines; rider party larger than helper seats; everyone needs a ride; helper
offers on the first call; rider reports "a neighbor took me" by inbound call.
