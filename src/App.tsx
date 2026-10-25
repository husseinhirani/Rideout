import { useEffect, useState } from "react";
import { BlockGraph } from "./BlockGraph";
import { Checks } from "./Checks";
import { SAMPLE_CHILD } from "./facilitator";
import { MapStats } from "./MapStats";
import { MissingChildForm } from "./MissingChildForm";
import { NeighborhoodMap } from "./NeighborhoodMap";
import { OperatorPanel } from "./OperatorPanel";
import { downloadLog } from "./exportLog";
import { householdFor } from "./households";
import { useRideOut } from "./telemetry";
import type { HouseStatus } from "./types";

const STATUS: Record<HouseStatus, string> = {
  waiting: "Queued",
  out: "Out",
  needs_ride: "Needs a ride",
  unknown: "No answer",
  no_ride: "No ride",
  blocked: "Not offered",
};

export function App() {
  const ride = useRideOut();
  const [tab, setTab] = useState<"map" | "checks">("map");
  const [scene, setScene] = useState<"side" | "aerial" | "nodes">("side");
  const [now, setNow] = useState(() => new Date());
  const [menu, setMenu] = useState(false);
  const [form, setForm] = useState(false);
  const waiting = ride.calls.find((call) => call.phase === "holding");
  const child = ride.incident.kind === "missing_child" ? ride.incident.child : null;
  const selected = ride.selected;
  const clock = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <main className={`${tab === "checks" ? "stage checks-on" : "stage"}${scene === "nodes" ? " nodes-on" : ""}`}>
      <NeighborhoodMap
        place={ride.place}
        houses={ride.houses}
        onSelect={ride.select}
        angle={scene === "aerial" ? "aerial" : "side"}
        showFire={ride.incident.kind === "wildfire"}
        sightings={ride.incident.sightings}
      />
      {scene === "nodes" ? <BlockGraph houses={ride.houses} calls={ride.calls} selectedId={selected?.id ?? null} onSelect={ride.select} /> : null}

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
        </nav>
        <div className="top-end">
          <div className="view-toggle" role="group" aria-label="Map style">
            <button type="button" className={scene === "side" ? "on" : ""} aria-pressed={scene === "side"} onClick={() => setScene("side")}>Side</button>
            <button type="button" className={scene === "aerial" ? "on" : ""} aria-pressed={scene === "aerial"} onClick={() => setScene("aerial")}>Aerial</button>
            <button type="button" className={scene === "nodes" ? "on" : ""} aria-pressed={scene === "nodes"} onClick={() => setScene("nodes")}>Nodes</button>
          </div>
          <time>{clock}</time>
          <button
            type="button"
            className="ghost"
            onClick={() =>
              downloadLog({
                place: ride.place,
                houses: ride.houses,
                calls: ride.calls,
                inbound: ride.inbound,
                inboundLog: ride.inboundLog,
                incident: ride.incident,
                chat: ride.chat,
                tasks: ride.tasks,
                started: ride.started,
                running: ride.running,
                recordingFor: ride.recordingFor,
              })
            }
          >
            Export log
          </button>
          <div className="start-menu">
            <button type="button" onClick={() => setMenu((open) => !open)} disabled={ride.running} aria-expanded={menu}>
              {ride.running ? "Live" : ride.started ? "New incident ▾" : "Start ▾"}
            </button>
            {menu && !ride.running ? (
              <div className="start-options" role="menu">
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMenu(false);
                    ride.start();
                  }}
                >
                  <b>Wildfire drill</b>
                  <small>Check every registered neighbor and match rides</small>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMenu(false);
                    setForm(true);
                  }}
                >
                  <b>Missing child</b>
                  <small>Call every home with the child's description</small>
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </header>

      {tab === "map" ? (
        <>
          <MapStats
            calls={ride.calls}
            houses={ride.houses}
            incident={ride.incident}
            callBacks={ride.inboundLog.length}
            homes={ride.homesOnBlock}
            started={ride.started}
            now={now.getTime()}
          />

          <aside className="right">
            {child ? (
              <article className="glass child-card">
                <p className={ride.incident.foundAt ? "kicker found" : "kicker hot"}>{ride.incident.foundAt ? "Found" : "Missing child"}</p>
                <h3>
                  {child.name}, {child.age}
                </h3>
                <dl>
                  <div>
                    <dt>Wearing</dt>
                    <dd>{child.clothing}</dd>
                  </div>
                  <div>
                    <dt>Last seen</dt>
                    <dd>{child.lastSeen}</dd>
                  </div>
                  <div>
                    <dt>Call-back</dt>
                    <dd>{child.callback}</dd>
                  </div>
                </dl>
                {ride.incident.foundAt ? null : (
                  <button type="button" className="mark-found" onClick={ride.markFound}>
                    Mark found
                  </button>
                )}
              </article>
            ) : null}
            {selected ? (
              <article className="glass person">
                <p className="kicker">{STATUS[selected.status]}</p>
                <h3>{selected.name}</h3>
                <p>{householdFor(selected.id, selected.name).address}</p>
                <p>{selected.note}</p>
              </article>
            ) : null}
          </aside>
        </>
      ) : null}

      <Checks
        visible={tab === "checks"}
        houses={ride.houses}
        calls={ride.calls}
        inbound={ride.inbound}
        incident={ride.incident}
        started={ride.started}
        running={ride.running}
        now={now.getTime()}
        chat={ride.chat}
        busy={ride.tasks.some((task) => task.state === "running")}
        onAsk={ride.ask}
        onCall={{
          busy: Boolean(ride.operator),
          cancel: ride.cancelCall,
          takeOver: ride.takeOver,
          callDirect: ride.callDirect,
          listen: ride.listen,
          listeningId: ride.listeningId,
        }}
      />

      {waiting && !ride.operator ? (
        <div className="handoff-banner" role="alert">
          <p>
            <b>{waiting.name} needs a person.</b> {waiting.escalation?.reason}
          </p>
          <button type="button" className="pick-up" onClick={() => ride.takeOver(waiting.id)}>
            Pick up
          </button>
          <button type="button" onClick={() => ride.cancelCall(waiting.id)}>
            Cancel call
          </button>
        </div>
      ) : null}

      {ride.operator ? (
        <OperatorPanel
          key={ride.operator.callId}
          session={ride.operator}
          call={ride.calls.find((call) => call.id === ride.operator?.callId)}
          house={ride.houses.find((house) => house.id === ride.operator?.householdId)}
          now={now.getTime()}
          onSaid={ride.operatorSaid}
          onHangUp={ride.hangUp}
        />
      ) : null}

      {form ? (
        <MissingChildForm
          initial={SAMPLE_CHILD}
          homes={ride.homesOnBlock}
          onClose={() => setForm(false)}
          onStart={(details) => {
            setForm(false);
            ride.startMissingChild(details);
          }}
        />
      ) : null}
    </main>
  );
}
