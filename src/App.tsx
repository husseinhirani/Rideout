import { useEffect, useMemo, useState } from "react";
import { informationCases } from "./api";
import { useBackend } from "./backend";
import { Checks } from "./Checks";
import { FocusView } from "./Dashboard";
import { LiveChecks } from "./LiveChecks";
import { housesFrom, sightingsFrom } from "./live";
import { NeighborhoodMap } from "./NeighborhoodMap";
import { NewInvestigation } from "./OrganizerForms";
import { OperatorPanel } from "./OperatorPanel";
import { useRideOut } from "./telemetry";
import place from "./data/place.json";

export function App() {
  const [offline, setOffline] = useState(false);
  const backend = useBackend(!offline);
  const [tab, setTab] = useState<"checks" | "map">("checks");
  const [simple, setSimple] = useState(true);
  const [aerial, setAerial] = useState(false);
  const [create, setCreate] = useState(false);
  const [caseId, setCaseId] = useState<number | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  const state = backend.state;
  const cases = state ? informationCases(state).sort((a, b) => b.id - a.id) : [];
  const row = cases.find(c => c.id === caseId) ?? cases.find(c => c.status !== "closed") ?? cases[0] ?? null;
  useEffect(() => { if (caseId === null && row) setCaseId(row.id); }, [caseId, row?.id]);
  const houses = useMemo(() => state ? housesFrom(state, [], [], place) : [], [state]);
  const pins = useMemo(() => state ? sightingsFrom(state, row?.id ?? null) : [], [state, row?.id]);
  const person = state?.profiles.find(p => p.id === selected);
  return <main className={`stage${tab === "checks" ? " checks-on" : ""}${simple ? " simple-on" : ""}`}>
    {!offline && <NeighborhoodMap place={place} houses={houses} onSelect={setSelected} angle={aerial ? "aerial" : "side"} simple={simple} showFire={false} sightings={pins} liveData />}
    <header className="top">
      <div className="brand"><strong>RideOut</strong><button type="button" className="mode-pill" onClick={() => { setOffline(!offline); setCreate(false); }}>{offline ? "Offline story → live" : "Live → offline story"}</button></div>
      <nav aria-label="Views"><button type="button" className={tab === "checks" ? "on" : ""} onClick={() => setTab("checks")}>Coordination</button><button type="button" className={tab === "map" ? "on" : ""} onClick={() => setTab("map")}>Map</button></nav>
      <div className="top-end">
        {!offline && <>
          <select aria-label="Investigation" value={row?.id ?? ""} onChange={e => setCaseId(Number(e.target.value))}><option value="" disabled>Choose investigation</option>{cases.map(c => <option key={c.id} value={c.id}>#{c.id} · {c.objective.slice(0, 60)} · {c.status}</option>)}</select>
          <button type="button" disabled={!backend.connected} onClick={() => setCreate(true)}>New investigation</button>
          <button type="button" disabled={!state} onClick={() => {
            const url = URL.createObjectURL(new Blob([JSON.stringify(state, null, 2)], { type: "application/json" }));
            const link = document.createElement("a"); link.href = url; link.download = "rideout-state.json"; link.click(); URL.revokeObjectURL(url);
          }}>Export</button>
        </>}
        {tab === "map" && <><button type="button" onClick={() => setSimple(!simple)}>{simple ? "Satellite" : "Simple map"}</button><button type="button" onClick={() => setAerial(!aerial)}>{aerial ? "Side" : "Aerial"}</button></>}
      </div>
    </header>
    {!offline && <div className={`connection-strip${backend.connected ? "" : " disconnected"}`} role="status">
      {backend.connected ? `${state?.demo_mode.simulate ? "Simulated phones" : "Real calls"} · Real Claude · ${state?.demo_mode.database}` : `Disconnected · ${backend.error ?? "Connecting…"}`}
      {!backend.connected && <span>{backend.updatedAt ? ` Last confirmed state ${Math.floor((now - backend.updatedAt) / 1000)}s ago. Changes disabled.` : " Waiting for the first backend snapshot."}</span>}
    </div>}
    {offline ? <OfflineStory tab={tab} simple={simple} aerial={aerial} now={now} /> : state ? <>
      <LiveChecks key={row?.id ?? "none"} visible={tab === "checks"} state={state} row={row} now={now} disabled={!backend.connected} run={backend.run} />
      {tab === "map" && <aside className="right"><article className="glass person"><p className="kicker">Stored directory locations</p><h3>{person?.name ?? "Map reference"}</h3><p>{person ? `${person.lat}, ${person.lng}. Current whereabouts are unverified.` : `This map covers ${place.name}. ${houses.length} directory profiles are within its bounds; others remain in the directory.`}</p>{row && <><h3>Investigation #{row.id}</h3><p>{row.objective}</p><p>{row.status}{row.policy.paused ? " · paused" : ""}</p></>}<button type="button" onClick={() => setTab("checks")}>Open coordination dashboard</button></article></aside>}
      {create && <div className="product-modal"><FocusView focus={{ id: "create", origin: { x: 0, y: 0, s: 0.9 } }} title="New investigation" kicker="Organizer" icon="spark" onClose={() => setCreate(false)}><NewInvestigation state={state} run={backend.run} disabled={!backend.connected} onCreated={id => { setCaseId(id); setCreate(false); setTab("checks"); }} /></FocusView></div>}
    </> : <div className="connection-empty"><h1>Connect your backend</h1><p>The dashboard will display saved investigations when the API is reachable. It will not substitute an offline story.</p><button type="button" onClick={() => void backend.refresh()}>Retry connection</button></div>}
  </main>;
}

function OfflineStory({ tab, simple, aerial, now }: { tab: string; simple: boolean; aerial: boolean; now: number }) {
  const ride = useRideOut();
  return <>
    <NeighborhoodMap place={ride.place} houses={ride.houses} onSelect={ride.select} angle={aerial ? "aerial" : "side"} simple={simple} showFire={ride.incident.kind === "wildfire"} sightings={ride.incident.sightings} />
    <div className="connection-strip">Offline scripted story · no backend data or real calls <button type="button" disabled={ride.running} onClick={() => ride.start()}>Start offline story</button></div>
    <Checks visible={tab === "checks"} houses={ride.houses} calls={ride.calls} inbound={ride.inbound} incident={ride.incident} started={ride.started} running={ride.running} now={now} chat={ride.chat} busy={ride.tasks.some(t => t.state === "running")} onAsk={ride.ask} onCall={{ busy: !!ride.operator, cancel: ride.cancelCall, takeOver: ride.takeOver, callDirect: ride.callDirect, listen: ride.listen, listeningId: ride.listeningId }} />
    {ride.operator && <OperatorPanel key={ride.operator.callId} session={ride.operator} call={ride.calls.find(c => c.id === ride.operator?.callId)} house={ride.houses.find(h => h.id === ride.operator?.householdId)} now={now} onSaid={ride.operatorSaid} onHangUp={ride.hangUp} />}
  </>;
}
