import type { BackendState } from "./api";
import { callsFor, currentCase, inboundFrom, latestIncident } from "./live";

type Tile = { label: string; value: number | string; hot?: boolean; good?: boolean };

/** Live numbers from /state, in the same tiles as the offline drill. */
export function LiveStats({ state, caseId }: { state: BackendState; caseId: number | null }) {
  const row = currentCase(state, caseId);
  const calls = row ? callsFor(state, row.id) : [];
  const sweep = !row || row.kind === "information" ? null : latestIncident(state, true);
  const people = sweep ? state.incident_people.filter((item) => item.incident_id === sweep.id) : [];
  const count = (status: string) => people.filter((item) => item.status === status).length;
  const reports = calls.filter(call => call.progress?.report_received).length;
  const review = inboundFrom(state).filter((item) => item.review).length;
  const groups: { name: string; tiles: Tile[] }[] = [];
  if (row) {
    groups.push({
      name: `Case #${row.id} · calls`,
      tiles: [
        { label: "Active", value: calls.filter((call) => call.transport === "active").length, hot: calls.some((call) => call.transport === "active") },
        { label: "Queued or placing", value: calls.filter((call) => call.transport === "queued" || call.transport === "dispatching").length },
        { label: "Ended", value: calls.filter((call) => call.transport === "ended").length },
        { label: "Unresolved", value: calls.filter((call) => call.transport === "unknown").length, hot: calls.some((call) => call.transport === "unknown") },
        { label: "Reports", value: reports, good: reports > 0 },
        { label: "Inbound to review", value: review, hot: review > 0 },
      ],
    });
  }
  if (sweep) {
    groups.push({
      name: `Check-in sweep · ${people.length} in range`,
      tiles: [
        { label: "Safe", value: count("safe"), good: true },
        { label: "Need a ride", value: count("victim"), hot: count("victim") > 0 },
        { label: "No answer", value: count("unknown") },
        { label: "Calling", value: count("checking_in") },
      ],
    });
  }
  if (!groups.length) {
    groups.push({ name: "Backend", tiles: [{ label: "Registered", value: state.profiles.length }, { label: "Cases", value: state.cases.length }] });
  }
  return (
    <section className="left stats" aria-label="Live numbers">
      <article className="glass stats-card">
        <p className="kicker">Live backend</p>
        {groups.map((group) => (
          <div key={group.name} className="stat-group">
            <h2>{group.name}</h2>
            <div className="stat-grid">
              {group.tiles.map((tile) => (
                <div key={tile.label} className="stat-tile">
                  <strong className={`${tile.hot ? "hot" : tile.good ? "good" : ""}${typeof tile.value === "string" ? " word" : ""}`}>{tile.value}</strong>
                  <small>{tile.label}</small>
                </div>
              ))}
            </div>
          </div>
        ))}
      </article>
    </section>
  );
}
