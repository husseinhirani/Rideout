import { useState } from "react";
import { CallTranscript } from "./CallTranscript";
import { CallAudio } from "./CallAudio";
import type { BackendState } from "./api";
import { eventKey } from "./backend";
import { FacilitatorChat } from "./Checks";
import {
  barHeight,
  Bars,
  DashRail,
  FacilitatorTile,
  FocusView,
  Icon,
  initials,
  mmss,
  PeopleList,
  seconds,
  StatusSticks,
  Timeline,
  useFocus,
  type Bar,
  type BarTone,
  type RailItem,
  type TimelineLine,
} from "./Dashboard";
import { awaitingSimulatedReport, briefOf, callsFor, cancellable, coordinationOf, currentCase, inboundFrom, latestIncident, type InboundView, type LiveCall } from "./live";
import type { CallCard, ChatMessage, House } from "./types";

export type LiveActions = {
  cancel: (attemptId: number) => Promise<string>;
  report: (attemptId: number, answer: string, concern: string) => Promise<void>;
  callYourself: (call: LiveCall) => void;
  checkIn: (incidentId: number, profileId: number, result: "safe" | "victim") => Promise<void>;
  inbound: (fromPhone: string, text: string, providerCallId: string) => Promise<string>;
  ask: (text: string) => void;
};

type Focus = "outgoing" | "incoming" | "checkins" | "need" | "help" | "links" | "facilitator";

/**
 * The same board as the offline drill, reading the backend instead of a script.
 * Simulation controls appear only when the backend says calls are simulated, and they
 * stand in for the person on the phone, never for the dispatcher.
 */
export function LiveChecks({
  visible,
  state,
  caseId,
  houses,
  mockCalls = [],
  firstProfileId,
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
  mockCalls?: CallCard[];
  firstProfileId?: number;
  chat: ChatMessage[];
  busy: boolean;
  operatorBusy: boolean;
  now: number;
  actions: LiveActions;
}) {
  const row = currentCase(state, caseId);
  const calls = callsFor(state, row?.id ?? null).sort((a, b) => Number(b.person?.id === firstProfileId) - Number(a.person?.id === firstProfileId));
  const mockActive = mockCalls.filter(call => call.phase === "live").length;
  const mockPending = mockCalls.filter(call => call.phase === "live" || call.phase === "calling").length;
  const total = calls.length + mockCalls.length;
  const realCount = calls.filter(call => !call.simulated).length;
  const sweep = row?.kind === "information" ? null : latestIncident(state, true);
  const inbound = inboundFrom(state);
  const review = inbound.filter((item) => item.review);
  const simulate = state.demo_mode.simulate;
  const brief = row ? briefOf(row.brief) : null;
  const { focus, open, close } = useFocus<Focus>(visible);

  const pending = calls.filter((call) => call.transport === "active" || call.transport === "dispatching" || call.transport === "queued");
  const active = calls.filter((call) => call.transport === "active");
  const current = active[0] ?? null;
  const reported = calls.filter((call) => call.progress?.report_received || call.attempt.outcome === "answered").length;
  const reach = calls.length ? Math.round((reported / calls.length) * 100) : 0;
  const people = sweep ? state.incident_people.filter((item) => item.incident_id === sweep.id) : [];
  const count = (status: string) => people.filter((item) => item.status === status).length;
  const needHelp = houses.filter((house) => house.status === "needs_ride");
  const helperIds = [...new Set(state.coordination.filter((item) => !row || item.support_case_id === row.id).flatMap((item) => item.helper_profile_ids))];
  const helpers = helperIds.map((id) => state.profiles.find((profile) => profile.id === id)).filter((profile) => profile !== undefined);
  const links = calls
    .filter((call) => call.progress?.accepted_at_ms != null)
    .map((call) => {
      const caseRow = state.cases.find((item) => item.id === call.attempt.support_case_id);
      const person = state.profiles.find((profile) => profile.id === caseRow?.victim_profile_id);
      return { key: call.attempt.id, from: call.person?.name ?? "Unknown", to: person?.name ?? `case #${call.attempt.support_case_id}` };
    });
  const incident = state.incidents.find((item) => item.id === row?.incident_id) ?? sweep;
  const elapsed = incident ? seconds(Date.parse(incident.created_at) || now, now) : 0;
  const status = pending.length + mockPending ? "Live" : row ? (row.status === "closed" ? "Case closed" : `Case #${row.id}`) : "Standing by";
  const coordination = row ? coordinationOf(state, row.id, now) : null;
  const latest = inbound[0];

  const rail: RailItem<Focus>[] = [
    {
      id: "outgoing",
      label: "Outgoing calls",
      value: total,
      icon: "phoneOut",
      detail: mockCalls.length ? `${realCount} real · ${total - realCount} simulated · ${active.length + mockActive} on the line` : calls.length ? `${reach}% reported · ${active.length} on the line${current?.person ? ` · ${current.person.name.split(" ")[0]}` : ""}` : row ? "No calls planned yet" : "Calls appear once a case opens",
    },
    {
      id: "incoming",
      label: "Incoming calls",
      value: inbound.length,
      icon: "phoneIn",
      detail: review.length ? `${review.length} need${review.length === 1 ? "s" : ""} you` : latest ? `${latest.caller.split(" · ")[0]} · ${latest.label}` : state.demo_mode.inbound ? "Line open" : "Inbound calls are off",
    },
    {
      id: "checkins",
      label: "Check-in sweep",
      value: people.length,
      icon: "check",
      detail: sweep ? `${count("safe")} safe · ${count("victim")} need help · ${count("unknown")} no answer` : "No sweep yet",
    },
    { id: "need", label: "Need help", value: needHelp.length, icon: "alert", detail: names(needHelp.map((house) => house.name), "No one has asked for help") },
    { id: "help", label: "Can help", value: helpers.length, icon: "hand", detail: names(helpers.map((profile) => profile.name), "No helpers yet") },
    { id: "links", label: "Accepted", value: links.length, icon: "link", detail: links[0] ? `${links[0].from} → ${links[0].to}` : "No helper has accepted yet" },
    { id: "facilitator", label: "Facilitator agent", value: null, icon: "spark", agent: true, detail: busy ? "Working…" : row ? `Case #${row.id}` : "No case" },
  ];
  const focused = focus ? rail.find((item) => item.id === focus.id) : undefined;

  return (
    <section className={`dash${visible ? "" : " is-hidden"}${focus ? " focusing" : ""}`} aria-hidden={!visible} aria-label="Checks">
      <DashRail items={rail} active={focus?.id ?? null} onOpen={open} />

      <div className={focus ? "dash-body blurred" : "dash-body"}>
        <header className="dash-head">
          <div>
            <h1>Checks</h1>
            <p>{incident?.type ? incident.type[0].toUpperCase() + incident.type.slice(1) : incident ? "Incident" : "No incident yet"} · live backend</p>
          </div>
          <div className="dash-pills">
            <span className={`dash-pill${pending.length + mockPending ? " live" : ""}`}>
              <i />
              {status}
            </span>
            <span className="dash-pill">
              <Icon name="clock" />
              {mmss(elapsed)}
            </span>
            <span className="dash-pill dark">{mockCalls.length ? "Real + simulated calls" : simulate ? "Simulated calls" : "Real calls"}</span>
          </div>
        </header>

        <div className="dash-grid">
          <div className="dash-col">
            <button type="button" className="tile calls" onClick={(event) => open("outgoing", event)}>
              <span className="tile-title">
                <i className="swatch" />
                Outgoing calls
                <Icon name="expand" />
              </span>
              <span className="calls-figures">
                <span>
                  <small>Calls</small>
                  <strong>{total}</strong>
                </span>
                <span>
                  <small>Reports in</small>
                  <strong>{reported}</strong>
                </span>
                {pending.length + mockPending ? <em className="chip">{pending.length + mockPending} in progress</em> : null}
              </span>
              <Bars bars={[...liveBars(calls, now, current), ...mockCalls.map(call => ({ id: call.id, tone: mockTone(call), height: call.phase === "calling" ? 34 : barHeight(seconds(call.answeredAt ?? call.startedAt, call.endedAt ?? now), 42), title: `${call.name} · Simulated` }))]} empty={row ? "No calls planned for this case yet" : "Calls appear once a case opens"} />
              <span className="legend-row">
                <span><i className="k-live" />Active</span>
                <span><i className="k-ring" />Placing</span>
                <span><i className="k-hold" />Unresolved</span>
                <span><i className="k-done" />Ended</span>
              </span>
            </button>

            <div className="dash-pair low">
              <button type="button" className="tile lime" onClick={(event) => open("links", event)}>
                <span className="tile-label">
                  <em className="chip light">
                    <Icon name="link" /> Accepted
                  </em>
                </span>
                <span className="pager" aria-hidden="true">
                  {Array.from({ length: Math.max(4, links.length) }, (_, index) => (
                    <i key={index} className={index < links.length ? "on" : ""} />
                  ))}
                </span>
                <span className="tile-unit">helpers accepted</span>
                <strong className="huge">{links.length}</strong>
                <span className="tile-foot">{links[0] ? `${links[0].from} → ${links[0].to}` : "No helper has accepted yet"}</span>
              </button>

              <button type="button" className="tile status" onClick={(event) => open("checkins", event)}>
                <span className="tile-title">
                  Check-in sweep
                  <Icon name="expand" />
                </span>
                <StatusSticks houses={houses} waitingLabel="Waiting" />
              </button>

            </div>
          </div>
          <div className="dash-col agent-col">
            <FacilitatorTile
              chat={chat}
              name="Jonah Reid"
              kicker={row ? `Case #${row.id}` : "No case"}
              lead={row ? brief?.summary || row.goal : "Open a case first, or describe the incident when the backend can use Claude."}
              live={busy}
              busy={busy}
              suggestions={brief?.suggestions.slice(0, 3) ?? []}
              placeholder={row ? "A witness reports a red backpack near the playground…" : "Describe what is happening…"}
              onOpen={(from) => open("facilitator", from)}
              onAsk={(text) => actions.ask(text)}
            />
          </div>
        </div>
      </div>

      {focus && focused ? (
        <FocusView focus={focus} title={focused.label} kicker={focus.id === "facilitator" ? "Manager agent" : status} icon={focused.icon} agent={focus.id === "facilitator"} onClose={close}>
          {focus.id === "outgoing" ? (
            <>
              <div className="focus-stats">
                <span><strong>{total}</strong>calls</span>
                <span><strong>{active.length + mockActive}</strong>active</span>
                <span><strong>{reported}</strong>reports in</span>
                <span><strong>{calls.filter((call) => call.transport === "unknown").length}</strong>unresolved</span>
              </div>
              <p className="focus-note">{mockCalls.length ? `${realCount} real call${realCount === 1 ? "" : "s"} · ${total - realCount} simulated calls. Scripted neighbors do not contribute saved reports.` : "Call status comes from the phone provider. Reports are saved separately."}</p>
              {total === 0 ? (
                <p className="focus-empty">{row ? "No calls planned for this case yet." : "Calls appear once a case opens."}</p>
              ) : (
                <ul className="call-list">
                  {calls.map((call) => (
                    <LiveCallRow key={call.attempt.id} call={call} now={now} simulate={simulate} operatorBusy={operatorBusy} actions={actions} initial={focus.item === String(call.attempt.id)} />
                  ))}
                  {mockCalls.map(call => <MockCallRow key={call.id} call={call} now={now} />)}
                </ul>
              )}
            </>
          ) : null}
          {focus.id === "incoming" ? (
            <>
              <div className="focus-stats">
                <span><strong>{inbound.length}</strong>calls in</span>
                <span><strong>{review.length}</strong>need you</span>
                <span><strong>{inbound.filter((item) => item.row.status === "recorded").length}</strong>recorded</span>
                <span><strong>{inbound.filter((item) => item.row.support_case_id !== null).length}</strong>on a case</span>
              </div>
              <p className="focus-note">Elena Vasquez records people who call in. A caller is matched by phone number, which is not identity verification.</p>
              {inbound.length === 0 ? (
                <p className="focus-empty">{state.demo_mode.inbound ? "No one has called in yet." : "Inbound calls are not enabled on this backend."}</p>
              ) : (
                <ul className="call-list">
                  {inbound.slice(0, 12).map((item) => (
                    <InboundRow key={item.row.id} item={item} />
                  ))}
                </ul>
              )}
              {simulate && state.demo_mode.inbound ? <SimulatedInbound state={state} onSend={actions.inbound} /> : null}
            </>
          ) : null}
          {focus.id === "checkins" ? (
            <>
              <div className="focus-stats">
                <span><strong>{count("safe")}</strong>safe</span>
                <span><strong>{count("victim")}</strong>need help</span>
                <span><strong>{count("unknown")}</strong>no answer</span>
                <span><strong>{count("checking_in")}</strong>calling</span>
              </div>
              {sweep ? (
                <CheckIns state={state} incidentId={sweep.id} houses={houses} simulate={simulate} onCheckIn={actions.checkIn} />
              ) : (
                <p className="focus-empty">No check-in sweep yet. Start a wildfire drill from Start in the top bar.</p>
              )}
            </>
          ) : null}
          {focus.id === "need" ? (
            <PeopleList people={needHelp.map((house) => ({ key: house.id, name: house.name, note: house.note, chip: "Needs a ride", tone: "need" }))} empty="No one has asked for help." />
          ) : null}
          {focus.id === "help" ? (
            <PeopleList
              people={helpers.map((profile) => ({
                key: profile.id,
                name: profile.name,
                note: `Helper on case ${state.coordination.filter((item) => item.helper_profile_ids.includes(profile.id)).map((item) => `#${item.support_case_id}`).join(", ")}`,
                chip: "Helper",
                tone: "help",
              }))}
              empty="No helpers on this case yet."
            />
          ) : null}
          {focus.id === "links" ? (
            links.length === 0 ? (
              <p className="focus-empty">No helper has accepted yet. A helper shows here once their report is accepted.</p>
            ) : (
              <ul className="link-list">
                {links.map((link) => (
                  <li key={link.key}>
                    <span className="face help">{initials(link.from)}</span>
                    <span>
                      <b>{link.from}</b>
                      <small>Helper · accepted</small>
                    </span>
                    <i />
                    <span className="face need">{initials(link.to)}</span>
                    <span>
                      <b>{link.to}</b>
                      <small>Needs help</small>
                    </span>
                  </li>
                ))}
              </ul>
            )
          ) : null}
          {focus.id === "facilitator" ? (
            <>
              <div className={busy ? "agent-status live" : "agent-status"}>
                <p>{row ? `Case #${row.id}` : "No case"}</p>
                <span>{row ? brief?.summary || row.goal : "Open a case first, or describe the incident below when the backend can use Claude."}</span>
              </div>
              {coordination ? (
                <ul className="agent-notes">
                  <li className={coordination.kind === "blocked" || coordination.kind === "retrying" ? "warn" : ""}>{coordination.text}</li>
                </ul>
              ) : null}
              <FacilitatorChat
                chat={chat}
                busy={busy}
                onAsk={actions.ask}
                suggestions={brief?.suggestions.slice(0, 3) ?? []}
                empty="What you send is saved as dispatcher input on the case. It is not verified."
                busyText="Sending to the backend…"
                placeholder={row ? "A witness reports a red backpack near the playground…" : "Describe what is happening…"}
              />
            </>
          ) : null}
        </FocusView>
      ) : null}
    </section>
  );
}

function names(list: string[], none: string) {
  if (list.length === 0) return none;
  return list.length > 2 ? `${list.slice(0, 2).join(", ")} +${list.length - 2}` : list.join(" and ");
}

function callTone(call: LiveCall): BarTone {
  if (call.transport === "active") return "live";
  if (call.transport === "queued" || call.transport === "dispatching") return "ring";
  if (call.transport === "unknown") return "hold";
  if (call.transport === "cancelled" || call.attempt.outcome === "cancelled" || call.attempt.outcome === "superseded") return "off";
  if (call.attempt.outcome === "no_answer") return "miss";
  if (call.transport === undefined && call.attempt.outcome === null) return call.attempt.call_id ? "ring" : "off";
  return "done";
}

// How long a call ran before its report came back; an active call counts up to now.
function liveLength(call: LiveCall, now: number) {
  const from = call.progress?.claimed_at_ms;
  if (!from) return null;
  const to = call.progress?.report_received_at_ms ?? (call.transport === "active" ? now : null);
  return to === null ? null : seconds(from, to);
}

function liveBars(calls: LiveCall[], now: number, current: LiveCall | null): Bar[] {
  const shown = calls.slice(-22);
  const longest = Math.max(5, ...shown.filter((call) => call.transport !== "active").map((call) => liveLength(call, now) ?? 0));
  return shown.map((call) => {
    const tone = callTone(call);
    const length = liveLength(call, now);
    return {
      id: String(call.attempt.id),
      tone,
      height: length !== null ? barHeight(length, longest) : tone === "ring" ? 34 : tone === "done" ? 46 : 16,
      title: `${call.person?.name ?? "Unknown"} · ${call.transportLabel} · ${call.reportLabel}`,
      tag: call === current ? `${(call.person?.name ?? "Unknown").split(" ")[0]}${length !== null ? ` · ${mmss(length)}` : ""}` : undefined,
    };
  });
}

function timeOf(ms: number | null | undefined) {
  return ms ? new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" }) : "—";
}

function LiveCallRow({
  call,
  now,
  simulate,
  actions,
  initial,
}: {
  call: LiveCall;
  now: number;
  simulate: boolean;
  operatorBusy: boolean;
  actions: LiveActions;
  initial: boolean;
}) {
  const [open, setOpen] = useState(initial);
  const [notice, setNotice] = useState<string | null>(null);
  const [answer, setAnswer] = useState("");
  const [concern, setConcern] = useState("");
  const showReport = simulate && awaitingSimulatedReport(call);
  const shown = open || showReport || call.transport === "unknown";
  const name = call.person?.name ?? "Unknown";
  const first = name.split(" ")[0];
  const created = Date.parse(call.attempt.created_at) || null;
  const placed = call.progress?.claimed_at_ms ?? null;
  const reportedAt = call.progress?.report_received_at_ms ?? null;
  const length = liveLength(call, now);
  const stamp = (ms: number | null) => (ms && created ? mmss(seconds(created, ms)) : "");

  const lines: TimelineLine[] = [{ at: "0:00", who: "Assigned question", text: call.attempt.ask, kind: "system" }];
  if (placed) lines.push({ at: stamp(placed), who: "", text: call.simulated ? "Simulated call placed." : "Call placed.", kind: "system" });
  if (call.attempt.answer) lines.push({ at: stamp(reportedAt), who: `${first} · saved report`, text: call.attempt.answer, kind: "them" });
  if (call.attempt.concern) lines.push({ at: stamp(reportedAt), who: "Concern", text: call.attempt.concern, kind: "warn" });
  if (call.progress?.dispatch_error) lines.push({ at: "", who: "Dispatch", text: call.progress.dispatch_error, kind: "warn" });
  if (call.followUpAt !== null && !call.progress?.review_consumed) {
    lines.push({
      at: "",
      who: "",
      text: `Follow-up review ${call.followUpAt > now ? `in ${Math.ceil((call.followUpAt - now) / 1000)} s` : "due"}. A due review does not guarantee another call.`,
      kind: "system",
    });
  }
  if (notice) lines.push({ at: "", who: "", text: notice, kind: "warn" });

  return (
    <li className={`dash-call t-${callTone(call)}${shown ? " open" : ""}`}>
      <button type="button" className="call-head" onClick={() => setOpen(!open)} aria-expanded={shown}>
        <span className="face">{initials(name)}</span>
        <span className="call-name">
          <b>{name}</b>
          <small>
            {created ? new Date(created).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "Not dialed"}
            {call.simulated ? " · simulated" : ""} · {call.reportLabel}
          </small>
        </span>
        <em className="call-state">
          <i />
          {call.transportLabel.split(" · ")[0]}
        </em>
        <span className="call-time">{length === null ? "—" : mmss(length)}</span>
        <Icon name="chevron" />
      </button>
      <div className="call-drop">
        <div>
          <div className="call-meta">
            <span>
              <small>Phone provider</small>
              {call.transportLabel}
            </span>
            <span>
              <small>Report</small>
              {call.reportLabel}
            </span>
            <span>
              <small>Placed</small>
              {timeOf(placed)}
            </span>
          </div>
          {cancellable(call) && <div className="call-actions">
            <button type="button" onClick={async () => setNotice(await actions.cancel(call.attempt.id))}>
              <Icon name="close" /> Cancel call
            </button>
          </div>}
          <Timeline lines={lines} />
          {shown && !call.simulated && call.attempt.call_id && <CallTranscript key={call.attempt.id} attemptId={call.attempt.id} name={name} ended={call.transport === "ended"} />}
          {shown && !call.simulated && call.transport === "ended" && call.attempt.call_id && <CallAudio attemptId={call.attempt.id} />}
          {showReport ? (
            <form
              className="dash-sim"
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
              <small>Simulated helper report · what {name} says on the call</small>
              <input value={answer} onChange={(event) => setAnswer(event.target.value)} placeholder="Yes, I can check the park bench." aria-label="Simulated helper answer" />
              <input value={concern} onChange={(event) => setConcern(event.target.value)} placeholder="Concern, if any" aria-label="Simulated concern" />
              <button type="submit" disabled={!answer.trim()}>
                Send report
              </button>
            </form>
          ) : null}
        </div>
      </div>
    </li>
  );
}

function mockTone(call: CallCard): BarTone {
  return call.phase === "calling" ? "ring" : call.phase === "live" ? "live" : call.phase === "missed" ? "miss" : "done";
}

function MockCallRow({ call, now }: { call: CallCard; now: number }) {
  const [open, setOpen] = useState(false);
  const label = call.phase === "calling" ? "Ringing" : call.phase === "live" ? "Active" : call.phase === "missed" ? "No answer" : "Ended";
  return <li className={`dash-call t-${mockTone(call)}${open ? " open" : ""}`}>
    <button type="button" className="call-head" onClick={() => setOpen(!open)} aria-expanded={open}>
      <span className="face">{initials(call.name)}</span>
      <span className="call-name"><b>{call.name}</b><small>Simulated · wildfire drill</small></span>
      <em className="call-state"><i />{label}</em>
      <span className="call-time">{mmss(seconds(call.answeredAt ?? call.startedAt, call.endedAt ?? now))}</span>
      <Icon name="chevron" />
    </button>
    <div className="call-drop"><div>
      <p className="focus-note">Scripted demo call. This neighbor has not been phoned.</p>
      <Timeline lines={[
        { at: "0:00", who: "Agent · simulated", text: "Are you safe, and can you leave on your own?", kind: "you" },
        ...(call.transcript ? [{ at: mmss(seconds(call.startedAt, call.answeredAt ?? now)), who: call.name, text: call.transcript, kind: "them" as const }] : []),
        { at: mmss(seconds(call.startedAt, call.endedAt ?? now)), who: "", text: label, kind: "system" },
      ]} />
    </div></div>
  </li>;
}

function InboundRow({ item }: { item: InboundView }) {
  const [open, setOpen] = useState(item.review);
  const [who, how] = item.caller.split(" · ");
  const tone: BarTone = item.row.status === "recorded" ? "done" : item.review ? "hold" : "ring";
  return (
    <li className={`dash-call t-${tone}${open ? " open" : ""}`}>
      <button type="button" className="call-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="face">{initials(who)}</span>
        <span className="call-name">
          <b>{who}</b>
          <small>{how}</small>
        </span>
        <em className="call-state">
          <i />
          {item.label}
        </em>
        <span className="call-time">{item.row.support_case_id !== null ? `#${item.row.support_case_id}` : "—"}</span>
        <Icon name="chevron" />
      </button>
      <div className="call-drop">
        <div>
          <Timeline
            lines={[
              { at: "", who: who.split(" ")[0], text: `“${item.row.text}”`, kind: "them" },
              { at: "", who: "Reply to caller", text: item.row.reply || "Saved and being processed.", kind: item.review ? "warn" : "system" },
              ...(item.row.support_case_id !== null ? [{ at: "", who: "", text: `Linked to case #${item.row.support_case_id}.`, kind: "system" as const }] : []),
            ]}
          />
        </div>
      </div>
    </li>
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
  const waiting = people.filter((row) => row.status === "checking_in" || row.status === "unknown");
  if (!simulate) {
    return <p className="focus-note">Check-ins update as residents answer their calls.</p>;
  }
  if (waiting.length === 0) return <p className="focus-empty">Everyone in the sweep has answered.</p>;
  return (
    <>
      <p className="focus-note">Simulated answers stand in for the resident on the phone.</p>
      <ul className="people-list">
        {waiting.map((person) => {
          const profile = state.profiles.find((row) => row.id === person.profile_id);
          const name = profile?.name ?? "Unknown";
          const house = houses.find((row) => row.name === profile?.name);
          return (
            <li key={person.id}>
              <span className="face">{initials(name)}</span>
              <span>
                <b>{name}</b>
                <small>
                  {person.status === "unknown" ? "No answer yet" : "Calling"}
                  {house ? "" : " · off the map"}
                </small>
              </span>
              <span className="dash-checkin">
                <button type="button" onClick={() => void onCheckIn(incidentId, person.profile_id, "safe")} aria-label={`Simulate ${name} answering safe`}>
                  Safe
                </button>
                <button type="button" className="need" onClick={() => void onCheckIn(incidentId, person.profile_id, "victim")} aria-label={`Simulate ${name} needing a ride`}>
                  Needs a ride
                </button>
              </span>
            </li>
          );
        })}
      </ul>
    </>
  );
}

function SimulatedInbound({ state, onSend }: { state: BackendState; onSend: LiveActions["inbound"] }) {
  const callers = state.profiles.filter((profile) => profile.phone || profile.phone_last4).map(profile => ({ ...profile, phone: profile.phone ?? `profile:${profile.id}` }));
  const [phone, setPhone] = useState(() => callers.find((profile) => profile.id === state.demo_mode.reporter_id)?.phone ?? callers[0]?.phone ?? "");
  const [text, setText] = useState("");
  const [key, setKey] = useState(() => "sim-inbound-" + eventKey());
  const [reply, setReply] = useState<string | null>(null);
  return (
    <form
      className="dash-sim"
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
