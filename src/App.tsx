import { useEffect, useRef, useState } from "react";
import { BlockGraph } from "./BlockGraph";
import { Checks } from "./Checks";
import { NeighborhoodMap } from "./NeighborhoodMap";
import { useRideOut } from "./telemetry";
import type { House, HouseStatus } from "./types";

const STATUS: Record<HouseStatus, string> = {
  waiting: "Queued",
  out: "Out",
  needs_ride: "Needs a ride",
  unknown: "No answer",
  no_ride: "No ride",
  blocked: "Not offered",
};

const RANK: Record<HouseStatus, number> = {
  needs_ride: 0,
  no_ride: 1,
  unknown: 2,
  blocked: 3,
  waiting: 4,
  out: 5,
};

export function App() {
  const ride = useRideOut();
  const feed = useRef<HTMLDivElement>(null);
  const [tab, setTab] = useState<"map" | "checks">("map");
  const [scene, setScene] = useState<"side" | "aerial" | "nodes">("side");
  const [now, setNow] = useState(() => new Date());
  const houses = [...ride.houses].sort((a, b) => RANK[a.status] - RANK[b.status]);
  const out = ride.houses.filter((house) => house.status === "out").length;
  const focus = ride.selected ?? houses.find((house) => house.status === "needs_ride" || house.status === "no_ride") ?? null;
  const clock = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const node = feed.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [ride.calls, tab]);

  return (
    <main className={`${tab === "checks" ? "stage checks-on" : "stage"}${scene === "nodes" ? " nodes-on" : ""}`}>
      <NeighborhoodMap place={ride.place} houses={ride.houses} onSelect={ride.select} angle={scene === "aerial" ? "aerial" : "side"} />
      {scene === "nodes" ? <BlockGraph houses={ride.houses} selectedId={focus?.id ?? null} onSelect={ride.select} /> : null}
      <div className="view-toggle" role="group" aria-label="Map style">
        <button type="button" className={scene === "side" ? "on" : ""} onClick={() => setScene("side")}>Side</button>
        <button type="button" className={scene === "aerial" ? "on" : ""} onClick={() => setScene("aerial")}>Aerial</button>
        <button type="button" className={scene === "nodes" ? "on" : ""} onClick={() => setScene("nodes")}>Nodes</button>
      </div>

      <header className="top">
        <div className="brand">
          <strong>RideOut</strong>
        </div>
        <nav aria-label="Views">
          <button type="button" className={tab === "checks" ? "on" : ""} aria-pressed={tab === "checks"} onClick={() => setTab("checks")}>
            Checks
          </button>
          <button type="button" className={tab === "map" ? "on" : ""} aria-pressed={tab === "map"} onClick={() => setTab("map")}>
            Map
          </button>
          <span>Routes</span>
          <span>Fire</span>
        </nav>
        <div className="top-end">
          <time>{clock}</time>
          <button type="button" onClick={ride.start} disabled={ride.running}>
            {ride.running ? "Live" : ride.started ? "Run again" : "Start drill"}
          </button>
        </div>
      </header>

      {tab === "map" ? (
        <>
          <section className="left">
            <article className="glass metrics">
              <div>
                <p>Without a ride</p>
                <strong className={ride.withoutRide > 0 ? "hot" : ""}>{ride.withoutRide}</strong>
                <small>Needs a car that fits</small>
              </div>
              <div>
                <p>Already out</p>
                <strong>{out}</strong>
                <small>of {ride.houses.length} registered</small>
              </div>
            </article>

            <article className="glass list-card">
              <h2>Incoming checks</h2>
              <div className="calls">
                {houses.map((house) => (
                  <button
                    key={house.id}
                    type="button"
                    className={focus?.id === house.id ? "row on" : "row"}
                    onClick={() => ride.select(house.id)}
                  >
                    <span>
                      <b>{house.name}</b>
                      <small>{house.note}</small>
                    </span>
                    <em className={house.status}>{STATUS[house.status]}</em>
                  </button>
                ))}
              </div>
            </article>
          </section>

          <aside className="right">
            <article className="glass match">
              <p className="kicker">Recommended</p>
              <Recommendation houses={ride.houses} started={ride.started} latest={ride.calls.at(-1)?.transcript} />
            </article>
            {focus ? (
              <article className="glass person">
                <p className="kicker">{STATUS[focus.status]}</p>
                <h3>{focus.name}</h3>
                <p>{focus.note}</p>
              </article>
            ) : null}
          </aside>

          <section className="glass log">
            <h2>Live log</h2>
            <div className="log-feed" ref={feed}>
              {ride.calls.length === 0 ? (
                <p>Calls show up here. Unmute one to listen.</p>
              ) : (
                ride.calls.slice(-3).map((call) => (
                  <article key={call.id} className={`call-row ${call.phase}`}>
                    <p className="who">
                      {call.phase === "calling" ? `Calling ${call.name}…` : call.phase === "missed" ? `${call.name} · no answer` : call.name}
                    </p>
                    <button
                      type="button"
                      className={ride.listeningId === call.id ? "listen on" : "listen"}
                      onClick={() => ride.listen(call.id)}
                    >
                      {ride.listeningId === call.id ? "Mute" : "Unmute"}
                    </button>
                    <p className="said">
                      {call.transcript}
                      {call.phase === "live" ? <i className="caret"> ▍</i> : null}
                    </p>
                  </article>
                ))
              )}
            </div>
          </section>
        </>
      ) : null}

      <Checks
        visible={tab === "checks"}
        houses={ride.houses}
        calls={ride.calls}
        inbound={ride.inbound}
        started={ride.started}
        running={ride.running}
        now={now.getTime()}
      />
    </main>
  );
}

function Recommendation({ houses, started, latest }: { houses: House[]; started: boolean; latest?: string }) {
  const helen = houses.find((house) => house.name === "Helen Cho");
  const luis = houses.find((house) => house.name === "Luis Ortega");
  const maya = houses.find((house) => house.name === "Maya Chen");
  let title = "Waiting for the drill";
  let body = "Registered homes are loaded on this block. Start the drill to place the check-in calls.";
  if (started && helen?.status === "needs_ride") {
    title = "Ask Daniel Ruiz";
    body = "Gray Honda, two seats. The detour to Helen Cho stays outside the fire. A walker fits.";
  } else if (helen?.note.includes("Daniel")) {
    title = "Daniel accepted";
    body = "Helen hears his name, the car, and to call 911 if he does not arrive.";
  } else if (started) {
    title = "Sorting the block";
    body = latest ?? "Calls are going out.";
  }
  return (
    <>
      <h3>{title}</h3>
      <p>{body}</p>
      {maya?.status === "blocked" ? <p className="warn">Maya Chen’s van was not offered. The route crosses the fire.</p> : null}
      {luis?.status === "no_ride" ? <p className="warn">Luis Ortega still has no ride. A wheelchair does not fit the open car.</p> : null}
    </>
  );
}
