import { useState } from "react";
import { IncidentMap, arrangementDistance, formatDistance } from "./IncidentMap";
import { participantLocation } from "../server/shared/spatial";
import type { Arrangement, AssistanceState, Participant, Task } from "../server/shared/assistance";
import type { CoordinatorAction } from "./updated-ui-api";
import { Icon, type Opener } from "./Dashboard";

const STAGES: Record<Arrangement["status"], string> = {
  proposed: "Needs your approval", approved: "Awaiting helper acceptance", accepted: "Helper accepted",
  confirmed: "Pickup agreed", picked_up: "Pickup confirmed", completed: "Arrival confirmed", cancelled: "Withdrawn",
};
const TASKS: Record<Task["kind"], string> = {
  assess: "Check in", needs: "Clarify assistance needed", location: "Confirm location", capability: "Check ability to help",
  helper_accept: "Ask helper to accept", recipient_confirm: "Confirm with recipient", pickup: "Confirm pickup", arrival: "Confirm arrival",
};
function personStatus(person: Participant, session: AssistanceState) {
  if (!person.consent) return "Contact stopped";
  if (person.contact_blocked) return "Contact unavailable";
  if (person.unreachable) return "Not reached";
  const arrangement = [...session.arrangements].reverse().find(a => a.recipient_id === person.profile_id && a.status !== "cancelled");
  if (arrangement) return STAGES[arrangement.status];
  if (person.facts.needs_transport === true) return "Needs a ride";
  if (person.facts.needs_transport === false && person.facts.can_help === true) return "Willing to help";
  if (person.facts.needs_transport === false) return "Can leave independently";
  return "Situation unknown";
}
function taskStatus(task: Task, now: number) {
  if (task.status === "delivered") return "With voice agent";
  if (task.status === "pending" && task.due_at > now) return "Follow-up in " + Math.ceil((task.due_at - now) / 1000) + "s";
  if (task.status === "pending") return task.attempt_id ? "Call queued" : "Waiting for delivery";
  if (task.status === "blocked") return "Needs review";
  return task.status === "completed" ? "Answered" : "Cancelled";
}

export function AssistanceBoard({ session, disabled, closed, now, compact = false, onAction, onOpen }: {
  session: AssistanceState; disabled: boolean; closed: boolean; now: number; compact?: boolean;
  onAction: (expectedRevision: number, action: CoordinatorAction) => Promise<void>;
  onOpen?: (from: Opener) => void;
}) {
  const [working, setWorking] = useState("");
  const [error, setError] = useState("");
  const [accessDraft, setAccessDraft] = useState<Record<string, "community" | "specialist" | "unknown">>({});
  const unavailable = disabled || closed || Boolean(working);
  const act = async (key: string, action: CoordinatorAction) => {
    if (unavailable) return false;
    setWorking(key); setError("");
    try { await onAction(session.revision, action); return true; }
    catch (problem) { setError(problem instanceof Error ? problem.message : "The coordinator could not save that change."); return false; }
    finally { setWorking(""); }
  };
  const name = (id: number) => session.people.find(p => p.profile_id === id)?.name ?? "Unknown person";
  const active = session.arrangements.filter(a => !["cancelled", "completed"].includes(a.status));
  const proposals = active.filter(a => a.status === "proposed");
  const shown = compact ? (proposals.length ? proposals : active).slice(0, 1) : [...active, ...session.arrangements.filter(a => ["cancelled", "completed"].includes(a.status)).reverse()];
  const liveTasks = session.tasks.filter(task => ["pending", "delivered", "blocked"].includes(task.status));
  const needs = session.people.filter(p => p.facts.needs_transport === true && !session.arrangements.some(a => a.recipient_id === p.profile_id && a.status === "completed"));
  const planningBlocked = Boolean(session.planning_error?.blocked) || session.failure_count >= 3;
  const planning = !closed && !session.paused && !planningBlocked && session.revision !== session.planned_revision;

  return <section className={compact ? "tile assistance-board compact" : "assistance-board"} aria-label="Assistance coordination">
    <div className="assistance-heading">
      <div><h2>{compact ? "Coordinate help" : session.scenario.title}</h2><p>{closed ? "Case closed" : session.paused ? "New outreach paused" : planningBlocked ? "Planning needs attention" : planning ? "Considering new information…" : "Following the incident"}{session.scenario.drill ? " · Fictional drill" : ""}</p></div>
      {onOpen && <button className="assistance-expand" type="button" aria-label="Open assistance coordination" onClick={onOpen}><Icon name="expand" /></button>}
    </div>
    <div className="assistance-summary">
      <span><b>{needs.length}</b> need transport</span>
      <span><b>{proposals.length}</b> awaiting approval</span>
      <span><b>{session.arrangements.filter(a => a.status === "completed").length}</b> arrivals confirmed</span>
    </div>
    <div className="call-actions">
      <button type="button" disabled={unavailable} onClick={() => void act("pause", { action: session.paused ? "resume" : "pause" })}>{working === "pause" ? "Saving…" : session.paused ? "Resume outreach" : "Pause outreach"}</button>
      {planningBlocked && <button type="button" disabled={unavailable} onClick={() => void act("retry", { action: "retry_planning" })}>Retry planning</button>}
    </div>
    {error && <p className="assistance-review" role="alert">{error}</p>}
    {session.planning_error && <p className="assistance-review" role="status"><b>Planning issue</b>{session.planning_error.message}</p>}
    {session.review && session.review !== session.planning_error?.message && <p className="assistance-review" role="status"><b>Needs your attention</b>{session.review}</p>}
    {!compact && session.error && <details className="assistance-evidence"><summary>Planning issue</summary><p>{session.error}</p></details>}

    {shown.length ? <div className="arrangement-list">{shown.map(arrangement => <article key={arrangement.id} className={"arrangement " + arrangement.status}>
      <header><span className="arrangement-stage">{STAGES[arrangement.status]}</span><small>{new Date(arrangement.updated_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</small></header>
      <h3>{name(arrangement.helper_id)} <span aria-label="helping">→</span> {name(arrangement.recipient_id)}</h3>
      <p>{arrangement.reason}</p>
      {arrangementDistance(session, arrangement) !== null && <p className="assistance-note">Approximately {formatDistance(arrangementDistance(session, arrangement)!)} apart in a straight line · not a driving distance</p>}
      <ol className="arrangement-milestones" aria-label="Arrangement progress">
        <li className={arrangement.status !== "proposed" && arrangement.status !== "cancelled" ? "done" : ""}>Approved</li>
        <li className={arrangement.helper_accepted ? "done" : ""}>Helper accepted</li>
        <li className={arrangement.recipient_confirmed ? "done" : ""}>Recipient confirmed</li>
        <li className={arrangement.pickup_confirmations.includes(arrangement.helper_id) && arrangement.pickup_confirmations.includes(arrangement.recipient_id) ? "done" : ""}>Pickup</li>
        <li className={arrangement.status === "completed" ? "done" : ""}>Arrival</li>
      </ol>
      {arrangement.status === "proposed" && <><p className="assistance-note">Approval authorizes asking them to confirm this proposal. No pickup is agreed yet.</p><div className="call-actions">
        <button type="button" className="hot" disabled={unavailable || session.paused} onClick={() => void act(arrangement.id, { action: "approve", arrangement_id: arrangement.id })}>{working === arrangement.id ? "Saving…" : "Approve proposal"}</button>
        <button type="button" disabled={unavailable} onClick={() => void act(arrangement.id, { action: "reject", arrangement_id: arrangement.id, reason: "Dispatcher rejected the proposed arrangement" })}>Reject</button>
      </div></>}
      {!["proposed", "cancelled", "completed"].includes(arrangement.status) && <div className="call-actions"><button type="button" disabled={unavailable} onClick={() => void act(arrangement.id, { action: "cancel", arrangement_id: arrangement.id, reason: "Dispatcher withdrew the arrangement" })}>Withdraw arrangement</button></div>}
      <details className="assistance-evidence"><summary>Reports behind this proposal ({arrangement.evidence_ids.length})</summary>
        {arrangement.evidence_ids.map(id => {
          const finding = session.findings.find(f => f.id === id);
          return <blockquote key={id}><b>{finding ? name(finding.profile_id) : "Earlier report"}</b><p>{finding?.text || "Report text is unavailable."}</p>{finding && <small>{new Date(finding.at).toLocaleTimeString()} · {session.people.find(p => p.profile_id === finding.profile_id)?.mode === "simulated" ? "Drill report" : "Participant report"}</small>}</blockquote>;
        })}
      </details>
    </article>)}</div> : <p className="assistance-note">{planningBlocked ? "Saved findings are available for review. Planning must resume before the coordinator can propose new help." : session.people.some(p => p.facts.needs_transport === true) ? "The coordinator is checking needs and suitable help. No arrangement is confirmed." : "Conversations will reveal who needs assistance and who can help."}</p>}
    {compact && <>
      <p className="assistance-note">{liveTasks.filter(t => t.status !== "blocked").length} agent tasks pending or in progress{liveTasks.some(t => t.status === "blocked") ? " · " + liveTasks.filter(t => t.status === "blocked").length + " need review" : ""}</p>
      {onOpen && <button className="assistance-more" type="button" onClick={onOpen}>View people, tasks and incident details <Icon name="chevron" /></button>}
    </>}
    {!compact && <>
      <IncidentMap session={session} compact />
      <section className="assistance-section"><h3>People and reported needs</h3><p className="assistance-note">Reports remain attributed to their source. Unknown information is left unknown.</p>
        <div className="assistance-people">{session.people.map(p => <article key={p.profile_id}>
          <header><b>{p.name}</b></header>
          <strong className={p.unreachable || p.contact_blocked || p.facts.needs_transport ? "attention" : ""}>{personStatus(p, session)}</strong>
          <p>{participantLocation(session, p).location?.label ?? "Location unknown"}{!participantLocation(session, p).confirmed && participantLocation(session, p).location ? " · assigned drill position, unconfirmed" : ""}</p>
          {p.contact_blocked && <p>{p.contact_blocked}</p>}
          <div className="assistance-facts">
            {p.facts.party_size !== null && <span>{p.facts.party_size} passenger{p.facts.party_size === 1 ? "" : "s"}</span>}
            {p.facts.seats !== null && <span>{p.facts.seats} available seat{p.facts.seats === 1 ? "" : "s"}</span>}
            {p.facts.wheelchair === true && <span>Wheelchair transport needed</span>}
            {p.facts.pets === true && <span>Pet transport needed</span>}
            {p.facts.wheelchair_space !== null && <span>{p.facts.wheelchair_space ? "Wheelchair space" : "No wheelchair space"}</span>}
            {p.facts.pets_allowed !== null && <span>{p.facts.pets_allowed ? "Can carry pets" : "Cannot carry pets"}</span>}
          </div>
        </article>)}</div>
      </section>
      <section className="assistance-section"><h3>Voice-agent tasks</h3>
        {liveTasks.length ? <ul className="assistance-task-list">{liveTasks.map(task => <li key={task.id} className={task.status === "blocked" ? "blocked" : ""}>
          <div><b>{name(task.profile_id)}</b><span>{TASKS[task.kind]}</span><p>{task.reason}</p>{task.result && <p>{task.result}</p>}</div>
          <small>{taskStatus(task, now)}</small>
        </li>)}</ul> : <p className="assistance-note">No pending tasks.</p>}
      </section>
      <section className="assistance-section"><h3>Incident access</h3><p className="assistance-note">{session.scenario.drill ? "These are supplied drill assumptions, not live road guidance. Changing access can withdraw an incompatible arrangement." : "Use confirmed incident information. Unknown access does not permit a community pickup."}</p>
        <div className="assistance-access">{session.scenario.locations.map(location => <div key={location.id}>
          <label htmlFor={"access-" + location.id}>{location.label}</label>
          <select id={"access-" + location.id} value={accessDraft[location.id] ?? location.access} disabled={unavailable} onChange={event => setAccessDraft(current => ({ ...current, [location.id]: event.target.value as typeof location.access }))}>
            <option value="community">Community access</option><option value="specialist">Specialist only</option><option value="unknown">Unknown access</option>
          </select>
          <button type="button" disabled={unavailable || !accessDraft[location.id] || accessDraft[location.id] === location.access} onClick={() => void act("access-" + location.id, { action: "location_access", location_id: location.id, access: accessDraft[location.id] ?? location.access }).then(saved => { if (saved) setAccessDraft(current => { const next = { ...current }; delete next[location.id]; return next; }); })}>Apply</button>
        </div>)}</div>
      </section>
    </>}
  </section>;
}
