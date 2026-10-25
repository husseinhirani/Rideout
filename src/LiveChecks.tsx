import { useState } from "react";
import { api, type BackendState, type InformationCase, type InformationDecisionRow } from "./api";
import type { RunAction } from "./backend";
import { Bars, DashRail, FacilitatorTile, FocusView, Icon, Timeline, useFocus, type RailItem } from "./Dashboard";
import { callsFor, coordinationOf, inboundFrom, type LiveCall } from "./live";
import { CaseSettings, CommandForm, IntakeSettings, ManualCall, OrganizerInput, ReviewReport } from "./OrganizerForms";

type Focus = "outgoing" | "incoming" | "evidence" | "contacts" | "settings" | "facilitator" | "intake";

export function LiveChecks({ visible, state, row, now, disabled, run }: {
  visible: boolean; state: BackendState; row: InformationCase | null; now: number; disabled: boolean; run: RunAction;
}) {
  const { focus, open, close } = useFocus<Focus>(visible);
  const [direction, setDirection] = useState("");
  const calls = row ? callsFor(state, row.id) : [];
  const inbound = inboundFrom(state);
  const reviews = inbound.filter(r => r.row.status === "needs_review");
  const notes = state.notes.filter(n => n.support_case_id === row?.id);
  const planning = state.information_planning?.find(p => p.support_case_id === row?.id);
  const decision = [...(state.information_decisions ?? [])].filter(d => d.support_case_id === row?.id).sort((a, b) => b.based_on_revision - a.based_on_revision)[0];
  const active = calls.filter(c => c.transport === "active");
  const pending = calls.filter(c => ["active", "dispatching", "queued"].includes(c.transport ?? ""));
  const reported = calls.filter(c => c.progress?.report_received).length;
  const status = row ? coordinationOf(state, row.id, now).text : "Open an investigation to begin.";
  const rail: RailItem<Focus>[] = [
    { id: "outgoing", label: "Calls", value: calls.length, icon: "phoneOut", detail: `${reported} reports saved · ${active.length} on the line` },
    { id: "incoming", label: "Incoming reports", value: inbound.length, icon: "phoneIn", detail: `${reviews.length} awaiting review` },
    { id: "evidence", label: "Evidence", value: notes.length, icon: "check", detail: "Source-attributed accounts and organizer input" },
    { id: "contacts", label: "Directory", value: state.profiles.length, icon: "hand", detail: state.profiles.map(p => p.name).slice(0, 3).join(", ") || "No profiles yet" },
    { id: "settings", label: "Organizer controls", value: null, icon: "grid", detail: "Scope, consent, pause and closure" },
    { id: "intake", label: "Phone intake", value: null, icon: "phoneIn", detail: "Permissions for incoming investigations" },
    { id: "facilitator", label: "Coordinator", value: null, icon: "spark", agent: true, detail: status },
  ];
  const focused = rail.find(r => r.id === focus?.id);
  const stale = row && decision && decision.based_on_revision !== row.input_revision;
  return <section className={`dash${visible ? "" : " is-hidden"}${focus ? " focusing" : ""}`} aria-hidden={!visible} aria-label="Investigation dashboard">
    <DashRail items={rail} active={focus?.id ?? null} onOpen={open} />
    <div className={focus ? "dash-body blurred" : "dash-body"}>
      <header className="dash-head"><div><h1>Coordination</h1><p>{row ? `Investigation #${row.id} · ${row.status}${row.status !== "closed" && row.policy.paused ? " · paused" : ""}` : "Information coordination"}</p></div>
        <div className="dash-pills"><span className="dash-pill dark">{state.demo_mode.simulate ? "Simulated phones" : "Real calls"}</span><span className="dash-pill">{row ? `Revision ${row.input_revision}` : "Standing by"}</span></div>
      </header>
      <div className="dash-grid">
        <div className="dash-col">
          <button type="button" className="tile calls" onClick={e => open("outgoing", e)}>
            <span className="tile-title"><i className="swatch" />Outgoing calls<Icon name="expand" /></span>
            <span className="calls-figures"><span><small>Calls</small><strong>{calls.length}</strong></span><span><small>Reports saved</small><strong>{reported}</strong></span>{pending.length > 0 && <em className="chip">{pending.length} in progress</em>}</span>
            <Bars bars={calls.slice(-22).map(c => ({ id: String(c.attempt.id), height: c.transport === "active" ? 85 : c.transport === "ended" ? 60 : 30, tone: c.transport === "active" ? "live" : c.transport === "unknown" ? "hold" : c.transport === "ended" ? "done" : c.transport === "cancelled" ? "off" : "ring", title: `${c.person?.name ?? "Unknown"} · ${c.transportLabel} · ${c.reportLabel}` }))} empty="No calls yet" />
            <span className="tile-foot">Transport and saved reports are tracked separately.</span>
          </button>
          <div className="dash-pair low">
            <button type="button" className="tile lime" onClick={e => open("evidence", e)}><span className="tile-label">Evidence</span><strong className="huge">{notes.length}</strong><span className="tile-foot">Source-attributed accounts and organizer input</span></button>
            <button type="button" className="tile status" onClick={e => open("settings", e)}><span className="tile-title">Organizer controls<Icon name="expand" /></span><p>{row?.status === "closed" ? "Closed · history preserved" : row?.policy.paused ? "Paused · awaiting your decision" : planning?.enabled ? "Automatic questions enabled" : "Manual questions"}</p><span className="tile-foot">Scope, consent, pause and closure</span></button>
          </div>
        </div>
        <div className="dash-col agent-col">
          <FacilitatorTile name="Claude" kicker={row?.status === "closed" ? "Closed" : row?.policy.paused ? "Paused" : stale ? "Updating" : "Coordinator"} lead={decision?.plan.summary ?? row?.objective ?? "Describe an incident and what you need to learn."} live={!!row && row.status === "open" && !!planning?.enabled && !row.policy.paused} busy={false} disabled={disabled || !row || row.status === "closed"} chat={[]} suggestions={[]} placeholder="Give a direction or correction…" onOpen={e => { setDirection(""); open("facilitator", e); }} onAsk={(text, e) => { setDirection(text); open("facilitator", e); }} />
        </div>
      </div>
      <p className="dashboard-status" role="status">{status}</p>
    </div>
    {focus && focused && <FocusView focus={focus} title={focused.label} kicker={row ? `Investigation #${row.id}` : "RideOut"} icon={focused.icon} agent={focus.id === "facilitator"} onClose={close}>
      {focus.id === "outgoing" && <>
        {!row ? <p>Open an investigation first.</p> : <>
          <p>Tom calls within the authorized scope. Saving a report does not mean the call has ended.</p>
          {calls.map(call => <CallDetail key={call.attempt.id} state={state} row={row} call={call} run={run} disabled={disabled} />)}
          {!calls.length && <p>No calls placed yet.</p>}
          {planning?.enabled ? <p>Claude chooses calls within scope. Turn off automatic questions in organizer controls to place a manual call.</p> : <ManualCall state={state} row={row} run={run} disabled={disabled} />}
        </>}
      </>}
      {focus.id === "incoming" && <>
        {!inbound.length && <p>No incoming reports yet.</p>}
        {inbound.map(item => {
          const resolution = state.information_incoming_resolutions?.find(r => r.request_id === item.row.id);
          return <article className="record-card" key={item.row.id}><h3>Report #{item.row.id} · {item.label}</h3><p>{item.caller}</p><blockquote>{item.row.text}</blockquote>
            {item.row.review_reason && <p>{item.row.review_reason}</p>}
            {resolution && <p>Resolution: {resolution.kind}{resolution.support_case_id != null ? ` · Case #${resolution.support_case_id}` : ""}{resolution.note_id != null ? ` · Note #${resolution.note_id}` : ""} · {resolution.actor}<br />{resolution.reason}</p>}
            {item.row.status === "needs_review" && <ReviewReport state={state} report={item.row} run={run} disabled={disabled} />}
          </article>;
        })}
      </>}
      {focus.id === "evidence" && <>
        <p>Caller accounts remain unverified. Corrections are preserved alongside earlier reports.</p>
        {!notes.length && <p>No evidence recorded yet.</p>}
        {notes.map(n => <article className="record-card" key={n.id} id={`note-${n.id}`}><h3>Note #{n.id} · {n.source}</h3><small>{new Date(n.at).toLocaleString()}{n.attempt_id != null ? ` · Attempt #${n.attempt_id}` : ""}</small><p>{n.text}</p></article>)}
      </>}
      {focus.id === "contacts" && <><p>Search and authorize contacts when opening an investigation or changing its scope. A profile is not proof that someone is nearby or able to help.</p>{state.profiles.map(p => <article className="record-card" key={p.id}><h3>{p.name}</h3><p>Phone ending {p.phone_last4 || "not recorded"} · {state.profile_settings?.find(s => s.profile_id === p.id)?.call_consent ? "Calls allowed" : "Consent not recorded"}</p><p>Directory coordinates: {p.lat}, {p.lng} · current whereabouts unverified</p></article>)}</>}
      {focus.id === "settings" && (row ? <>
        <p>{status}</p>
        {row.status !== "closed" && <CommandForm run={run} disabled={disabled} label={row.policy.paused ? "Resume investigation" : "Pause investigation"} prepare={command_id => {
          const body = { command_id, expected_input_revision: row.input_revision, policy: { paused: !row.policy.paused } };
          return () => api.configure(row.id, body);
        }}><p>Pause stops new calls. Existing conversations continue. Resuming automatic coordination may initiate calls.</p></CommandForm>}
        <CaseSettings key={row.id} state={state} row={row} run={run} disabled={disabled} />
        <CloseCase row={row} run={run} disabled={disabled} />
      </> : <p>Open an investigation first.</p>)}
      {focus.id === "intake" && <IntakeSettings state={state} run={run} disabled={disabled} />}
      {focus.id === "facilitator" && <><p role="status">{status}</p>{row && <>
        <h3>Objective</h3><p>{row.objective}</p>
        {decision ? <Decision row={row} decision={decision} /> : <p>No accepted decision yet.</p>}
        <OrganizerInput key={`${row.id}:${direction}`} initial={direction} row={row} run={run} disabled={disabled} />
      </>}</>}
    </FocusView>}
  </section>;
}

function Decision({ row, decision }: { row: InformationCase; decision: InformationDecisionRow }) {
  const plan = decision.plan;
  return <div className="decision"><p className="chip">{row.status === "closed" ? "Historical decision" : decision.based_on_revision === row.input_revision ? "Current decision" : "Stale · newer input awaits evaluation"} · revision {decision.based_on_revision}</p>
    <p>{plan.summary}</p><small>{new Date(decision.created_at).toLocaleString()} · {decision.model} · {decision.id}</small>
    <p>Evidence: {plan.evidence_ids.join(", ") || "None cited"}</p>
    {!!plan.open_questions.length && <><h3>Unanswered questions</h3><ul>{plan.open_questions.map((q, i) => <li key={i}>{q}</li>)}</ul></>}
    {!!plan.concerns.length && <><h3>Concerns</h3>{plan.concerns.map((c, i) => <p key={i}>{c.explanation}<small>Evidence: {c.evidence_ids.join(", ")}</small></p>)}</>}
    {plan.wait_reason && <p>Waiting: {plan.wait_reason}</p>}{plan.organizer_review && <p>Organizer review: {plan.organizer_review}</p>}
    <details><summary>Accepted call decisions</summary>{plan.calls.map((c, i) => <p key={i}>Profile #{c.profile_id} · {c.question}<br />{c.reason}<small>Evidence: {c.evidence_ids.join(", ")}</small></p>)}{plan.queued.map(q => <p key={q.attempt_id}>Attempt #{q.attempt_id}: {q.disposition} · {q.reason}</p>)}</details>
  </div>;
}

function CallDetail({ state, row, call, run, disabled }: { state: BackendState; row: InformationCase; call: LiveCall; run: RunAction; disabled: boolean }) {
  const metadata = state.information_attempts?.find(m => m.attempt_id === call.attempt.id);
  const [reason, setReason] = useState(""); const [answer, setAnswer] = useState("");
  return <article className="record-card"><h3>{call.person?.name ?? "Unknown person"} · Attempt #{call.attempt.id}</h3>
    <p>{call.transportLabel} · {call.reportLabel}</p><small>Provider: {call.attempt.call_id ?? "Not assigned"} · Binding: {metadata?.binding_status ?? "unbound"} · Outcome: {metadata?.provider_terminal_status || "Not terminal"}</small>
    {metadata?.provider_end_reason && <p>End reason: {metadata.provider_end_reason}</p>}
    <Timeline lines={[{ at: "", who: "Question", text: call.attempt.ask, kind: "system" }, ...(call.attempt.answer ? [{ at: "", who: call.person?.name ?? "Caller", text: call.attempt.answer, kind: "them" as const }] : []), ...(call.attempt.concern ? [{ at: "", who: "Concern", text: call.attempt.concern, kind: "warn" as const }] : [])]} />
    {call.progress?.dispatch_error && <p role="alert">{call.progress.dispatch_error}</p>}{metadata?.interpretation_error && <p role="alert">Interpretation: {metadata.interpretation_error}</p>}
    {call.transport === "queued" && row.status !== "closed" && <CommandForm run={run} disabled={disabled} label="Cancel unsent call" prepare={command_id => { const body = { command_id, expected_input_revision: row.input_revision, reason }; return () => api.cancel(call.attempt.id, body); }}><label>Cancellation reason<input required value={reason} onChange={e => setReason(e.target.value)} /></label></CommandForm>}
    {state.demo_mode.simulate && call.simulated && !call.progress?.report_received && ["active", "unknown"].includes(call.transport ?? "") && <CommandForm run={run} disabled={disabled} label="Submit simulated report" prepare={() => { const text = answer; return () => api.simulationReport(call.attempt.id, text, ""); }}><label>Simulated caller account<textarea required value={answer} onChange={e => setAnswer(e.target.value)} /></label></CommandForm>}
  </article>;
}

function CloseCase({ row, run, disabled }: { row: InformationCase; run: RunAction; disabled: boolean }) {
  const [reason, setReason] = useState("");
  if (row.status === "closed") return <p>Closed. No new outreach. Active calls and late reports remain tracked.</p>;
  return <CommandForm run={run} disabled={disabled} label="Close investigation" prepare={command_id => { const body = { command_id, expected_input_revision: row.input_revision, reason }; return () => api.closeCase(row.id, body); }}>
    <h3>Close investigation</h3><label>Reason<textarea required value={reason} onChange={e => setReason(e.target.value)} /></label><p>Closure cancels unsent work and stops new outreach. It does not hang up active calls.</p>
  </CommandForm>;
}
