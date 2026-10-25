import { useEffect, useRef, useState, type ReactNode } from "react";
import type { CallCard, ChatMessage, House, InboundReport, Incident } from "./types";

/**
 * RideOut agents for the neighborhood lead. Not a city dispatch center.
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
      text: "Ken Abe’s call is with the lead. RideOut does not call 911.",
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
      lead: "Ken Abe’s call is with the lead. His son Leo is not home. RideOut does not call 911.",
      notes: notes.filter((note) => note.key !== "inbound"),
    };
  }
  return { live: false, kicker: "Listening", lead: "Waiting on who can drive and who cannot leave.", notes };
}

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
}) {
  const callerLive = calls.some((call) => call.phase === "calling" || call.phase === "live" || call.phase === "holding");
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
    takerKicker = "Incoming";
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

  return (
    <section className={visible ? "checks" : "checks is-hidden"} aria-hidden={!visible} aria-label="Agent workflow">
      <header className="term-bar">
        <p>rideout · checks</p>
        <p>caller · inbound · facilitator</p>
      </header>
      <Agent title={AGENTS.caller.title} name={AGENTS.caller.name} duty={AGENTS.caller.duty} live={callerLive} source="caller">
        <DirectCall houses={houses} actions={onCall} />
        <CallBoard calls={calls} now={now} started={started} finished={finished} actions={onCall} />
      </Agent>

      <Agent title={AGENTS.taker.title} name={AGENTS.taker.name} duty={AGENTS.taker.duty} live={takerLive} source="inbound">
        <p className="drill-tag">Sample call during the drill. Not a real emergency.</p>
        <div className="agent-now" aria-live="polite">
          <p className={takerLive ? "kicker hot" : "kicker"}>{takerKicker}</p>
          {takerWho ? <p className="agent-who">{takerWho}</p> : null}
          <p>
            {takerText}
            {inbound?.phase === "live" ? <i className="caret"> ▍</i> : null}
          </p>
        </div>
      </Agent>

      <Agent
        title={AGENTS.facilitator.title}
        name={AGENTS.facilitator.name}
        duty={AGENTS.facilitator.duty}
        live={desk.live || busy}
        source="facilitator"
        wide
      >
        <div className="agent-now" aria-live="polite">
          <p className={desk.live ? "kicker hot" : "kicker"}>{desk.kicker}</p>
          <p className="action">{desk.lead}</p>
          {desk.notes.map((note) => (
            <p key={note.key} className={note.warn ? "warn" : undefined}>
              {note.text}
            </p>
          ))}
        </div>
        <FacilitatorChat chat={chat} busy={busy} onAsk={onAsk} />
      </Agent>
    </section>
  );
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

function CallBoard({
  calls,
  now,
  started,
  finished,
  actions,
}: {
  calls: CallCard[];
  now: number;
  started: boolean;
  finished: boolean;
  actions: CallActions;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const ordered = [...calls].sort((a, b) => PHASE_RANK[a.phase] - PHASE_RANK[b.phase] || a.startedAt - b.startedAt);
  if (!started && calls.length === 0) {
    return <p className="term-wait">Check-in calls start together when the drill starts.</p>;
  }
  return (
    <div className="call-board">
      <p className="legend">
        <i className="dot calling" /> ringing <i className="dot live" /> connected <i className="dot holding" /> needs you{" "}
        <i className="dot missed" /> no answer
      </p>
      {ordered.map((call) => {
        const open = openId === call.id || call.phase === "holding";
        return (
          <div key={call.id} className={`call-item${open ? " open" : ""}${call.phase === "holding" ? " needs-you" : ""}`}>
            <button type="button" className="call-hit" onClick={() => setOpenId(openId === call.id ? null : call.id)}>
              <i className={`dot ${call.phase}`} />
              <span>
                {call.name}
                {call.taskId ? <small className="call-tag">your request</small> : null}
                {call.handledBy === "operator" ? <small className="call-tag you">you</small> : null}
              </span>
              <em>{callLabel(call)}</em>
            </button>
            {ACTIVE.has(call.phase) ? (
              <div className="call-actions">
                <button type="button" className={call.phase === "holding" ? "hot" : ""} disabled={actions.busy} onClick={() => actions.takeOver(call.id)}>
                  {call.phase === "holding" ? "Pick up" : "Take over"}
                </button>
                <button type="button" onClick={() => actions.cancel(call.id)}>
                  Cancel call
                </button>
                {call.phase === "live" ? (
                  <button type="button" onClick={() => actions.listen(call.id)}>
                    {actions.listeningId === call.id ? "Mute" : "Listen"}
                  </button>
                ) : null}
              </div>
            ) : null}
            <div className="call-detail">
              <div>
                {stepsFor(call, now).map((line, index) => (
                  <p key={`${index}-${line}`}>{line}</p>
                ))}
                {call.recording ? <audio className="call-audio" controls src={call.recording.url} /> : null}
              </div>
            </div>
          </div>
        );
      })}
      {finished ? <p className="term-wait">The check-in wave is done.</p> : null}
    </div>
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

function seconds(from: number, to: number) {
  return Math.max(0, Math.round((to - from) / 1000));
}

function stepsFor(call: CallCard, now: number) {
  const ringEnd = call.answeredAt ?? call.endedAt ?? now;
  const rang = seconds(call.startedAt, ringEnd);
  const lines = [call.handledBy === "operator" && call.id.startsWith("lead-") ? `You called ${call.name}.` : `Dialed ${call.name}.`];
  if (call.phase === "calling") {
    lines.push(`Ringing for ${seconds(call.startedAt, now)} seconds.`);
    return lines;
  }
  if (call.phase === "missed" || call.phase === "declined") {
    lines.push(`Rang for ${rang} seconds. ${call.phase === "missed" ? "No answer." : "Declined."}`);
    lines.push("Call ended.");
    return lines;
  }
  if (call.answeredAt && !call.id.startsWith("lead-")) lines.push(`Answered after ${rang} seconds.`);
  const said = call.segments?.length
    ? call.segments.map((part) => (part.speaker === "system" ? part.text : `${part.speaker === "operator" ? "You" : call.name.split(" ")[0]}: ${part.text}`))
    : call.transcript
      ? [call.transcript]
      : [];
  lines.push(...said);
  if (call.phase === "holding" && call.escalation) lines.push(`On hold for ${seconds(call.escalation.at, now)} seconds. Waiting for you.`);
  else if (call.endedAt && call.answeredAt) lines.push(`Call ended. On the line for ${seconds(call.answeredAt, call.endedAt)} seconds.`);
  else if (call.phase !== "canceled") lines.push("Still on the line.");
  return lines;
}

function Agent({
  title,
  name,
  duty,
  live,
  source,
  wide = false,
  children,
}: {
  title: string;
  name: string;
  duty: string;
  live: boolean;
  source: string;
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <article className={`term${live ? " is-live" : ""}${wide ? " wide" : ""}`}>
      <p className="term-source">source {source}{live ? " · live" : ""}</p>
      <h3>{name}</h3>
      <p className="duty">{title}. {duty}</p>
      {children}
    </article>
  );
}

function FacilitatorChat({ chat, busy, onAsk }: { chat: ChatMessage[]; busy: boolean; onAsk: (request: string) => void }) {
  const [draft, setDraft] = useState("");
  const feed = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = feed.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [chat, busy]);

  const send = (text: string) => {
    if (!text.trim()) return;
    onAsk(text);
    setDraft("");
  };

  return (
    <div className="chat">
      <div className="chat-feed" ref={feed} aria-live="polite">
        {chat.length === 0 ? (
          <p className="chat-empty">Tell Jonah which houses to call. He hands the job to Amina and reports back here.</p>
        ) : (
          chat.map((message) => (
            <div key={message.id} className={`chat-msg ${message.from}`}>
              <span className="chat-from">{message.from === "lead" ? "You" : "Jonah · facilitator"}</span>
              <p>{message.text}</p>
            </div>
          ))
        )}
        {busy ? <p className="chat-busy">Amina is on the phone…</p> : null}
      </div>
      <div className="chat-chips">
        {SUGGESTIONS.map((suggestion) => (
          <button key={suggestion} type="button" onClick={() => send(suggestion)}>
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
          placeholder="Call Luis, call 5530 Manila, call everyone on Manila Ave…"
          aria-label="Message the facilitator"
        />
        <button type="submit" disabled={!draft.trim()}>
          Send
        </button>
      </form>
    </div>
  );
}
