import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { MissingChildForm } from "./MissingChildForm";
import { SAMPLE_CHILD } from "./facilitator";
import { downloadLog, downloadBackendLog } from "./exportLog";
import { informationCases } from "./api";
import { useBackend } from "./backend";
import { BlockGraph } from "./BlockGraph";
import { LiveStats } from "./LiveStats";
import { CaseCard } from "./CaseCard";
import { MapStats } from "./MapStats";
import { Checks } from "./Checks";
import { FocusView } from "./Dashboard";
import { LiveChecks } from "./LiveChecks";
import { housesFrom, sightingsFrom } from "./live";
import { NeighborhoodMap } from "./NeighborhoodMap";
import { NewInvestigation, CaseSettings, IntakeSettings } from "./OrganizerForms";
import { OperatorPanel } from "./OperatorPanel";
import { useRideOut } from "./telemetry";
import place from "./data/place.json";

export function App() {
  const [offline, setOffline] = useState(false);
  const backend = useBackend(!offline);
  const [tab, setTab] = useState<"checks" | "map">("map");
  const [simple, setSimple] = useState(false);
  const [scene, setScene] = useState<"side" | "aerial" | "nodes">("side");
  const [create, setCreate] = useState(false);
  const [menu, setMenu] = useState(false);
  const [settingsPanel, setSettingsPanel] = useState<"settings" | "intake" | null>(null);
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
  return <main className={`stage${tab === "checks" ? " checks-on" : ""}${simple ? " simple-on" : ""}${scene === "nodes" && tab === "map" ? " nodes-on" : ""}`}>
    {!offline && <NeighborhoodMap place={place} houses={houses} onSelect={setSelected} angle={scene === "aerial" ? "aerial" : "side"} simple={simple} showFire={false} sightings={pins} liveData />}
    {!offline && state && tab === "map" && scene === "nodes" && <BlockGraph houses={state.profiles.map(p => ({ id: p.id, name: p.name, lat: p.lat, lng: p.lng, status: "waiting", note: "Stored directory profile; current whereabouts unverified." }))} calls={[]} selectedId={selected} onSelect={setSelected} liveState={state} caseId={row?.id ?? null} />}
    <header className="top">
      <div className="brand"><strong>RideOut</strong><button type="button" className="mode-pill" onClick={() => { setOffline(!offline); setCreate(false); setMenu(false); setSettingsPanel(null); }}>{offline ? "Offline story → live" : "Live → offline story"}</button></div>
      <nav aria-label="Views"><button type="button" className={tab === "checks" ? "on" : ""} onClick={() => setTab("checks")}>Checks</button><button type="button" className={tab === "map" ? "on" : ""} onClick={() => setTab("map")}>Map</button></nav>
      <div className="top-end" id="top-actions">
        <div className="map-controls">
          <div className="view-toggle" role="group" aria-label="Map style">{(["side", "aerial", "nodes"] as const).map(view => <button key={view} type="button" className={scene === view ? "on" : ""} aria-pressed={scene === view} onClick={() => setScene(view)}>{view[0].toUpperCase() + view.slice(1)}</button>)}</div>
          <button type="button" className={simple ? "simple-switch on" : "simple-switch"} aria-pressed={simple} onClick={() => setSimple(!simple)}>Simple<i /></button>
        </div>
        {!offline && <>
          {tab === "checks" && <select aria-label="Investigation" value={row?.id ?? ""} onChange={e => setCaseId(Number(e.target.value))}><option value="" disabled>Choose investigation</option>{cases.map(c => <option key={c.id} value={c.id}>#{c.id} · {c.objective.slice(0, 60)} · {c.status}</option>)}</select>}
          <time>{new Date(now).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time>
          <button type="button" className="ghost" disabled={!state} onClick={() => { if (state) downloadBackendLog(state); }}>Export log</button>
          <div className="start-menu"><button type="button" disabled={!backend.connected} aria-expanded={menu} onClick={() => setMenu(!menu)}>Start ▾</button>{menu && <div className="start-options" role="menu">
            <button type="button" role="menuitem" onClick={() => { setMenu(false); setCreate(true); }}><b>New investigation</b><small>Describe the incident, objective and permitted contacts</small></button>
            <button type="button" role="menuitem" disabled={!row} onClick={() => { setMenu(false); setSettingsPanel("settings"); }}><b>Organizer settings</b><small>Directory filters, contact scope and consent</small></button>
            <button type="button" role="menuitem" onClick={() => { setMenu(false); setSettingsPanel("intake"); }}><b>Phone intake</b><small>Choose who may open investigations by phone</small></button>
          </div>}</div>
        </>}
      </div>
    </header>
    {!offline && <div className={`connection-strip${backend.connected ? "" : " disconnected"}`} role="status">
      {backend.connected ? `${state?.demo_mode.simulate ? "Simulated phones" : "Real calls"} · Real Claude · ${state?.demo_mode.database}` : `Disconnected · ${backend.error ?? "Connecting…"}`}
      {!backend.connected && <span>{backend.updatedAt ? ` Last confirmed state ${Math.floor((now - backend.updatedAt) / 1000)}s ago. Changes disabled.` : " Waiting for the first backend snapshot."}</span>}
    </div>}
    {offline ? <OfflineStory tab={tab} simple={simple} scene={scene} now={now} /> : state ? <>
      <LiveChecks key={row?.id ?? "none"} visible={tab === "checks"} state={state} row={row} now={now} disabled={!backend.connected} run={backend.run} />
      {tab === "map" && <><LiveStats state={state} caseId={row?.id ?? null} /><aside className="right"><CaseCard state={state} chosenId={row?.id ?? null} now={now} onChoose={setCaseId} onClose={() => setTab("checks")} /><article className="glass person"><p className="kicker">Stored directory locations</p><h3>{person?.name ?? "Map reference"}</h3><p>{person ? `${person.lat}, ${person.lng}. Current whereabouts are unverified.` : `This map covers ${place.name}. ${houses.length} directory profiles are within its bounds; others remain in the directory.`}</p>{row && <><h3>Investigation #{row.id}</h3><p>{row.objective}</p><p>{row.status}{row.policy.paused ? " · paused" : ""}</p></>}<button type="button" onClick={() => setTab("checks")}>Open checks</button></article></aside></>}
      {settingsPanel && <div className="product-modal"><FocusView focus={{ id: settingsPanel, origin: { x: 0, y: 0, s: .9 } }} title={settingsPanel === "intake" ? "Phone intake" : "Organizer settings"} kicker="Organizer" icon="grid" onClose={() => setSettingsPanel(null)}>{settingsPanel === "intake" ? <IntakeSettings state={state} run={backend.run} disabled={!backend.connected} /> : row && <CaseSettings state={state} row={row} run={backend.run} disabled={!backend.connected} />}</FocusView></div>}
      {create && <div className="product-modal"><FocusView focus={{ id: "create", origin: { x: 0, y: 0, s: 0.9 } }} title="New investigation" kicker="Organizer" icon="spark" onClose={() => setCreate(false)}><NewInvestigation state={state} run={backend.run} disabled={!backend.connected} onCreated={id => { setCaseId(id); setCreate(false); setTab("checks"); }} /></FocusView></div>}
    </> : <div className="connection-empty"><h1>Connect your backend</h1><p>The dashboard will display saved investigations when the API is reachable. It will not substitute an offline story.</p><button type="button" onClick={() => void backend.refresh()}>Retry connection</button></div>}
  </main>;
}

function OfflineStory({ tab, simple, scene, now }: { tab: string; simple: boolean; scene: "side" | "aerial" | "nodes"; now: number }) {
  const ride = useRideOut();
  const [menu, setMenu] = useState(false);
  const [childForm, setChildForm] = useState(false);
  const waiting = ride.calls.find(c => c.phase === "holding");
  const child = ride.incident.child;
  const toolbar = document.getElementById("top-actions");
  return <>
    {toolbar && createPortal(<><time>{new Date(now).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time><button type="button" className="ghost" onClick={() => downloadLog({ place: ride.place, houses: ride.houses, calls: ride.calls, inbound: ride.inbound, inboundLog: ride.inboundLog, incident: ride.incident, chat: ride.chat, tasks: ride.tasks, started: ride.started, running: ride.running, recordingFor: ride.recordingFor })}>Export log</button><div className="start-menu"><button type="button" disabled={ride.running} aria-expanded={menu} onClick={() => setMenu(!menu)}>{ride.running ? "Live" : "Start ▾"}</button>{menu && <div className="start-options" role="menu"><button type="button" role="menuitem" onClick={() => { setMenu(false); ride.start(); }}><b>Wildfire drill</b><small>Offline scripted check-ins and ride matches</small></button><button type="button" role="menuitem" onClick={() => { setMenu(false); setChildForm(true); }}><b>Missing child</b><small>Offline scripted search scenario</small></button></div>}</div></>, toolbar)}
    <NeighborhoodMap place={ride.place} houses={ride.houses} onSelect={ride.select} angle={scene === "aerial" ? "aerial" : "side"} simple={simple} showFire={ride.incident.kind === "wildfire"} sightings={ride.incident.sightings} />
    {tab === "map" && scene === "nodes" && <BlockGraph houses={ride.houses} calls={ride.calls} selectedId={ride.selected?.id ?? null} onSelect={ride.select} />}
    {tab === "map" && <><MapStats calls={ride.calls} houses={ride.houses} incident={ride.incident} callBacks={ride.inboundLog.length} homes={ride.homesOnBlock} started={ride.started} now={now} />{(ride.selected || child) && <aside className="right">{child && <article className="glass child-card"><p className={ride.incident.foundAt ? "kicker found" : "kicker hot"}>{ride.incident.foundAt ? "Found" : "Missing child"}</p><h3>{child.name}, {child.age}</h3><p>{child.clothing}</p><p>Last seen: {child.lastSeen}</p><p>Call-back: {child.callback}</p>{!ride.incident.foundAt && <button type="button" className="mark-found" onClick={ride.markFound}>Mark found</button>}</article>}{ride.selected && <article className="glass person"><h3>{ride.selected.name}</h3><p>{ride.selected.note}</p></article>}</aside>}</>}
    <div className="connection-strip">Offline scripted story · no backend data or real calls</div>
    <Checks visible={tab === "checks"} houses={ride.houses} calls={ride.calls} inbound={ride.inbound} incident={ride.incident} started={ride.started} running={ride.running} now={now} chat={ride.chat} busy={ride.tasks.some(t => t.state === "running")} onAsk={ride.ask} onCall={{ busy: !!ride.operator, cancel: ride.cancelCall, takeOver: ride.takeOver, callDirect: ride.callDirect, listen: ride.listen, listeningId: ride.listeningId }} />
    {childForm && <MissingChildForm initial={SAMPLE_CHILD} homes={ride.homesOnBlock} onClose={() => setChildForm(false)} onStart={details => { setChildForm(false); ride.startMissingChild(details); }} />}
    {waiting && !ride.operator && <div className="handoff-banner" role="alert"><p><b>{waiting.name} needs a person.</b> {waiting.escalation?.reason}</p><button type="button" className="pick-up" onClick={() => ride.takeOver(waiting.id)}>Pick up</button><button type="button" onClick={() => ride.cancelCall(waiting.id)}>Cancel call</button></div>}
    {ride.operator && <OperatorPanel key={ride.operator.callId} session={ride.operator} call={ride.calls.find(c => c.id === ride.operator?.callId)} house={ride.houses.find(h => h.id === ride.operator?.householdId)} now={now} onSaid={ride.operatorSaid} onHangUp={ride.hangUp} />}
  </>;
}
