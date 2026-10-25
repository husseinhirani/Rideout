import { useState } from "react";
import type { BackendState } from "./api";
import { eventKey } from "./backend";
import { Agent, FacilitatorChat } from "./Checks";
import { awaitingSimulatedReport, briefOf, callsFor, cancellable, currentCase, inboundFrom, latestIncident, type LiveCall } from "./live";
import type { ChatMessage, House } from "./types";

export type LiveActions = {
  cancel: (attemptId: number) => Promise<string>;
  report: (attemptId: number, answer: string, concern: string) => Promise<void>;
  callYourself: (call: LiveCall) => void;
  checkIn: (incidentId: number, profileId: number, result: "safe" | "victim") => Promise<void>;
  inbound: (fromPhone: string, text: string, providerCallId: string) => Promise<string>;
  ask: (text: string) => void;
};

/**
 * The same three desks as the offline drill, reading the backend instead of a script.
 * Simulation controls appear only when the backend says calls are simulated, and they
 * stand in for the person on the phone, never for the dispatcher.
 */
export function LiveChecks({
  visible,
  state,
  caseId,
  houses,
  chat,
  busy,
  operatorBusy,
  now,
  actions,
}: {
  visible: boolean;
  state: BackendState;
  caseId: number | null;
  houses: House[];
  chat: ChatMessage[];
  busy: boolean;
  operatorBusy: boolean;
  now: number;
  actions: LiveActions;
}) {
  const row = currentCase(state, caseId);
  const calls = callsFor(state, row?.id ?? null);
  const sweep = latestIncident(state, true);
  const inbound = inboundFrom(state);
  const review = inbound.filter((item) => item.review);
  const simulate = state.demo_mode.simulate;
  const callerLive = calls.some((call) => call.transport === "active" || call.transport === "dispatching" || call.transport === "queued");
  const suggestions = row ? briefOf(row.brief).suggestions.slice(0, 3) : [];

  return (
    <section className={visible ? "checks" : "checks is-hidden"} aria-hidden={!visible} aria-label="Agent workflow">
      <header className="term-bar">
        <p>rideout · checks · live backend</p>
        <p>{state.demo_mode.simulate ? "simulated calls" : "real calls"}</p>
      </header>
      <Agent title="Check-in caller" name="Amina Diallo" duty="Places the calls the backend plans and shows what each call actually did." live={callerLive} source="caller">
        {sweep ? <CheckIns state={state} incidentId={sweep.id} houses={houses} simulate={simulate} onCheckIn={actions.checkIn} /> : null}
        {calls.length === 0 ? (
          <p className="term-wait">{row ? "No calls planned for this case yet." : "Calls appear once a case opens."}</p>
        ) : (
          <div className="call-board">
            <p className="legend">Call status comes from the phone provider. A report is separate: answered does not mean the call ended.</p>
            {calls.map((call) => (
              <LiveCallItem key={call.attempt.id} call={call} now={now} simulate={simulate} operatorBusy={operatorBusy} actions={actions} />
            ))}
          </div>
        )}
      </Agent>

      <Agent title="Call taker" name="Elena Vasquez" duty="Records people who call in. A caller is matched by phone number, which is not identity verification." live={inbound.some((item) => item.row.status === "pending" || item.row.status === "prepared")} source="inbound">
        {review.length ? (
          <div className="agent-now">
            <p className="kicker hot">Needs you · {review.length}</p>
            {review.map((item) => (
              <p key={item.row.id} className="warn">
                {item.caller}: {item.label}. {item.row.reply}
              </p>
            ))}
          </div>
        ) : null}
        {inbound.length === 0 ? <p className="term-wait">{state.demo_mode.inbound ? "No one has called in yet." : "Inbound calls are not enabled on this backend."}</p> : null}
        <div className="call-board">
          {inbound.slice(0, 8).map((item) => (
            <div key={item.row.id} className={`call-item inbound-item${item.review ? " needs-you" : ""}`}>
              <p className="call-hit">
                <i className={`dot ${item.row.status === "recorded" ? "live" : item.review ? "holding" : "calling"}`} />
                <span>{item.caller}</span>
                <em>{item.label}</em>
              </p>
              <div className="call-detail">
                <div>
                  <p>“{item.row.text}”</p>
                  <p>Reply to caller: {item.row.reply || "Saved and being processed."}</p>
                  {item.row.support_case_id !== null ? <p>Linked to case #{item.row.support_case_id}.</p> : null}
                </div>
              </div>
            </div>
          ))}
        </div>
        {simulate && state.demo_mode.inbound ? <SimulatedInbound state={state} onSend={actions.inbound} /> : null}
      </Agent>

      <Agent title="Facilitator" name="Jonah Reid" duty="Passes what you type to the case. The backend decides who is called next and says why." live={busy} source="facilitator" wide>
        <div className="agent-now">
          <p className="kicker">{row ? `Case #${row.id}` : "No case"}</p>
          <p className="action">{row ? briefOf(row.brief).summary || row.goal : "Open a case first, or describe the incident below when the backend can use Claude."}</p>
        </div>
        <FacilitatorChat
          chat={chat}
          busy={busy}
          onAsk={actions.ask}
          suggestions={suggestions}
          empty="What you send is saved as dispatcher input on the case. It is not verified."
          busyText="Sending to the backend…"
          placeholder={row ? "A witness reports a red backpack near the playground…" : "Describe what is happening…"}
        />
      </Agent>
    </section>
  );
}

function LiveCallItem({ call, now, simulate, operatorBusy, actions }: { call: LiveCall; now: number; simulate: boolean; operatorBusy: boolean; actions: LiveActions }) {
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [answer, setAnswer] = useState("");
  const [concern, setConcern] = useState("");
  const dot = call.transport === "active" ? "live" : call.transport === "unknown" ? "holding" : call.transport === "cancelled" ? "canceled" : call.transport === "ended" ? "done" : "calling";
  const pending = call.transport === "active" || call.transport === "dispatching" || call.transport === "queued";
  const showReport = simulate && awaitingSimulatedReport(call);
  return (
    <div className={`call-item${open || showReport ? " open" : ""}${call.transport === "unknown" ? " needs-you" : ""}`}>
      <button type="button" className="call-hit" onClick={() => setOpen(!open)}>
        <i className={`dot ${dot}`} />
        <span>
          {call.person?.name ?? "Unknown"}
          {call.simulated ? <small className="call-tag">simulated</small> : null}
        </span>
        <em>{call.transportLabel}</em>
      </button>
      <div className="call-actions">
        <span className="badge">{call.reportLabel}</span>
        {cancellable(call) ? (
          <button type="button" onClick={async () => setNotice(await actions.cancel(call.attempt.id))}>
            Cancel call
          </button>
        ) : null}
        {pending && call.person ? (
          <button type="button" disabled={operatorBusy} onClick={() => actions.callYourself(call)}>
            Call them yourself
          </button>
        ) : null}
      </div>
      <div className="call-detail">
        <div>
          <p>Asked: “{call.attempt.ask}”</p>
          {call.attempt.answer ? <p>Reported: “{call.attempt.answer}”</p> : null}
          {call.attempt.concern ? <p className="warn">Concern: {call.attempt.concern}</p> : null}
          {call.progress?.dispatch_error ? <p className="warn">Dispatch: {call.progress.dispatch_error}</p> : null}
          {call.followUpAt !== null && !call.progress?.review_consumed ? (
            <p>Follow-up review {call.followUpAt > now ? `in ${Math.ceil((call.followUpAt - now) / 1000)} s` : "due"}. A due review does not guarantee another call.</p>
          ) : null}
          {notice ? <p className="warn">{notice}</p> : null}
          {showReport ? (
            <form
              className="sim-report"
              onSubmit={async (event) => {
                event.preventDefault();
                if (!answer.trim()) return;
                try {
                  await actions.report(call.attempt.id, answer, concern);
                  setAnswer("");
                  setConcern("");
                } catch (error) {
                  setNotice(error instanceof Error ? error.message : "Report was not saved");
                }
              }}
            >
              <small>Simulated helper report · what {call.person?.name ?? "the helper"} says on the call</small>
              <input value={answer} onChange={(event) => setAnswer(event.target.value)} placeholder="Yes, I can check the park bench." aria-label="Simulated helper answer" />
              <input value={concern} onChange={(event) => setConcern(event.target.value)} placeholder="Concern, if any" aria-label="Simulated concern" />
              <button type="submit" disabled={!answer.trim()}>
                Send report
              </button>
            </form>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function CheckIns({
  state,
  incidentId,
  houses,
  simulate,
  onCheckIn,
}: {
  state: BackendState;
  incidentId: number;
  houses: House[];
  simulate: boolean;
  onCheckIn: LiveActions["checkIn"];
}) {
  const people = state.incident_people.filter((row) => row.incident_id === incidentId);
  const count = (status: string) => people.filter((row) => row.status === status).length;
  const waiting = people.filter((row) => row.status === "checking_in" || row.status === "unknown");
  return (
    <div className="agent-now">
      <p className="kicker">
        Check-in sweep · {count("safe")} safe · {count("victim")} need help · {count("unknown")} no answer · {count("checking_in")} calling
      </p>
      {simulate
        ? waiting.map((person) => {
            const profile = state.profiles.find((row) => row.id === person.profile_id);
            const house = houses.find((row) => row.name === profile?.name);
            return (
              <div key={person.id} className="sim-checkin">
                <span>
                  {profile?.name ?? "Unknown"}
                  {person.status === "unknown" ? " · no answer yet" : ""}
                </span>
                <button type="button" onClick={() => void onCheckIn(incidentId, person.profile_id, "safe")} aria-label={`Simulate ${profile?.name} answering safe`}>
                  Safe
                </button>
                <button type="button" onClick={() => void onCheckIn(incidentId, person.profile_id, "victim")} aria-label={`Simulate ${profile?.name} needing a ride`}>
                  Needs a ride
                </button>
                {house ? null : <small>off the map</small>}
              </div>
            );
          })
        : null}
      {simulate && waiting.length ? <small className="sim-caption">Simulated answers stand in for the resident on the phone.</small> : null}
    </div>
  );
}

function SimulatedInbound({ state, onSend }: { state: BackendState; onSend: LiveActions["inbound"] }) {
  const callers = state.profiles.filter((profile) => profile.phone);
  const [phone, setPhone] = useState(() => callers.find((profile) => profile.id === state.demo_mode.reporter_id)?.phone ?? callers[0]?.phone ?? "");
  const [text, setText] = useState("");
  const [key, setKey] = useState(() => "sim-inbound-" + eventKey());
  const [reply, setReply] = useState<string | null>(null);
  return (
    <form
      className="sim-report"
      onSubmit={async (event) => {
        event.preventDefault();
        if (!text.trim() || !phone) return;
        try {
          setReply(await onSend(phone, text, key));
          setText("");
          setKey("sim-inbound-" + eventKey());
        } catch (error) {
          setReply(error instanceof Error ? error.message : "Inbound call was not saved");
        }
      }}
    >
      <small>Simulated inbound call · fictional caller metadata</small>
      <select value={phone} onChange={(event) => setPhone(event.target.value)} aria-label="Simulated caller">
        {callers.map((profile) => (
          <option key={profile.id} value={profile.phone}>
            {profile.name} · {profile.phone}
          </option>
        ))}
      </select>
      <input value={text} onChange={(event) => setText(event.target.value)} placeholder="What the caller says…" aria-label="Simulated caller words" />
      <button type="submit" disabled={!text.trim() || !phone}>
        Send call
      </button>
      {reply ? <small>Reply: {reply}</small> : null}
    </form>
  );
}
