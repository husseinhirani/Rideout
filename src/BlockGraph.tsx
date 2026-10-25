import { useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import type { CallCard, House } from "./types";

type Signal = "idle" | "ringing" | "connected" | "failed" | "ended";

const FILL: Record<Signal, string> = {
  ended: "#5b6272",
  idle: "#5b6272",
  ringing: "#f0c14a",
  connected: "#3ddc97",
  failed: "#ff5d4a",
};

const LABEL: Record<Signal, string> = {
  ended: "Ended",
  idle: "Not called yet",
  ringing: "Ringing",
  connected: "Connected",
  failed: "No answer",
};

const W = 1000;
const H = 700;
const HUB = -1;
const CX = W / 2;
const CY = H * 0.42;

type Props = {
  houses: House[];
  calls: CallCard[];
  selectedId: number | null;
  onSelect: (id: number) => void;
  liveEdges?: Edge[];
};

type Body = { x: number; y: number; vx: number; vy: number };
type Edge = { a: number; b: number; kind: "call" | "near" | "match" };

export function BlockGraph({ houses, calls, selectedId, onSelect, liveEdges }: Props) {
  const svg = useRef<SVGSVGElement>(null);
  const bodies = useRef(new Map<number, Body>());
  const drag = useRef<{ id: number; moved: boolean } | null>(null);
  const heat = useRef(1);
  const [, setTick] = useState(0);
  const [hoverId, setHoverId] = useState<number | null>(null);

  const signals = new Map(houses.map((house) => [house.id, signalFor(house, calls, liveEdges !== undefined)]));
  const edges = liveEdges ?? buildEdges(houses);
  const links = useRef(edges);
  links.current = edges;
  const ids = [HUB, ...houses.map((house) => house.id)];
  const key = ids.join(",");

  useEffect(() => {
    seed(bodies.current, houses);
    heat.current = 1;
    let frame = 0;
    const loop = () => {
      if (heat.current > 0.02 || drag.current) {
        step(bodies.current, links.current, drag.current?.id ?? null, heat.current);
        heat.current *= 0.985;
        setTick((value) => value + 1);
      }
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
    // Restart the layout only when the set of houses changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => {
    heat.current = Math.max(heat.current, 0.5);
  }, [edges.length]);

  const toLocal = (event: ReactPointerEvent) => {
    const matrix = svg.current?.getScreenCTM();
    if (!matrix) return null;
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
    return { x: point.x, y: point.y };
  };

  const grab = (id: number) => (event: ReactPointerEvent<SVGGElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { id, moved: false };
    heat.current = Math.max(heat.current, 0.4);
  };

  const move = (event: ReactPointerEvent<SVGSVGElement>) => {
    const held = drag.current;
    const point = held ? toLocal(event) : null;
    const body = held ? bodies.current.get(held.id) : null;
    if (!held || !point || !body) return;
    held.moved = true;
    body.x = point.x;
    body.y = point.y;
    body.vx = 0;
    body.vy = 0;
    heat.current = Math.max(heat.current, 0.3);
  };

  const release = (id: number) => () => {
    const held = drag.current;
    drag.current = null;
    if (held && !held.moved && id !== HUB) onSelect(id);
  };

  const focusId = hoverId;
  const near = new Set<number>();
  if (focusId !== null) {
    near.add(focusId);
    for (const edge of edges) {
      if (edge.a === focusId) near.add(edge.b);
      if (edge.b === focusId) near.add(edge.a);
    }
  }
  const dim = (id: number) => focusId !== null && !near.has(id);
  const pos = (id: number) => bodies.current.get(id) ?? { x: CX, y: CY };

  const selected = houses.find((house) => house.id === selectedId) ?? null;
  const counts = { ringing: 0, connected: 0, failed: 0, idle: 0, ended: 0 };
  for (const signal of signals.values()) counts[signal] += 1;

  return (
    <section className="graph" aria-label="Neighborhood as nodes">
      <svg ref={svg} viewBox={`0 0 ${W} ${H}`} role="img" onPointerMove={move}>
        <defs>
          <filter id="node-glow" x="-200%" y="-200%" width="500%" height="500%">
            <feGaussianBlur stdDeviation="4" />
          </filter>
        </defs>
        {edges.map((edge) => {
          const a = pos(edge.a);
          const b = pos(edge.b);
          const tone = edge.kind === "call" ? signals.get(edge.b) ?? "idle" : null;
          const lit = focusId !== null && (edge.a === focusId || edge.b === focusId);
          return (
            <line
              key={`${edge.kind}-${edge.a}-${edge.b}`}
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              className={`graph-edge ${edge.kind}${tone ? ` ${tone}` : ""}${lit ? " lit" : ""}${focusId !== null && !lit ? " dim" : ""}`}
            />
          );
        })}
        {ids.map((id) => {
          const { x, y } = pos(id);
          const house = houses.find((item) => item.id === id);
          const signal = id === HUB ? null : signals.get(id) ?? "idle";
          const fill = signal ? FILL[signal] : "#ffffff";
          const r = id === HUB ? 9 : id === selectedId ? 7.5 : 5.5;
          const name = house ? house.name.split(" ")[0] : "Dispatch";
          return (
            <g
              key={id}
              className={`graph-node${signal ? ` ${signal}` : " hub"}${id === selectedId ? " on" : ""}${dim(id) ? " dim" : ""}`}
              transform={`translate(${x} ${y})`}
              onPointerDown={grab(id)}
              onPointerUp={release(id)}
              onPointerEnter={() => setHoverId(id)}
              onPointerLeave={() => setHoverId(null)}
            >
              <circle className="halo" r={r + 4} fill={fill} filter="url(#node-glow)" />
              {signal === "ringing" ? <circle className="ring" r={r} stroke={fill} /> : null}
              <circle className="core" r={r} fill={fill} />
              <text y={r + 14} textAnchor="middle">
                {name}
              </text>
            </g>
          );
        })}
      </svg>
      <div className="graph-legend">
        <span><i style={{ background: FILL.ringing }} /> Ringing {counts.ringing}</span>
        <span><i style={{ background: FILL.connected }} /> Connected {counts.connected}</span>
        <span><i style={{ background: FILL.failed }} /> No answer {counts.failed}</span>
        <span><i style={{ background: FILL.idle }} /> Not called {counts.idle}</span>
      </div>
      {selected ? (
        <aside className="graph-card">
          <p style={{ color: FILL[signals.get(selected.id) ?? "idle"] }}>{LABEL[signals.get(selected.id) ?? "idle"]}</p>
          <strong>{selected.name}</strong>
          <span>{selected.note}</span>
        </aside>
      ) : (
        <aside className="graph-card">
          <p>Nodes</p>
          <strong>The block as a graph</strong>
          <span>{liveEdges ? "Lines show recorded call attempts and stored contact relationships. Drag a node to move it." : "Dispatch calls every house. Gray lines join next-door neighbors. Orange is a matched ride. Drag a node to move it."}</span>
        </aside>
      )}
    </section>
  );
}

function signalFor(house: House, calls: CallCard[], live = false): Signal {
  let latest: CallCard | undefined;
  for (const call of calls) if (call.name === house.name) latest = call;
  if (!latest) return "idle";
  if (live && latest.phase === "done") return "ended";
  if (latest.phase === "calling" || latest.phase === "holding") return "ringing";
  if (latest.phase === "missed" || latest.phase === "declined") return "failed";
  if (latest.phase === "canceled") return "idle";
  return "connected";
}

function buildEdges(houses: House[]): Edge[] {
  const edges: Edge[] = houses.map((house) => ({ a: HUB, b: house.id, kind: "call" }));
  const seen = new Set<string>();
  for (const house of houses) {
    const nearest = houses
      .filter((other) => other.id !== house.id)
      .map((other) => ({ other, d: (other.lng - house.lng) ** 2 + (other.lat - house.lat) ** 2 }))
      .sort((p, q) => p.d - q.d)
      .slice(0, 2);
    for (const { other } of nearest) {
      const pair = [house.id, other.id].sort((p, q) => p - q).join("-");
      if (seen.has(pair)) continue;
      seen.add(pair);
      edges.push({ a: house.id, b: other.id, kind: "near" });
    }
  }
  const helen = houses.find((house) => house.name === "Helen Cho");
  const daniel = houses.find((house) => house.name === "Daniel Ruiz");
  if (helen && daniel && helen.note.includes("Daniel")) edges.push({ a: daniel.id, b: helen.id, kind: "match" });
  return edges;
}

function seed(bodies: Map<number, Body>, houses: House[]) {
  let west = 180;
  let east = -180;
  let south = 90;
  let north = -90;
  for (const house of houses) {
    west = Math.min(west, house.lng);
    east = Math.max(east, house.lng);
    south = Math.min(south, house.lat);
    north = Math.max(north, house.lat);
  }
  const width = Math.max(east - west, 0.0001);
  const height = Math.max(north - south, 0.0001);
  if (!bodies.has(HUB)) bodies.set(HUB, { x: CX, y: CY, vx: 0, vy: 0 });
  for (const house of houses) {
    if (bodies.has(house.id)) continue;
    bodies.set(house.id, {
      x: CX - 160 + ((house.lng - west) / width) * 320,
      y: CY - 110 + ((north - house.lat) / height) * 220,
      vx: 0,
      vy: 0,
    });
  }
}

function step(bodies: Map<number, Body>, edges: Edge[], pinned: number | null, heat: number) {
  const list = [...bodies.entries()];
  for (let i = 0; i < list.length; i += 1) {
    for (let j = i + 1; j < list.length; j += 1) {
      const p = list[i][1];
      const q = list[j][1];
      const dx = p.x - q.x || 0.01;
      const dy = p.y - q.y || 0.01;
      const d2 = Math.max(dx * dx + dy * dy, 100);
      const push = 900 / d2;
      p.vx += dx * push * 0.05;
      p.vy += dy * push * 0.05;
      q.vx -= dx * push * 0.05;
      q.vy -= dy * push * 0.05;
    }
  }
  for (const edge of edges) {
    const p = bodies.get(edge.a);
    const q = bodies.get(edge.b);
    if (!p || !q) continue;
    const rest = edge.kind === "call" ? 120 : edge.kind === "match" ? 60 : 70;
    const dx = q.x - p.x;
    const dy = q.y - p.y;
    const d = Math.sqrt(dx * dx + dy * dy) || 1;
    const pull = ((d - rest) / d) * (edge.kind === "call" ? 0.006 : 0.012);
    p.vx += dx * pull;
    p.vy += dy * pull;
    q.vx -= dx * pull;
    q.vy -= dy * pull;
  }
  const scale = 0.4 + heat;
  for (const [id, body] of list) {
    if (id === pinned) continue;
    body.vx += (CX - body.x) * 0.004;
    body.vy += (CY - body.y) * 0.004;
    body.vx *= 0.82;
    body.vy *= 0.82;
    body.x = Math.min(W - 30, Math.max(30, body.x + body.vx * scale));
    body.y = Math.min(H - 30, Math.max(30, body.y + body.vy * scale));
  }
}
