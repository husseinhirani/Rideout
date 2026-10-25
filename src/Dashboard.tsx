import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { ChatMessage, House } from "./types";

/**
 * The pieces both Checks boards share, offline (Checks) and live (LiveChecks): the floating
 * rail, the zoom-in focus view, and the small charts. Each board feeds them its own data.
 */

// Anything with a box on screen: a click or a submit, so the focus view can grow out of it.
export type Opener = { currentTarget: Element };
// Where the clicked card sat, relative to the screen's center.
type Origin = { x: number; y: number; s: number };
export type FocusState<T extends string> = { id: T; origin: Origin; item?: string };

export function useFocus<T extends string>(visible: boolean) {
  const [focus, setFocus] = useState<FocusState<T> | null>(null);
  useEffect(() => {
    if (!focus) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setFocus(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [focus]);
  useEffect(() => {
    if (!visible) setFocus(null);
  }, [visible]);

  const open = (id: T, from?: Opener, item?: string) => {
    const rect = from?.currentTarget.getBoundingClientRect();
    const origin = rect
      ? {
          x: rect.left + rect.width / 2 - window.innerWidth / 2,
          y: rect.top + rect.height / 2 - window.innerHeight / 2,
          s: Math.min(Math.max(rect.width / Math.min(window.innerWidth * 0.92, 860), 0.3), 1),
        }
      : { x: 0, y: 0, s: 0.9 };
    setFocus({ id, origin, item });
  };
  return { focus, open, close: () => setFocus(null) };
}

export type RailItem<T extends string> = { id: T; label: string; value: number | null; icon: IconName; agent?: boolean };

export function DashRail<T extends string>({ items, active, onOpen }: { items: RailItem<T>[]; active: T | null; onOpen: (id: T, from: Opener) => void }) {
  return (
    <nav className="dash-rail" aria-label="Checks sections">
      <span className="dash-rail-home" aria-hidden="true">
        <Icon name="grid" />
      </span>
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          className={`${active === item.id ? "on" : ""}${item.agent ? " agent" : ""}`}
          aria-label={item.label}
          onClick={(event) => onOpen(item.id, event)}
        >
          <Icon name={item.icon} />
          {item.value ? <b>{item.value}</b> : null}
          <span className="dash-tip">{item.label}</span>
        </button>
      ))}
    </nav>
  );
}

export function FocusView<T extends string>({
  focus,
  title,
  kicker,
  icon,
  agent = false,
  onClose,
  children,
}: {
  focus: FocusState<T>;
  title: string;
  kicker: string;
  icon: IconName;
  agent?: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <div className="dash-focus" onClick={onClose}>
      <article
        className={`focus-card${agent ? " agent" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        style={{ "--fx": `${focus.origin.x}px`, "--fy": `${focus.origin.y}px`, "--fs": focus.origin.s } as CSSProperties}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="focus-head">
          <span className="focus-icon">
            <Icon name={icon} />
          </span>
          <div>
            <p>{kicker}</p>
            <h2>{title}</h2>
          </div>
          <button type="button" className="focus-close" onClick={onClose} aria-label="Close">
            <Icon name="close" />
          </button>
        </header>
        <div className="focus-body">{children}</div>
      </article>
    </div>
  );
}

export type BarTone = "live" | "ring" | "hold" | "miss" | "off" | "done";
export type Bar = { id: string; tone: BarTone; height: number; title: string; tag?: string };

export function Bars({ bars, empty }: { bars: Bar[]; empty: string }) {
  if (bars.length === 0) {
    return (
      <span className="bars empty">
        {Array.from({ length: 14 }, (_, index) => (
          <i key={index} style={{ height: `${24 + ((index * 37) % 50)}%` }} />
        ))}
        <em>{empty}</em>
      </span>
    );
  }
  return (
    <span className="bars">
      {bars.map((bar) => (
        <i key={bar.id} className={`b-${bar.tone}${bar.tag ? " now" : ""}`} style={{ height: `${bar.height}%` }} title={bar.title}>
          {bar.tag ? <b>{bar.tag}</b> : null}
        </i>
      ))}
    </span>
  );
}

// Square root, so one long call does not flatten every short one; a value past the scale tops out.
export function barHeight(value: number, longest: number) {
  return 22 + Math.sqrt(Math.min(value / Math.max(longest, 1), 1)) * 78;
}

const STATUS_BARS: { status: House["status"]; label: string }[] = [
  { status: "out", label: "Safe" },
  { status: "needs_ride", label: "Ride" },
  { status: "unknown", label: "No ans." },
  { status: "no_ride", label: "No ride" },
  { status: "blocked", label: "Blocked" },
  { status: "waiting", label: "Queued" },
];

export function StatusSticks({ houses, waitingLabel = "Queued" }: { houses: House[]; waitingLabel?: string }) {
  const counts = STATUS_BARS.map((bar) => ({ ...bar, count: houses.filter((house) => house.status === bar.status).length }));
  const most = Math.max(1, ...counts.map((bar) => bar.count));
  return (
    <span className="sticks">
      {counts.map((bar) => (
        <span key={bar.status} className={`stick s-${bar.status}`}>
          <span className="stick-track">
            <i style={{ height: `${10 + (bar.count / most) * 90}%` }}>
              <b>{bar.count}</b>
            </i>
          </span>
          <small>{bar.status === "waiting" ? waitingLabel : bar.label}</small>
        </span>
      ))}
    </span>
  );
}

export function Faces({ names }: { names: string[] }) {
  if (names.length === 0) return <span className="faces none">None yet</span>;
  return (
    <span className="faces">
      {names.slice(0, 4).map((name) => (
        <i key={name} title={name}>
          {initials(name)}
        </i>
      ))}
      {names.length > 4 ? <i className="more">+{names.length - 4}</i> : null}
    </span>
  );
}

export type Person = { key: string | number; name: string; note: string; chip: string; tone: "need" | "help" };

export function PeopleList({ people, empty }: { people: Person[]; empty: string }) {
  if (people.length === 0) return <p className="focus-empty">{empty}</p>;
  return (
    <ul className="people-list">
      {people.map((person) => (
        <li key={person.key}>
          <span className={`face ${person.tone}`}>{initials(person.name)}</span>
          <span>
            <b>{person.name}</b>
            <small>{person.note}</small>
          </span>
          <em className={`chip ${person.tone === "need" ? "hot" : ""}`}>{person.chip}</em>
        </li>
      ))}
    </ul>
  );
}

const AGENT_MIN = 230;
const PAIR_MIN = 80;
const GAP = 16;

/**
 * The right column: number cards on top, the facilitator below. Dragging the grip between them
 * grows the facilitator upward and the cards above give up the room; double-click flips between
 * the resting size and as tall as it goes.
 */
export function AgentColumn({ top, agent }: { top: ReactNode; agent: ReactNode }) {
  const column = useRef<HTMLDivElement>(null);
  const dock = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ y: number; height: number } | null>(null);

  const tallest = () => {
    const room = column.current?.clientHeight ?? 0;
    const pairs = column.current?.querySelectorAll(".dash-pair").length ?? 2;
    return Math.max(AGENT_MIN, room - pairs * (PAIR_MIN + GAP));
  };
  const clamp = (value: number) => Math.min(Math.max(value, AGENT_MIN), tallest());
  const resting = () => (height === null || height < (AGENT_MIN + tallest()) / 2);

  return (
    <div
      ref={column}
      className={`dash-col agent-col${dragging ? " dragging" : ""}`}
      style={height === null ? undefined : ({ "--agent-h": `${height}px` } as CSSProperties)}
    >
      <div className="dash-stack">{top}</div>
      <div ref={dock} className="agent-dock">
        <button
          type="button"
          className="agent-grip"
          role="separator"
          aria-orientation="horizontal"
          aria-label="Drag to resize the facilitator"
          title="Drag up to expand · double-click to toggle"
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId);
            drag.current = { y: event.clientY, height: dock.current?.offsetHeight ?? AGENT_MIN };
            setDragging(true);
          }}
          onPointerMove={(event) => {
            if (!drag.current) return;
            setHeight(clamp(drag.current.height + drag.current.y - event.clientY));
          }}
          onPointerUp={() => {
            drag.current = null;
            setDragging(false);
          }}
          onDoubleClick={() => setHeight(resting() ? tallest() : null)}
          onKeyDown={(event) => {
            const now = dock.current?.offsetHeight ?? AGENT_MIN;
            if (event.key === "ArrowUp") setHeight(clamp(now + 40));
            if (event.key === "ArrowDown") setHeight(clamp(now - 40));
          }}
        >
          <i />
        </button>
        {agent}
      </div>
    </div>
  );
}

export function FacilitatorTile({
  name,
  kicker,
  lead,
  live,
  busy,
  disabled = false,
  chat,
  suggestions,
  placeholder,
  onOpen,
  onAsk,
}: {
  name: string;
  kicker: string;
  lead: string;
  live: boolean;
  busy: boolean;
  disabled?: boolean;
  chat: ChatMessage[];
  suggestions: string[];
  placeholder: string;
  onOpen: (from: Opener) => void;
  onAsk: (text: string, from: Opener) => void;
}) {
  const [draft, setDraft] = useState("");
  const feed = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = feed.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [chat, busy]);
  return (
    <article className={live ? "tile agent live" : "tile agent"}>
      <button type="button" className="agent-top" onClick={onOpen}>
        <span className="orb" aria-hidden="true" />
        <span className="agent-id">
          <small>Facilitator agent</small>
          <b>{name}</b>
        </span>
        <em className="chip dark">{busy ? "Working…" : kicker}</em>
        <Icon name="expand" />
      </button>
      <p className="agent-lead">{lead}</p>
      {/* Only shows once the card is dragged tall enough to read a conversation. */}
      <div className="agent-feed" ref={feed} aria-live="polite">
        {chat.length === 0 ? <p className="agent-feed-empty">Nothing asked yet. Ask below, or tap a suggestion.</p> : null}
        {chat.map((message) => (
          <p key={message.id} className={`agent-msg ${message.from}`}>
            <small>{message.from === "lead" ? "You" : name.split(" ")[0]}</small>
            {message.text}
          </p>
        ))}
        {busy ? <p className="agent-msg facilitator busy">Working on it…</p> : null}
      </div>
      {suggestions.length ? (
        <div className="agent-chips">
          {suggestions.map((suggestion) => (
            <button key={suggestion} type="button" onClick={(event) => onAsk(suggestion, event)}>
              {suggestion}
            </button>
          ))}
        </div>
      ) : null}
      <form
        className="agent-ask"
        onSubmit={(event) => {
          event.preventDefault();
          const text = draft.trim();
          if (!text || busy || disabled) return;
          setDraft("");
          onAsk(text, event);
        }}
      >
        <Icon name="spark" />
        <input disabled={disabled} value={draft} onChange={(event) => setDraft(event.target.value)} placeholder={placeholder} aria-label="Ask the facilitator" />
        <button type="submit" disabled={busy || disabled || !draft.trim()} aria-label="Send to the facilitator">
          <Icon name="arrow" />
        </button>
      </form>
    </article>
  );
}

// A call as a list of moments: when, who spoke, what was said. "warn" marks a concern or a failure.
export type TimelineLine = { at: string; who: string; text: string; kind: "system" | "them" | "you" | "warn" };

export function Timeline({ lines }: { lines: TimelineLine[] }) {
  return (
    <ol className="transcript">
      {lines.map((line, index) => (
        <li key={`${index}-${line.text}`} className={`tl-${line.kind}`}>
          <time>{line.at}</time>
          <p>
            {line.who ? <b>{line.who}</b> : null}
            {line.text}
          </p>
        </li>
      ))}
    </ol>
  );
}

export function initials(name: string) {
  return name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

export function mmss(total: number) {
  const minutes = Math.floor(total / 60);
  return `${minutes}:${String(total % 60).padStart(2, "0")}`;
}

export function seconds(from: number, to: number) {
  return Math.max(0, Math.round((to - from) / 1000));
}

export type IconName =
  | "grid"
  | "phoneOut"
  | "phoneIn"
  | "alert"
  | "hand"
  | "link"
  | "spark"
  | "clock"
  | "expand"
  | "close"
  | "chevron"
  | "arrow"
  | "sound"
  | "mute"
  | "check";

const ICONS: Record<IconName, string> = {
  grid: "M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z",
  phoneOut: "M5 4h3l2 5-2.5 1.5a11 11 0 0 0 6 6L15 14l5 2v3a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2zM15 3h6v6M21 3l-7 7",
  phoneIn: "M5 4h3l2 5-2.5 1.5a11 11 0 0 0 6 6L15 14l5 2v3a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2zM20 4l-6 6M14 4v6h6",
  alert: "M12 3l9.5 17h-19zM12 10v4M12 17.5v.5",
  hand: "M7 11V6a1.5 1.5 0 0 1 3 0v4M10 10V4.5a1.5 1.5 0 0 1 3 0V10M13 10V5.5a1.5 1.5 0 0 1 3 0V12M16 9.5a1.5 1.5 0 0 1 3 0V14a7 7 0 0 1-7 7h-1a6 6 0 0 1-5-2.7L3.5 14a1.6 1.6 0 0 1 2.6-1.8L7 13.5",
  link: "M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1",
  spark: "M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z",
  clock: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2",
  expand: "M14 4h6v6M20 4l-7 7M10 20H4v-6M4 20l7-7",
  close: "M6 6l12 12M18 6L6 18",
  chevron: "M6 9l6 6 6-6",
  arrow: "M5 12h14M13 6l6 6-6 6",
  sound: "M4 9v6h4l5 4V5L8 9zM16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11",
  mute: "M4 9v6h4l5 4V5L8 9zM17 9l5 6M22 9l-5 6",
  check: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM8 12l3 3 5-6",
};

export function Icon({ name }: { name: IconName }) {
  return (
    <svg className="icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d={ICONS[name]} />
    </svg>
  );
}
