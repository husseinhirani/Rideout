import { useEffect, useRef, useState } from "react";
import { barHeight, Bars, DashRail, FacilitatorTile, FocusView, Icon, initials, mmss, PeopleList, seconds, Timeline, useFocus, type Bar, type BarTone, type Person, type RailItem, type TimelineLine } from "./Dashboard";
import type { CallCard, ChatMessage, House, InboundReport, Incident } from "./types";

/**
 * Sealert agents for the neighborhood lead. Not a city dispatch center.
 * Check-in caller: operations welfare checks, the outbound calls.
 * Call taker: a 911 call-taker. She interviews and records. She does not send a ride.
 * Facilitator: the liaison between those desks and the lead. The lead chats with it,
 * it hands call jobs to the caller, and it reports back what was done.
 * The registrar's book is the Export log download in the top bar, not a desk on screen.
 */
const AGENTS = {
  caller: {
    name: "Amina Diallo",
    title: "Check-in caller",
    duty: "Calls each registered neighbor and stays on the line until the call ends.",
  },
  taker: {
    name: "Elena Vasquez",
    title: "Call taker",
    duty: "Answers people who call in, and records a missing child or a request for help.",
  },
  facilitator: {
    name: "Jonah Reid",
    title: "Facilitator",
    duty: "Takes your requests, sends the caller to the houses you name, and reports back. Stops any ride that would cross the fire.",
  },
} as const;

type Note = { key: string; text: string; warn: boolean };

const SUGGESTIONS = ["Call who didn't answer", "Call everyone who needs a ride", "Who still needs a ride?"];

function facilitatorCopy(houses: House[], started: boolean, inbound: InboundReport | null, incident: Incident) {
  if (incident.kind === "missing_child" && incident.child) {
    const { child, sightings, foundAt } = incident;
    return {
      live: !foundAt,
      kicker: foundAt ? "Found" : "Missing child",
      lead: `${child.name}, ${child.age}. Wearing ${child.clothing}. Last seen at ${child.lastSeen}.`,
      notes: sightings.map((sighting) => ({
        key: sighting.id,
        text: `${sighting.safe ? "Safe" : "Seen"} · ${sighting.reporter}, ${sighting.address}: ${sighting.text}`,
        warn: !sighting.safe,
      })),
    };
  }
  const helen = houses.find((house) => house.name === "Helen Cho");
  const luis = houses.find((house) => house.name === "Luis Ortega");
  const maya = houses.find((house) => house.name === "Maya Chen");
  const matched = helen?.note.includes("Daniel") ?? false;
  const passing = started && helen?.status === "needs_ride" && !matched;
  const inboundLive = inbound?.phase === "ringing" || inbound?.phase === "live";
  const notes: Note[] = [];

  if (started && maya?.status === "blocked") {
    notes.push({
      key: "maya",
      text: "Maya Chen’s van was not offered. The route crosses the fire.",
      warn: true,
    });
  }
  if (started && luis?.status === "no_ride") {
    notes.push({
      key: "luis",
      text: "Luis Ortega has no ride. A wheelchair does not fit the open car.",
      warn: true,
    });
  } else if (started && luis?.status === "needs_ride") {
    notes.push({
      key: "luis",
      text: "Luis Ortega needs a van. A wheelchair does not fit the open car.",
      warn: true,
    });
  }
  if (inbound?.phase === "filed") {
    notes.push({
      key: "inbound",
      text: "Ken Abe’s call is with the lead. Sealert does not call 911.",
      warn: false,
    });
  }

  if (!started) {
    return { live: false, kicker: "Standing by", lead: "Matches show up here once someone needs a ride.", notes: [] };
  }
  if (matched) {
    return {
      live: false,
      kicker: "Matched",
      lead: "Daniel Ruiz accepted Helen Cho. If he does not arrive, she calls 911.",
      notes,
    };
  }
  if (passing) {
    return {
      live: true,
      kicker: "Passing a need",
      lead: "Asking Daniel Ruiz to take Helen Cho. Gray Honda, two seats. A walker fits, and the detour stays outside the fire.",
      notes,
    };
  }
  if (inboundLive) {
    return {
      live: true,
      kicker: "From the call taker",
      lead:
        inbound?.phase === "ringing"
          ? "Someone is calling in. Elena has the line."
          : "Ken Abe is on Elena’s line. His son Leo is not home. That is not a ride.",
      notes,
    };
  }
  if (inbound?.phase === "filed") {
    return {
      live: false,
      kicker: "Passed to the lead",
      lead: "Ken Abe’s call is with the lead. His son Leo is not home. Sealert does not call 911.",
      notes: notes.filter((note) => note.key !== "inbound"),
    };
  }
  return { live: false, kicker: "Listening", lead: "Waiting on who can drive and who cannot leave.", notes };
}

type Focus = "outgoing" | "incoming" | "need" | "help" | "links" | "facilitator";

const STATUS_NAME: Record<House["status"], string> = {
  waiting: "Queued",
  out: "Out safe",
  needs_ride: "Needs a ride",
  unknown: "No answer",
  no_ride: "No ride",
  blocked: "Not offered",
};

export function Checks({
  visible,
  houses,
  calls,
  inbound,
  incident,
  started,
  running,
  now,
  chat,
  busy,
  onAsk,
  onCall,
  facilitatorRequest = 0,
}: {
  visible: boolean;
  houses: House[];
  calls: CallCard[];
  inbound: InboundReport | null;
  incident: Incident;
  started: boolean;
  running: boolean;
  now: number;
  chat: ChatMessage[];
  busy: boolean;
  onAsk: (request: string) => void;
  onCall: CallActions;
  facilitatorRequest?: number;
}) {
  const callerLive = calls.some((call) => ACTIVE.has(call.phase));
  const finished = started && !running && calls.length > 0 && !callerLive;
  const desk = facilitatorCopy(houses, started, inbound, incident);
  const takerLive = inbound?.phase === "ringing" || inbound?.phase === "live";

  let takerKicker = "Standing by";
  let takerWho = "";
  let takerText = "Inbound calls show up here during the drill.";
  if (started && !inbound) {
    takerKicker = "Line open";
    takerText = "Waiting for a neighbor to call in.";
  } else if (inbound?.phase === "ringing") {
    takerKicker = "Ringing";
    takerWho = inbound.from;
    takerText = "The phone is ringing.";
  } else if (inbound?.phase === "live") {
    takerKicker = "On the line";
    takerWho = inbound.from;
    takerText = inbound.transcript;
  } else if (inbound?.phase === "filed") {
    takerKicker = "Recorded";
    takerWho = inbound.from;
    takerText = inbound.summary ?? inbound.transcript;
  }

  const { focus, open, close } = useFocus<Focus>(visible);
  useEffect(() => { if (facilitatorRequest) open("facilitator"); }, [facilitatorRequest]);

  const needHelp = houses.filter((house) => house.status === "needs_ride" || house.status === "no_ride");
  const helpers = houses.filter(canHelp);
  const links = connections(houses);
  const answered = calls.filter((call) => call.answeredAt).length;
  const reached = calls.length ? Math.round((answered / calls.length) * 100) : 0;
  const onLine = calls.filter((call) => ACTIVE.has(call.phase) || call.phase === "operator");
  const current = onLine.find((call) => call.phase === "live" || call.phase === "operator") ?? onLine[0] ?? null;
  const talked = calls.filter((call) => call.answeredAt).map((call) => seconds(call.answeredAt ?? 0, call.endedAt ?? now));
  const average = talked.length ? Math.round(talked.reduce((sum, value) => sum + value, 0) / talked.length) : 0;
  const state = !started ? "Standing by" : finished ? "Wave done" : "Live";
  const asPeople = (list: House[], tone: Person["tone"]): Person[] =>
    list.map((house) => ({ key: house.id, name: house.name, note: house.note, chip: STATUS_NAME[house.status], tone }));

  const rail: RailItem<Focus>[] = [
    {
      id: "outgoing",
      label: "Outgoing calls",
      value: calls.length,
      icon: "phoneOut",
      detail: calls.length ? `${reached}% reached · ${onLine.length} on the line${current ? ` · ${current.name.split(" ")[0]} ${mmss(seconds(current.answeredAt ?? current.startedAt, now))}` : ""}` : "Calls start with the drill",
    },
    { id: "incoming", label: "Incoming calls", value: inbound ? 1 : 0, icon: "phoneIn", detail: takerWho ? `${takerKicker} · ${takerWho}` : takerKicker },
    { id: "need", label: "Need help", value: needHelp.length, icon: "alert", detail: names(needHelp, "No one is waiting on a ride") },
    { id: "help", label: "Can help", value: helpers.length, icon: "hand", detail: names(helpers, "No open seats yet") },
    { id: "links", label: "Connections", value: links.length, icon: "link", detail: links[0] ? `${links[0].from} → ${links[0].to}` : "No ride matched yet" },
    { id: "facilitator", label: "Facilitator agent", value: null, icon: "spark", agent: true, detail: busy ? "Working…" : desk.kicker },
  ];
  const focused = focus ? rail.find((item) => item.id === focus.id) : undefined;

  return (
    <section className={`dash${visible ? "" : " is-hidden"}${focus ? " focusing" : ""}`} aria-hidden={!visible} aria-label="Checks">
      <DashRail items={rail} active={focus?.id ?? null} onOpen={open} />

      <div className={focus ? "dash-body blurred" : "dash-body"}>
        <header className="dash-head">
          <div>
            <h1>Checks</h1>
            <p>{incident.kind === "missing_child" ? "Missing child alert" : "Wildfire check-in"} · Rockridge</p>
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
                  <strong>{calls.length}</strong>
                </span>
                <span>
                  <small>Avg on line</small>
                  <strong>{mmss(average)}</strong>
                </span>
                {callerLive ? <em className="chip">{onLine.length} live</em> : null}
              </span>
              <Bars bars={callBars(calls, now, current)} empty="Calls appear here when the drill starts" />
              <span className="legend-row">
                <span><i className="k-live" />Connected</span>
                <span><i className="k-ring" />Ringing</span>
                <span><i className="k-miss" />No answer</span>
                <span><i className="k-done" />Ended</span>
              </span>
            </button>

          </div>
          <div className="dash-col agent-col">
            <FacilitatorTile
              chat={chat}
              name={AGENTS.facilitator.name}
              kicker={desk.kicker}
              lead={desk.lead}
              live={desk.live || busy}
              busy={busy}
              suggestions={SUGGESTIONS}
              placeholder="Ask Jonah to call someone…"
              onOpen={(from) => open("facilitator", from)}
              onAsk={(text) => onAsk(text)}
            />
          </div>
        </div>
      </div>

      {focus && focused ? (
        <FocusView focus={focus} title={focused.label} kicker={focus.id === "facilitator" ? "Manager agent" : state} icon={focused.icon} agent={focus.id === "facilitator"} onClose={close}>
          {focus.id === "outgoing" ? (
            <>
              <div className="focus-stats">
                <span><strong>{calls.length}</strong>calls</span>
                <span><strong>{answered}</strong>answered</span>
                <span><strong>{onLine.length}</strong>on the line</span>
                <span><strong>{mmss(average)}</strong>avg on line</span>
              </div>
              <DirectCall houses={houses} actions={onCall} />
              <CallList calls={calls} now={now} started={started} finished={finished} actions={onCall} initial={focus.item ?? null} />
            </>
          ) : null}
          {focus.id === "incoming" ? (
            <div className="incoming-view">
              <span className={takerLive ? "ring-orb live" : "ring-orb"}>
                <Icon name="phoneIn" />
              </span>
              <p className="focus-kicker">{takerKicker}</p>
              <h3>{takerWho || "No one on the line"}</h3>
              <p className="focus-text">
                {takerText}
                {inbound?.phase === "live" ? <i className="caret"> ▍</i> : null}
              </p>
              <p className="focus-note">{AGENTS.taker.name}, {AGENTS.taker.title.toLowerCase()}. {AGENTS.taker.duty}</p>
            </div>
          ) : null}
          {focus.id === "need" ? <PeopleList people={asPeople(needHelp, "need")} empty="No one is waiting on a ride." /> : null}
          {focus.id === "help" ? <PeopleList people={asPeople(helpers, "help")} empty="No open seats yet." /> : null}
          {focus.id === "links" ? (
            links.length === 0 ? (
              <p className="focus-empty">No ride matched yet. Matches appear when a driver accepts someone who needs a ride.</p>
            ) : (
              <ul className="link-list">
                {links.map((link) => (
                  <li key={link.from + link.to}>
                    <span className="face">{initials(link.from)}</span>
                    <span>
                      <b>{link.from}</b>
                      <small>Driver</small>
                    </span>
                    <i />
                    <span className="face need">{initials(link.to)}</span>
                    <span>
                      <b>{link.to}</b>
                      <small>Rider</small>
                    </span>
                  </li>
                ))}
              </ul>
            )
          ) : null}
          {focus.id === "facilitator" ? (
            <>
              <div className={desk.live || busy ? "agent-status live" : "agent-status"}>
                <p>{desk.kicker}</p>
                <span>{desk.lead}</span>
              </div>
              {desk.notes.length ? (
                <ul className="agent-notes">
                  {desk.notes.map((note) => (
                    <li key={note.key} className={note.warn ? "warn" : ""}>
                      {note.text}
                    </li>
                  ))}
                </ul>
              ) : null}
              <FacilitatorChat chat={chat} busy={busy} onAsk={onAsk} />
            </>
          ) : null}
        </FocusView>
      ) : null}
    </section>
  );
}

function names(list: House[], none: string) {
  if (list.length === 0) return none;
  const first = list.slice(0, 2).map((house) => house.name);
  return list.length > 2 ? `${first.join(", ")} +${list.length - 2}` : first.join(" and ");
}

function canHelp(house: House) {
  return house.status === "out" && /seat|pick up|accepted/i.test(house.note) && !/full|no seat|no room|can't turn/i.test(house.note);
}

function connections(houses: House[]) {
  const helen = houses.find((house) => house.name === "Helen Cho");
  if (helen?.note.includes("Daniel")) return [{ from: "Daniel Ruiz", to: "Helen Cho" }];
  return [];
}

function phaseTone(phase: CallCard["phase"]): BarTone {
  if (phase === "live" || phase === "operator") return "live";
  if (phase === "calling") return "ring";
  if (phase === "holding") return "hold";
  if (phase === "missed" || phase === "declined") return "miss";
  if (phase === "canceled") return "off";
  return "done";
}

// One bar per call, tall for long conversations; finished calls set the scale.
function callBars(calls: CallCard[], now: number, current: CallCard | null): Bar[] {
  const shown = [...calls].sort((a, b) => a.startedAt - b.startedAt).slice(-22);
  const length = (call: CallCard) => (call.answeredAt ? seconds(call.answeredAt, call.endedAt ?? now) : 0);
  const longest = Math.max(5, ...shown.filter((call) => call.endedAt).map(length));
  return shown.map((call) => ({
    id: call.id,
    tone: phaseTone(call.phase),
    height: call.answeredAt ? barHeight(length(call), longest) : call.phase === "calling" ? 34 : 16,
    title: `${call.name} · ${callLabel(call)}`,
    tag: call.id === current?.id ? `${call.name.split(" ")[0]} · ${mmss(seconds(call.answeredAt ?? call.startedAt, now))}` : undefined,
  }));
}

export type CallActions = {
  busy: boolean;
  cancel: (id: string) => void;
  takeOver: (id: string) => void;
  callDirect: (householdId: number) => void;
  listen: (id: string) => void;
  listeningId: string | null;
};

const PHASE_RANK: Record<CallCard["phase"], number> = {
  holding: 0,
  operator: 1,
  calling: 2,
  live: 3,
  missed: 4,
  declined: 4,
  canceled: 5,
  done: 6,
};

const ACTIVE = new Set<CallCard["phase"]>(["calling", "live", "holding"]);

function DirectCall({ houses, actions }: { houses: House[]; actions: CallActions }) {
  const [pick, setPick] = useState("");
  const chosen = Number(pick);
  return (
    <form
      className="direct-call"
      onSubmit={(event) => {
        event.preventDefault();
        if (chosen) actions.callDirect(chosen);
      }}
    >
      <select value={pick} onChange={(event) => setPick(event.target.value)} aria-label="Who to call yourself">
        <option value="">Call someone yourself…</option>
        {houses.map((house) => (
          <option key={house.id} value={house.id}>
            {house.name}
          </option>
        ))}
      </select>
      <button type="submit" disabled={!chosen || actions.busy}>
        {actions.busy ? "On a call" : "Call"}
      </button>
    </form>
  );
}

function CallList({
  calls,
  now,
  started,
  finished,
  actions,
  initial,
}: {
  calls: CallCard[];
  now: number;
  started: boolean;
  finished: boolean;
  actions: CallActions;
  initial: string | null;
}) {
  const [openId, setOpenId] = useState<string | null>(initial);
  const ordered = [...calls].sort((a, b) => PHASE_RANK[a.phase] - PHASE_RANK[b.phase] || a.startedAt - b.startedAt);
  if (!started && calls.length === 0) {
    return <p className="focus-empty">Check-in calls start together when the drill starts. Use Start in the top bar.</p>;
  }
  return (
    <ul className="call-list">
      {ordered.map((call) => {
        const open = openId === call.id || call.phase === "holding";
        const onLineFor = call.answeredAt ? seconds(call.answeredAt, call.endedAt ?? now) : null;
        return (
          <li key={call.id} className={`dash-call t-${phaseTone(call.phase)}${open ? " open" : ""}`}>
            <button type="button" className="call-head" onClick={() => setOpenId(openId === call.id ? null : call.id)} aria-expanded={open}>
              <span className="face">{initials(call.name)}</span>
              <span className="call-name">
                <b>{call.name}</b>
                <small>
                  {new Date(call.startedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                  {call.taskId ? " · your request" : ""}
                  {call.handledBy === "operator" ? " · you" : ""}
                </small>
              </span>
              <em className="call-state">
                <i />
                {callLabel(call)}
              </em>
              <span className="call-time">{onLineFor === null ? "—" : mmss(onLineFor)}</span>
              <Icon name="chevron" />
            </button>
            <div className="call-drop">
              <div>
                <div className="call-meta">
                  <span>
                    <small>Rang</small>
                    {seconds(call.startedAt, call.answeredAt ?? call.endedAt ?? now)} s
                  </span>
                  <span>
                    <small>On the line</small>
                    {onLineFor === null ? "—" : mmss(onLineFor)}
                  </span>
                  <span>
                    <small>Ended</small>
                    {call.endedAt ? new Date(call.endedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" }) : "Not yet"}
                  </span>
                </div>
                {ACTIVE.has(call.phase) ? (
                  <div className="call-actions">
                    {call.phase === "live" ? (
                      <button type="button" className={actions.listeningId === call.id ? "on" : ""} onClick={() => actions.listen(call.id)}>
                        <Icon name={actions.listeningId === call.id ? "mute" : "sound"} />
                        {actions.listeningId === call.id ? "Mute" : "Listen in"}
                      </button>
                    ) : null}
                    <button type="button" className={call.phase === "holding" ? "hot" : ""} disabled={actions.busy} onClick={() => actions.takeOver(call.id)}>
                      <Icon name="phoneOut" />
                      {call.phase === "holding" ? "Pick up" : "Take over"}
                    </button>
                    <button type="button" onClick={() => actions.cancel(call.id)}>
                      <Icon name="close" />
                      Cancel call
                    </button>
                  </div>
                ) : null}
                <Timeline lines={timelineFor(call, now)} />
                {call.recording ? <audio className="call-audio" controls src={call.recording.url} /> : null}
              </div>
            </div>
          </li>
        );
      })}
      {finished ? <li className="call-done">The check-in wave is done.</li> : null}
    </ul>
  );
}

function callLabel(call: CallCard) {
  if (call.phase === "calling") return "Ringing";
  if (call.phase === "live") return "Connected";
  if (call.phase === "holding") return "Needs you";
  if (call.phase === "operator") return "You're on";
  if (call.phase === "missed") return "No answer";
  if (call.phase === "declined") return "Declined";
  if (call.phase === "canceled") return "Canceled";
  return "Ended";
}

// The call as a timeline: seconds from dialing, who spoke, what was said.
function timelineFor(call: CallCard, now: number): TimelineLine[] {
  const at = (time: number) => mmss(seconds(call.startedAt, time));
  const first = call.name.split(" ")[0];
  const lines: TimelineLine[] = [
    { at: "0:00", who: "", text: call.handledBy === "operator" && call.id.startsWith("lead-") ? `You called ${call.name}.` : `Amina dialed ${call.name}.`, kind: "system" },
  ];
  if (call.phase === "calling") {
    lines.push({ at: at(now), who: "", text: "Still ringing…", kind: "system" });
    return lines;
  }
  if (call.phase === "missed" || call.phase === "declined") {
    lines.push({ at: at(call.endedAt ?? now), who: "", text: call.phase === "missed" ? "No answer. Call ended." : "Declined. Call ended.", kind: "system" });
    return lines;
  }
  if (call.answeredAt && !call.id.startsWith("lead-")) lines.push({ at: at(call.answeredAt), who: "", text: `${first} answered.`, kind: "system" });
  if (call.segments?.length) {
    for (const part of call.segments) {
      if (part.speaker === "system") lines.push({ at: at(part.at), who: "", text: part.text, kind: "system" });
      else lines.push({ at: at(part.at), who: part.speaker === "operator" ? "You" : first, text: part.text, kind: part.speaker === "operator" ? "you" : "them" });
    }
  } else if (call.transcript) {
    lines.push({ at: at(call.answeredAt ?? call.at), who: first, text: call.transcript, kind: "them" });
  }
  if (call.phase === "holding" && call.escalation) lines.push({ at: at(now), who: "", text: `On hold for ${seconds(call.escalation.at, now)} s. ${call.escalation.reason}`, kind: "system" });
  else if (call.endedAt) lines.push({ at: at(call.endedAt), who: "", text: "Call ended.", kind: "system" });
  else if (call.phase !== "canceled") lines.push({ at: at(now), who: "", text: "Still on the line…", kind: "system" });
  return lines;
}

export function FacilitatorChat({
  chat,
  busy,
  onAsk,
  suggestions = SUGGESTIONS,
  empty = "Tell Jonah which houses to call. He hands the job to Amina and reports back here.",
  busyText = "Amina is on the phone…",
  placeholder = "Call Luis, call 5530 Manila, call everyone on Manila Ave…",
}: {
  chat: ChatMessage[];
  busy: boolean;
  onAsk: (request: string) => void;
  suggestions?: string[];
  empty?: string;
  busyText?: string;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState("");
  const feed = useRef<HTMLDivElement>(null);
  const latestMessage = chat[chat.length - 1];

  useEffect(() => {
    const node = feed.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [latestMessage?.id, latestMessage?.text, busy]);

  const send = (text: string) => {
    if (!text.trim() || busy) return;
    onAsk(text);
    setDraft("");
  };

  return (
    <div className="chat">
      <div className="chat-feed" ref={feed} aria-live="polite">
        {chat.length === 0 ? (
          <p className="chat-empty">{empty}</p>
        ) : (
          chat.map((message) => (
            <div key={message.id} className={`chat-msg ${message.from}`}>
              <span className="chat-from">{message.from === "lead" ? "You" : "Jonah · facilitator"}</span>
              <p>{message.text}</p>
            </div>
          ))
        )}
        {busy ? <p className="chat-busy">{busyText}</p> : null}
      </div>
      <div className="chat-chips">
        {suggestions.map((suggestion) => (
          <button key={suggestion} type="button" disabled={busy} onClick={() => send(suggestion)}>
            {suggestion}
          </button>
        ))}
      </div>
      <form
        className="chat-input"
        onSubmit={(event) => {
          event.preventDefault();
          send(draft);
        }}
      >
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={placeholder}
          aria-label="Message the facilitator"
        />
        <button type="submit" disabled={busy || !draft.trim()}>
          Send
        </button>
      </form>
    </div>
  );
}
