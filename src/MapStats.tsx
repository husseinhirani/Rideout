import type { CallCard, House, Incident } from "./types";

/**
 * The map's overlay is numbers only. The people and the transcripts live on the Checks tab.
 */
type Tile = { label: string; value: string | number; hot?: boolean; good?: boolean };

export function MapStats({
  calls,
  houses,
  incident,
  callBacks,
  homes,
  started,
  now,
  areaName,
}: {
  calls: CallCard[];
  houses: House[];
  incident: Incident;
  callBacks: number;
  homes: number;
  started: boolean;
  now: number;
  areaName: string;
}) {
  if (!started && incident.startedAt === 0) {
    return (
      <section className="left stats" aria-label="Area information">
        <details className="glass area-summary" open>
          <summary>{areaName}</summary>
          <div className="area-summary-lines">
            <p><strong>{homes}</strong><span>Homes in this area</span></p>
            <p><strong>{houses.length}</strong><span>Registered residents</span></p>
          </div>
        </details>
      </section>
    );
  }
  const count = (test: (call: CallCard) => boolean) => calls.filter(test).length;
  const reached = count((call) => call.answeredAt !== null && call.phase !== "canceled" && !call.voicemail);
  const missed = count((call) => call.phase === "missed" || call.phase === "declined");
  const onLine = count((call) => call.phase === "calling" || call.phase === "live" || call.phase === "operator");
  const needYou = count((call) => call.phase === "holding");
  const canceled = count((call) => call.phase === "canceled");
  const minutes = incident.startedAt ? Math.max(0, Math.floor((now - incident.startedAt) / 60000)) : 0;

  let title = "Area status";
  let groups: { name: string; tiles: Tile[] }[] = [];

  if (incident.kind === "missing_child") {
    const alerts = calls.filter((call) => call.purpose === "alert");
    title = incident.foundAt ? "Missing child · found" : "Missing child · searching";
    groups = [
      {
        name: "Alert calls",
        tiles: [
          { label: `Called of ${homes}`, value: alerts.length },
          { label: "Heard it live", value: alerts.filter((call) => call.answeredAt !== null && !call.voicemail).length, good: true },
          { label: "Voicemail", value: alerts.filter((call) => call.voicemail).length },
          { label: "No answer", value: alerts.filter((call) => call.phase === "missed").length },
          { label: "Ringing now", value: alerts.filter((call) => call.phase === "calling" || call.phase === "live").length },
          { label: "Need you", value: needYou, hot: needYou > 0 },
        ],
      },
      {
        name: "Search",
        tiles: [
          { label: "Call-backs", value: callBacks },
          { label: "Sightings", value: incident.sightings.length, hot: incident.sightings.some((sighting) => !sighting.safe) },
          { label: "Minutes since alert", value: minutes },
          { label: "Status", value: incident.foundAt ? "Found" : "Searching", good: Boolean(incident.foundAt), hot: !incident.foundAt },
        ],
      },
    ];
  } else if (started) {
    title = "Wildfire · check-ins";
    groups = [
      {
        name: "Calls",
        tiles: [
          { label: "Placed", value: calls.length },
          { label: "Answered", value: reached, good: true },
          { label: "No answer", value: missed },
          { label: "On the line", value: onLine },
          { label: "Need you", value: needYou, hot: needYou > 0 },
          { label: "Canceled", value: canceled },
        ],
      },
      {
        name: `Residents · ${houses.length} registered`,
        tiles: [
          { label: "Out", value: houses.filter((house) => house.status === "out").length, good: true },
          {
            label: "Without a ride",
            value: houses.filter((house) => house.status === "needs_ride" || house.status === "no_ride").length,
            hot: houses.some((house) => house.status === "needs_ride" || house.status === "no_ride"),
          },
          { label: "Not reached", value: houses.filter((house) => house.status === "unknown").length },
          { label: "Car not offered", value: houses.filter((house) => house.status === "blocked").length },
          { label: "Not called yet", value: houses.filter((house) => house.status === "waiting").length },
          { label: "Minutes in", value: minutes },
        ],
      },
    ];
  } else {
    groups = [
      {
        name: "On this block",
        tiles: [
          { label: "Homes", value: homes },
          { label: "Registered", value: houses.length },
        ],
      },
    ];
  }

  return (
    <section className="left stats" aria-label="Incident numbers">
      <article className="glass stats-card">
        <p className="kicker">{title}</p>
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
