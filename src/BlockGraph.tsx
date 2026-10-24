import type { House, HouseStatus } from "./types";

const FILL: Record<HouseStatus, string> = {
  waiting: "#8b93a7",
  out: "#3ddc97",
  needs_ride: "#ff7a2f",
  unknown: "#ff5d4a",
  no_ride: "#ff5d4a",
  blocked: "#f0c14a",
};

type Props = {
  houses: House[];
  selectedId: number | null;
  onSelect: (id: number) => void;
};

export function BlockGraph({ houses, selectedId, onSelect }: Props) {
  const placed = layout(houses);
  const edges = links(placed);
  const helen = houses.find((house) => house.name === "Helen Cho");
  const daniel = houses.find((house) => house.name === "Daniel Ruiz");
  const matched = Boolean(helen && daniel && helen.note.includes("Daniel"));
  const selected = houses.find((house) => house.id === selectedId) ?? null;

  return (
    <section className="graph" aria-label="Neighborhood as nodes">
      <svg viewBox="0 0 1000 700" role="img">
        {edges.map((edge) => (
          <line key={edge.key} x1={edge.x1} y1={edge.y1} x2={edge.x2} y2={edge.y2} className="graph-edge" />
        ))}
        {matched && helen && daniel ? (
          <line
            className="graph-edge match"
            x1={placed.find((node) => node.id === helen.id)?.x}
            y1={placed.find((node) => node.id === helen.id)?.y}
            x2={placed.find((node) => node.id === daniel.id)?.x}
            y2={placed.find((node) => node.id === daniel.id)?.y}
          />
        ) : null}
        {placed.map((node) => (
          <g key={node.id} className={node.id === selectedId ? "graph-node on" : "graph-node"} onClick={() => onSelect(node.id)}>
            <circle cx={node.x} cy={node.y} r={node.id === selectedId ? 22 : 16} fill={FILL[node.status]} />
            <text x={node.x} y={node.y + 34} textAnchor="middle">
              {node.name.split(" ")[0]}
            </text>
          </g>
        ))}
      </svg>
      {selected ? (
        <aside className="graph-card">
          <p>{selected.status.replace("_", " ")}</p>
          <strong>{selected.name}</strong>
          <span>{selected.note}</span>
        </aside>
      ) : (
        <aside className="graph-card">
          <p>Nodes</p>
          <strong>The block as a graph</strong>
          <span>Each house is a node. A line means they share the block. Orange is a matched ride.</span>
        </aside>
      )}
    </section>
  );
}

function layout(houses: House[]) {
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
  return houses.map((house) => ({
    ...house,
    x: 80 + ((house.lng - west) / width) * 840,
    y: 80 + ((north - house.lat) / height) * 500,
  }));
}

function links(nodes: Array<House & { x: number; y: number }>) {
  const edges: { key: string; x1: number; y1: number; x2: number; y2: number }[] = [];
  for (let i = 0; i < nodes.length; i += 1) {
    for (let j = i + 1; j < nodes.length; j += 1) {
      const dx = nodes[i].x - nodes[j].x;
      const dy = nodes[i].y - nodes[j].y;
      if (dx * dx + dy * dy < 280 * 280) {
        edges.push({ key: `${nodes[i].id}-${nodes[j].id}`, x1: nodes[i].x, y1: nodes[i].y, x2: nodes[j].x, y2: nodes[j].y });
      }
    }
  }
  return edges;
}
