import { useEffect, useState, type ReactNode } from "react";
import type { CallCard, House, HouseStatus, InboundReport } from "./types";

/**
 * RideOut agents for the neighborhood lead. Not a city dispatch center.
 * Check-in caller: operations welfare checks, the outbound calls.
 * Call taker: a 911 call-taker. She interviews and records. She does not send a ride.
 * Facilitator: the liaison between those desks, the way a dispatcher passes a need on.
 * Registrar: the ICS documentation unit, the book of who left and what happened.
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
    duty: "Passes a need to a neighbor who can help, and stops a ride that would cross the fire.",
  },
  registrar: {
    name: "Ruth Keller",
    title: "Registrar",
    duty: "Writes down who left, who needs a ride, and who did not answer.",
  },
} as const;

const STATUS: Record<HouseStatus, string> = {
  waiting: "Queued",
  out: "Out",
  needs_ride: "Needs a ride",
  unknown: "No answer",
  no_ride: "No ride",
  blocked: "Not offered",
};

type OutcomeEntry = {
  id: string;
  name: string;
  status: HouseStatus;
  note: string;
};

type Note = { key: string; text: string; warn: boolean };

function useOutcomeLog(calls: CallCard[], houses: House[]) {
  const [entries, setEntries] = useState<OutcomeEntry[]>([]);

  useEffect(() => {
    if (calls.length === 0) {
      setEntries((current) => (current.length === 0 ? current : []));
      return;
    }
    setEntries((current) => {
      const known = new Set(current.map((entry) => entry.id));
      let next = current;
      for (const call of calls) {
        if (call.phase !== "done" && call.phase !== "missed" && call.phase !== "declined") continue;
        if (known.has(call.id)) continue;
        const house = houses.find((item) => item.name === call.name);
        if (!house || house.status === "waiting") continue;
        known.add(call.id);
        next = [{ id: call.id, name: call.name, status: house.status, note: house.note }, ...next];
      }
      return next;
    });
  }, [calls, houses]);

  return entries;
}

function useFresh(id: string | null) {
  const [fresh, setFresh] = useState(false);
  useEffect(() => {
    if (!id) {
      setFresh(false);
      return;
    }
    setFresh(true);
    const timer = window.setTimeout(() => setFresh(false), 1800);
    return () => window.clearTimeout(timer);
  }, [id]);
  return fresh;
}

function facilitatorCopy(houses: House[], started: boolean, inbound: InboundReport | null) {
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
  started,
  running,
  now,
}: {
  visible: boolean;
  houses: House[];
  calls: CallCard[];
  inbound: InboundReport | null;
  started: boolean;
  running: boolean;
  now: number;
}) {
  const entries = useOutcomeLog(calls, houses);
  const fresh = useFresh(entries[0]?.id ?? null);
  const callerLive = calls.some((call) => call.phase === "calling" || call.phase === "live");
  const finished = started && !running && calls.length > 0 && !callerLive;
  const desk = facilitatorCopy(houses, started, inbound);
  const takerLive = inbound?.phase === "ringing" || inbound?.phase === "live";
  const recordLabel = entries.length === 0 ? "Log" : fresh ? "Writing" : "Recorded";

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
    takerText = "Leo is not home. He was at a friend’s on Colby and is not picking up. Logged for the neighborhood lead. RideOut does not call 911.";
  }

  return (
    <section className={visible ? "checks" : "checks is-hidden"} aria-hidden={!visible} aria-label="Agent workflow">
      <header className="term-bar">
        <p>rideout · checks</p>
        <p>caller · inbound · facilitator · registrar</p>
      </header>
      <Agent title={AGENTS.caller.title} name={AGENTS.caller.name} duty={AGENTS.caller.duty} live={callerLive} source="caller">
        <CallBoard calls={calls} now={now} started={started} finished={finished} />
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

      <Agent title={AGENTS.facilitator.title} name={AGENTS.facilitator.name} duty={AGENTS.facilitator.duty} live={desk.live} source="facilitator">
        <div className="agent-now" aria-live="polite">
          <p className={desk.live ? "kicker hot" : "kicker"}>{desk.kicker}</p>
          <p className="action">{desk.lead}</p>
          {desk.notes.map((note) => (
            <p key={note.key} className={note.warn ? "warn" : undefined}>
              {note.text}
            </p>
          ))}
        </div>
      </Agent>

      <Agent title={AGENTS.registrar.title} name={AGENTS.registrar.name} duty={AGENTS.registrar.duty} live={fresh} source="registrar">
        <p className={fresh ? "kicker hot rec-label" : "kicker rec-label"}>{recordLabel}</p>
        <div className="log-list" aria-live="polite">
          {entries.length === 0 ? (
            <div className="entry">
              <p>Nothing recorded yet.</p>
            </div>
          ) : (
            entries.map((entry, index) => (
              <div key={entry.id} className={index === 0 && fresh ? "entry fresh" : "entry"}>
                <div className="entry-top">
                  <b>{entry.name}</b>
                  <em className={entry.status}>{STATUS[entry.status]}</em>
                </div>
                <p>{entry.note}</p>
              </div>
            ))
          )}
        </div>
      </Agent>
    </section>
  );
}

const PHASE_RANK: Record<CallCard["phase"], number> = {
  calling: 0,
  live: 1,
  missed: 2,
  declined: 2,
  done: 3,
};

function CallBoard({ calls, now, started, finished }: { calls: CallCard[]; now: number; started: boolean; finished: boolean }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const ordered = [...calls].sort((a, b) => PHASE_RANK[a.phase] - PHASE_RANK[b.phase] || a.startedAt - b.startedAt);
  if (!started || calls.length === 0) {
    return <p className="term-wait">Check-in calls start together when the drill starts.</p>;
  }
  return (
    <div className="call-board">
      <p className="legend"><i className="dot calling" /> ringing <i className="dot live" /> connected <i className="dot missed" /> no answer</p>
      {ordered.map((call) => {
        const open = openId === call.id;
        return (
          <div key={call.id} className={open ? "call-item open" : "call-item"}>
            <button type="button" className="call-hit" onClick={() => setOpenId(open ? null : call.id)}>
              <i className={`dot ${call.phase}`} />
              <span>{call.name}</span>
              <em>{callLabel(call)}</em>
            </button>
            <div className="call-detail">
              <div>
                {stepsFor(call, now).map((line) => (
                  <p key={line}>{line}</p>
                ))}
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
  if (call.phase === "missed") return "No answer";
  if (call.phase === "declined") return "Declined";
  return "Ended";
}

function seconds(from: number, to: number) {
  return Math.max(0, Math.round((to - from) / 1000));
}

function stepsFor(call: CallCard, now: number) {
  const ringEnd = call.answeredAt ?? call.endedAt ?? now;
  const rang = seconds(call.startedAt, ringEnd);
  const lines = [`Dialed ${call.name}.`];
  if (call.phase === "calling") {
    lines.push(`Ringing for ${seconds(call.startedAt, now)} seconds.`);
    return lines;
  }
  if (call.phase === "missed") {
    lines.push(`Rang for ${rang} seconds. No answer.`);
    lines.push("Call ended.");
    return lines;
  }
  if (call.phase === "declined") {
    lines.push(`Rang for ${rang} seconds. Declined.`);
    lines.push("Call ended.");
    return lines;
  }
  lines.push(`Answered after ${rang} seconds.`);
  if (call.transcript) lines.push(call.transcript);
  if (call.endedAt && call.answeredAt) lines.push(`Call ended. On the line for ${seconds(call.answeredAt, call.endedAt)} seconds.`);
  else lines.push("Still on the line.");
  return lines;
}

function Agent({
  title,
  name,
  duty,
  live,
  source,
  children,
}: {
  title: string;
  name: string;
  duty: string;
  live: boolean;
  source: string;
  children: ReactNode;
}) {
  return (
    <article className={live ? "term is-live" : "term"}>
      <p className="term-source">source {source}{live ? " · live" : ""}</p>
      <h3>{name}</h3>
      <p className="duty">{title}. {duty}</p>
      {children}
    </article>
  );
}
