import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api, presentationState, savedConversation, directoryEdges, type CoordinatorAction } from "./updated-ui-api";
import { useBackend } from "./backend";
import { BlockGraph } from "./BlockGraph";
import { CaseCard } from "./CaseCard";
import { Checks } from "./Checks";
import { SAMPLE_CHILD } from "./facilitator";
import { IntakeForm } from "./IntakeForm";
import { currentCase, demoLabel, graphCalls, housesFrom, callsFor, sightingsFrom, latestIncident, type LiveCall } from "./live";
import { LiveChecks } from "./LiveChecks";
import { LiveStats } from "./LiveStats";
import { MapStats } from "./MapStats";
import { MissingChildForm } from "./MissingChildForm";
import { NeighborhoodMap } from "./NeighborhoodMap";
import { IncidentMap } from "./IncidentMap";
import { participantLocation } from "../server/shared/spatial";
import { OperatorPanel } from "./OperatorPanel";
import { RegisterForm } from "./RegisterForm";
import { downloadLog } from "./exportLog";
import { householdFor } from "./households";
import { assignHouses, footprints, GEO, useRideOut, wildfireMockCalls } from "./telemetry";
import type { ChatMessage, HouseStatus, OperatorSession } from "./types";

const STATUS: Record<HouseStatus, string> = {
  waiting: "Queued",
  out: "Out",
  needs_ride: "Needs a ride",
  unknown: "No answer",
  no_ride: "No ride",
  blocked: "Not offered",
};

// Live statuses come from the backend check-in, so they read differently.
const LIVE_STATUS: Record<HouseStatus, string> = {
  waiting: "Registered",
  out: "Said they are safe",
  needs_ride: "Needs a ride",
  unknown: "No answer · not confirmed safe",
  no_ride: "No ride",
  blocked: "Not offered",
};

export function App() {
  const ride = useRideOut();
  const backend = useBackend();
  const [preferOffline, setPreferOffline] = useState(false);
  const [tab, setTab] = useState<"map" | "checks">("map");
  const [scene, setScene] = useState<"side" | "aerial" | "nodes">("side");
  const [simple, setSimple] = useState(false);
  const [drawMode, setDrawMode] = useState<"rectangle" | "brush" | null>(null);
  const [highlightedIds, setHighlightedIds] = useState<number[]>([]);
  const [facilitatorRequest, setFacilitatorRequest] = useState(0);
  const [groupMenuPosition, setGroupMenuPosition] = useState<{ x: number; y: number } | null>(null);
  const [now, setNow] = useState(() => new Date());
  const [menu, setMenu] = useState(false);
  const [form, setForm] = useState(false);
  const [register, setRegister] = useState(false);
  const [caseId, setCaseId] = useState<number | null>(0);
  const [liveChat, setLiveChat] = useState<ChatMessage[]>([]);
  const [chatBusy, setChatBusy] = useState(false);
  const [liveSelected, setLiveSelected] = useState<number | null>(null);
  const [outside, setOutside] = useState<{ session: OperatorSession; call: LiveCall } | null>(null);
  const [startingDrill, setStartingDrill] = useState(false);
  const [coordinatorBusy, setCoordinatorBusy] = useState(false);
  const [retryChat, setRetryChat] = useState<{ caseId: number; text: string } | null>(null);
  const drillLock = useRef(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [dismissedConcern, setDismissedConcern] = useState("");
  useEffect(() => {
    if (!notice?.startsWith("Calls are queued")) return;
    const timer = window.setTimeout(() => setNotice(null), 8000);
    return () => window.clearTimeout(timer);
  }, [notice]);
  const recordings = useRef(new Map<string, Blob>());
  const waiting = ride.calls.find((call) => call.phase === "holding");
  const child = ride.incident.kind === "missing_child" ? ride.incident.child : null;
  const selected = ride.selected;
  const clock = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const state = useMemo(() => backend.state ? presentationState(backend.state) : null, [backend.state]);
  const live = Boolean(state && !preferOffline);

  const residents = useMemo(() => assignHouses(), []);
  const spots = useMemo(
    () =>
      footprints.features.map((feature) => {
        const ring = (feature.geometry as { coordinates: number[][][] }).coordinates[0];
        const count = Math.max(ring.length - 1, 1);
        let lng = 0;
        let lat = 0;
        for (let i = 0; i < count; i += 1) {
          lng += ring[i][0];
          lat += ring[i][1];
        }
        return { id: feature.id as number, lng: lng / count, lat: lat / count };
      }),
    [],
  );
  const liveCase = state ? currentCase(state, caseId) : null;
  const liveDrill = state?.wildfire_drills?.find(drill => drill.case_id === liveCase?.id);
  const assistance = state?.assistance_sessions?.find(session => session.case_id === liveCase?.id);
  const mockCalls = liveDrill && !assistance ? wildfireMockCalls(Date.parse(liveDrill.started_at), now.getTime()) : [];
  const savedChat = savedConversation(state, liveCase?.id ?? null);
  const conversation = [...savedChat, ...liveChat.filter(message => !savedChat.some(saved => saved.from === message.from && saved.text === message.text))].sort((a,b) => a.at - b.at);
  useEffect(() => { setLiveChat([]); }, [liveCase?.id]);
  const liveHouses = useMemo(() => assistance ? assistance.people.flatMap(person => {
    const { location, confirmed } = participantLocation(assistance, person);
    return location ? [{ id: person.profile_id, name: person.name, lat: location.lat, lng: location.lng,
      status: (person.unreachable ? "unknown" : person.facts.needs_transport ? "needs_ride" : "waiting") as HouseStatus,
      note: (confirmed ? "Participant-reported incident location: " : "Assigned drill position (unconfirmed): ") + location.label }] : [];
  }) : state ? housesFrom(state, residents, spots, GEO) : [], [state, assistance, residents, spots]);
  const liveCalls = useMemo(() => (state && liveCase ? callsFor(state, liveCase.id) : []), [state, liveCase?.id]);
  const liveSightings = useMemo(() => (state ? sightingsFrom(state, liveCase?.id ?? null) : []), [state, liveCase?.id]);
  const liveGraph = useMemo(() => graphCalls(liveCalls, liveHouses), [liveCalls, liveHouses]);
  const selectedProfile = state?.profiles.find(p => p.id === liveSelected);
  const livePerson = liveHouses.find((house) => house.id === liveSelected) ?? (!assistance && selectedProfile ? { ...selectedProfile, status: "waiting" as const, note: "Stored directory profile; current whereabouts unverified." } : null);
  const concern = live ? liveCalls.find((call) => call.attempt.concern && call.transport !== "ended" && call.transport !== "cancelled") : undefined;
  const highlighted = useMemo(() => highlightedIds.map((id) => {
    if (live) {
      const footprint = spots.find(item => item.id === id);
      return `mapped building ${id}${footprint ? ` at ${footprint.lat}, ${footprint.lng}` : ""} (current occupants and whereabouts unconfirmed)`;
    }
    const house = ride.houses.find((item) => item.id === id);
    const home = householdFor(id, house?.name);
    return `${home.address} (${home.owner}, building ${id})`;
  }), [highlightedIds, live, spots, ride.houses]);
  const mapContext = highlighted.length ? `\n\nDispatcher map filter: highlighted ${highlighted.length} building${highlighted.length === 1 ? "" : "s"}: ${highlighted.join("; ")}. Use these buildings as the geographic area of interest when choosing candidates.` : "";
  const changeHighlights = useCallback((ids: number[], position?: { x: number; y: number }) => {
    setHighlightedIds(ids);
    setGroupMenuPosition(ids.length && position ? position : null);
  }, []);
  const openGroupMenu = useCallback((position: { x: number; y: number }) => setGroupMenuPosition(position), []);
  const selectedResidents = (live ? liveHouses : ride.houses).filter((house) => highlightedIds.includes(house.id));
  const openCoordinatorForGroup = () => {
    setTab("checks");
    setFacilitatorRequest((value) => value + 1);
  };

  // Start idle on a fresh page unless a real call still needs attention. New
  // cases opened during this session take focus; old completed drills stay history.
  const newestSeen = useRef<number | null>(null);
  const newestCase = state?.cases.reduce((max, row) => Math.max(max, row.id), 0) ?? 0;
  useEffect(() => {
    if (!state) return;
    if (newestSeen.current === null) {
      const ongoing = [...state.attempt_progress].reverse().find(call => ["queued", "dispatching", "active", "unknown"].includes(call.transport));
      const openCoordination = [...(state.assistance_sessions ?? [])].reverse().find(session =>
        state.cases.some(row => row.id === session.case_id && row.status !== "closed"));
      setCaseId(current => current === 0 ? ongoing?.support_case_id ?? openCoordination?.case_id ?? current : current);
    } else if (newestCase > newestSeen.current) setCaseId(newestCase);
    newestSeen.current = newestCase;
  }, [state, newestCase]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const say = (from: ChatMessage["from"], text: string) =>
    setLiveChat((current) => [...current, { id: `${from}-${Date.now()}-${current.length}`, from, text, at: Date.now() }]);

  const fail = (error: unknown) => setNotice(error instanceof Error ? error.message : "The backend refused that");

  const sendCoordinatorMessage = async (selectedCaseId: number, text: string) => {
    const session = state?.assistance_sessions?.find(item => item.case_id === selectedCaseId);
    if (!session || chatBusy) return;
    setChatBusy(true);
    setRetryChat(null);
    try {
      await backend.run(() => api.coordinator(selectedCaseId, session.revision, { action: "message", text }));
      setNotice(null);
    } catch (error) {
      setRetryChat({ caseId: selectedCaseId, text });
      setNotice(error instanceof Error ? error.message : "The coordinator could not answer. Retry to check the saved message.");
    } finally { setChatBusy(false); }
  };

  const liveActions = {
    coordinator: async (expectedRevision: number, action: CoordinatorAction) => {
      if (!liveCase || coordinatorBusy) return;
      setCoordinatorBusy(true);
      try { await backend.run(() => api.coordinator(liveCase.id, expectedRevision, action)); }
      finally { setCoordinatorBusy(false); }
    },
    cancel: async (attemptId: number) => {
      try {
        const result = await backend.run(() => api.cancel(attemptId));
        return result.reason;
      } catch (error) {
        return error instanceof Error ? error.message : "Not cancelled";
      }
    },
    report: async (attemptId: number, answer: string, concernText: string) => {
      await backend.run(() => api.report(attemptId, answer, concernText));
    },
    callYourself: (call: LiveCall) => {
      if (["queued", "dispatching", "active", "unknown"].includes(call.transport ?? "unknown")) return;
      const house = liveHouses.find((item) => item.name === call.person?.name);
      setOutside({
        call,
        session: { callId: `attempt-${call.attempt.id}`, name: call.person?.name ?? "Unknown", householdId: house?.id ?? null, mode: "direct", startedAt: Date.now() },
      });
    },
    checkIn: async (incidentId: number, profileId: number, result: "safe" | "victim") => {
      try {
        await backend.run(() => api.checkIn(incidentId, profileId, result));
      } catch (error) {
        fail(error);
      }
    },
    inbound: async (fromPhone: string, text: string, providerCallId: string) => {
      const result = await backend.run(() => api.inbound(fromPhone, text, providerCallId));
      return `${result.reply} (${result.status})`;
    },
    ask: async (text: string) => {
      if (!state || !text.trim() || chatBusy) return;
      if (assistance && liveCase) { await sendCoordinatorMessage(liveCase.id, text); return; }
      const request = `${text}${mapContext}`;
      say("lead", request);
      setChatBusy(true);
      try {
        if (liveCase && liveCase.status !== "closed") {
          const result = await backend.run(() => api.caseInput(liveCase.id, request));
          say("facilitator", `Saved to case #${liveCase.id} as dispatcher input, not verified. ${result.reason}`);
        } else if (state.demo_mode.scripted) {
          say("facilitator", "This backend runs a scripted model, so it cannot read a free-text incident. Use Start → Wildfire drill.");
        } else {
          const result = await backend.run(() => api.incident({ text: request }));
          say("facilitator", `Opened incident #${result.incident_id}. ${result.reason}`);
        }
      } catch (error) {
        say("facilitator", error instanceof Error ? `Not saved: ${error.message}` : "Not saved.");
      } finally {
        setChatBusy(false);
      }
    },
  };

  const startWildfire = async () => {
    if (drillLock.current || !backend.connected) return;
    drillLock.current = true;
    setStartingDrill(true);
    try {
      const key = "rideout:wildfire-command";
      const pendingId = sessionStorage.getItem(key);
      const commandId = pendingId || crypto.randomUUID();
      sessionStorage.setItem(key, commandId);
      const result = await backend.run(() => api.wildfireDrill(commandId));
      sessionStorage.removeItem(key);
      sessionStorage.removeItem(key + ":simulation");
      setCaseId(result.support_case_id);
      setNotice(`Calls are queued for ${(state?.wildfire_demo?.names ?? [state?.wildfire_demo?.name ?? "Demo participant"]).join(", ")}. Open Outgoing calls to follow them.`);
      setTab("checks");
    } catch (error) {
      fail(error);
    } finally {
      drillLock.current = false;
      setStartingDrill(false);
    }
  };

  const exportLive = () => {
    if (!state) return;
    void downloadLog({
      place: ride.place,
      houses: liveHouses,
      calls: liveGraph,
      inbound: null,
      inboundLog: [],
      incident: { kind: liveCase?.kind === "information" ? "information" : latestIncident(state, true) ? "wildfire" : "missing_child", startedAt: 0, child: null, sightings: liveSightings, foundAt: null },
      chat: conversation,
      tasks: [],
      started: state.cases.length > 0 || state.incidents.length > 0,
      running: false,
      recordingFor: (id) => recordings.current.get(id) ?? null,
      backend: state,
    });
  };

  const exportOffline = () =>
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
    });

  return (
    <main className={`${tab === "checks" ? "stage checks-on" : "stage"}${scene === "nodes" ? " nodes-on" : ""}${simple ? " simple-on" : ""}${live && assistance ? " incident-map-on" : ""}`}>
      {live && assistance ? (tab === "map" ? <div className="incident-map-scene"><IncidentMap session={assistance} selectedId={liveSelected} onSelect={setLiveSelected} /></div> : null) : <NeighborhoodMap
        liveData={live}
        place={ride.place}
        houses={live ? liveHouses : ride.houses}
        onSelect={live ? setLiveSelected : ride.select}
        angle={scene === "aerial" ? "aerial" : "side"}
        simple={simple}
        showFire={live ? false : ride.incident.kind === "wildfire"}
        sightings={live ? liveSightings : ride.incident.sightings}
        selectedIds={highlightedIds}
        onSelectionChange={changeHighlights}
        drawMode={drawMode}
        onOpenGroupMenu={openGroupMenu}
      />}
      {tab === "map" && !(live && assistance) && highlightedIds.length > 0 && groupMenuPosition ? (
        <aside className="group-action" style={{ left: Math.max(8, Math.min(groupMenuPosition.x, window.innerWidth - 292)), top: Math.max(8, Math.min(groupMenuPosition.y, window.innerHeight - 190)) }} aria-label="Selected area actions">
          <div className="group-action-title"><span>Selected area</span><button type="button" aria-label="Close selected area menu" onClick={() => setGroupMenuPosition(null)}>×</button></div>
          <p><strong>{highlightedIds.length}</strong><span>Buildings</span></p>
          <p><strong>{selectedResidents.length}</strong><span>Registered residents</span></p>
          <button type="button" onClick={openCoordinatorForGroup}>Go to facilitator</button>
        </aside>
      ) : null}
      {scene === "nodes" && !(live && assistance) ? (
        live ? (
          <BlockGraph houses={state!.profiles.map(p => ({ id: p.id, name: p.name, lat: p.lat, lng: p.lng, status: "waiting", note: "Stored directory profile; current whereabouts unverified." }))} liveEdges={directoryEdges(state!, liveCase?.id ?? null)} calls={liveGraph} selectedId={liveSelected} onSelect={setLiveSelected} />
        ) : (
          <BlockGraph houses={ride.houses} calls={ride.calls} selectedId={selected?.id ?? null} onSelect={ride.select} />
        )
      ) : null}

      <header className="top">
        <div className="brand">
          {state && backend.connected ? (
            <button
              type="button"
              className={live ? "mode-pill live" : "mode-pill"}
              onClick={() => setPreferOffline((value) => !value)}
              title={live ? "Switch to the offline demo" : "Switch back to the live backend"}
            >
              {live ? `${backend.connected ? "Live" : "Disconnected"} · ${demoLabel(state)}` : "Offline demo · switch to live"}
            </button>
          ) : null}
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
          <div className="map-controls">
            <div className="view-toggle" role="group" aria-label="Map style">
              <button type="button" className={!simple && scene === "side" ? "on" : ""} aria-pressed={!simple && scene === "side"} onClick={() => { setSimple(false); setScene("side"); }}>Side</button>
              <button type="button" className={!simple && scene === "aerial" ? "on" : ""} aria-pressed={!simple && scene === "aerial"} onClick={() => { setSimple(false); setScene("aerial"); }}>Aerial</button>
              <button type="button" className={simple ? "on" : ""} aria-pressed={simple} onClick={() => setSimple(true)}>Simple</button>
              <button type="button" className={!simple && scene === "nodes" ? "on" : ""} aria-pressed={!simple && scene === "nodes"} onClick={() => { setSimple(false); setScene("nodes"); }}>Nodes</button>
            </div>
            <button type="button" className={drawMode === "rectangle" ? "map-tool-button on" : "map-tool-button"} aria-pressed={drawMode === "rectangle"} onClick={() => { setHighlightedIds([]); setGroupMenuPosition(null); setDrawMode((value) => value === "rectangle" ? null : "rectangle"); }} title="Drag a rectangle over buildings to highlight them">Rectangle</button>
            <button type="button" className={drawMode === "brush" ? "map-tool-button on" : "map-tool-button"} aria-pressed={drawMode === "brush"} onClick={() => { setHighlightedIds([]); setGroupMenuPosition(null); setDrawMode((value) => value === "brush" ? null : "brush"); }} title="Draw a loop around buildings to highlight them">Brush</button>
          </div>
          <time>{clock}</time>
          <button type="button" className="ghost" onClick={live ? exportLive : exportOffline}>
            Export log
          </button>
          <div className="start-menu">
            <button type="button" onClick={() => setMenu((open) => !open)} disabled={(!preferOffline && !backend.connected) || startingDrill || (!live && ride.running)} aria-expanded={menu}>
              {live ? "Start ▾" : ride.running ? "Live" : ride.started ? "New incident ▾" : "Start ▾"}
            </button>
            {menu && live && state ? (
              <div className="start-options" role="menu">
                <button
                  type="button"
                  role="menuitem"
                  disabled={!backend.connected || startingDrill}
                  onClick={() => {
                    setMenu(false);
                    if (!state.wildfire_demo?.ready) {
                      setNotice("No saved drill participant is available. Configure the private participant roster before starting.");
                      return;
                    }
                    void startWildfire();
                  }}
                >
                  <b>{startingDrill ? "Starting calls…" : "Wildfire drill"}</b>
                  <small>{state.wildfire_demo?.ready ? `${state.demo_mode.simulate ? "Drill calls for" : "Call"} ${(state.wildfire_demo.names ?? [state.wildfire_demo.name]).join(", ")}` : "Configure the private drill roster"}</small>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMenu(false);
                    setRegister(true);
                  }}
                >
                  <b>Register a neighbor</b>
                  <small>Add someone to the backend's directory</small>
                </button>
              </div>
            ) : null}
            {menu && !live && !ride.running ? (
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
              </div>
            ) : null}
          </div>
        </div>
      </header>

      {createPortal(<div className="notification-stack" aria-label="Notifications">
      {live && !backend.connected && <div className="live-notice" role="status"><p>Disconnected. Showing the last saved call state; reconnect before starting a call.</p></div>}
      {notice ? (
        <div className="live-notice" role="status">
          <p>{notice}</p>
          {retryChat && <button type="button" disabled={chatBusy || !backend.connected} onClick={() => void sendCoordinatorMessage(retryChat.caseId, retryChat.text)}>{chatBusy ? "Retrying…" : "Retry reply"}</button>}
          <button type="button" onClick={() => setNotice(null)}>
            Dismiss
          </button>
        </div>
      ) : null}
          {live && concern && !outside && dismissedConcern !== `${concern.attempt.id}:${concern.attempt.concern}` ? (
            <div className="handoff-banner" role="alert">
              <p>
                <b>{concern.person?.name ?? "A caller"} · review needed.</b> {concern.attempt.concern}
              </p>
              <button type="button" onClick={() => setDismissedConcern(`${concern.attempt.id}:${concern.attempt.concern}`)}>Dismiss</button>
            </div>
          ) : null}
          {!live && waiting && !ride.operator ? (
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
      </div>, document.body)}

      {live && state ? (
        <>
          {tab === "map" ? (
            <>
              {!assistance && <LiveStats state={state} caseId={liveCase?.id ?? 0} />}
              <aside className="right">
                <CaseCard
                  state={state}
                  chosenId={caseId}
                  now={now.getTime()}
                  onChoose={setCaseId}
                  onClose={(id) => {
                    void backend.run(() => api.closeCase(id)).catch(fail);
                  }}
                />
                {livePerson ? (
                  <article className="glass person">
                    <p className="kicker">{LIVE_STATUS[livePerson.status]}</p>
                    <h3>{livePerson.name}</h3>
                    <p>{`${assistance ? "Incident coordinates" : "Stored coordinates"}: ${livePerson.lat}, ${livePerson.lng}`}</p>
                    <p>{livePerson.note}</p>
                  </article>
                ) : null}
              </aside>
            </>
          ) : null}

          <LiveChecks
            visible={tab === "checks"}
            state={state}
            caseId={liveCase?.id ?? 0}
            houses={liveHouses}
            mockCalls={mockCalls}
            firstProfileId={liveDrill?.profile_id}
            chat={conversation}
            busy={chatBusy}
            operatorBusy={Boolean(outside) || coordinatorBusy || !backend.connected}
            now={now.getTime()}
            actions={liveActions}
            facilitatorRequest={facilitatorRequest}
          />


          {outside ? (
            <OperatorPanel
              key={outside.session.callId}
              session={outside.session}
              call={undefined}
              house={liveHouses.find((house) => house.id === outside.session.householdId)}
              now={now.getTime()}
              outside
              onSaid={() => {}}
              onHangUp={(outcome) => {
                if (outcome.audio) recordings.current.set(outside.session.callId, outcome.audio);
                const caseRef = outside.call.attempt.support_case_id;
                const text = outcome.note.trim();
                setOutside(null);
                if (text) {
                  void backend
                    .run(() => api.caseInput(caseRef, `Dispatcher called ${outside.session.name} outside RideOut: ${text}`))
                    .catch(fail);
                }
              }}
            />
          ) : null}

          {form ? <IntakeForm state={state} onSubmit={(body) => backend.run(() => api.intake(body))} onClose={() => setForm(false)} /> : null}
          {register ? <RegisterForm state={state} spots={spots} onRegister={(body) => backend.run(() => api.register(body))} onClose={() => setRegister(false)} /> : null}
        </>
      ) : (
        <>
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
                areaName={ride.place.name}
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
            facilitatorRequest={facilitatorRequest}
            onAsk={(text) => ride.ask(`${text}${mapContext}`)}
            onCall={{
              busy: Boolean(ride.operator),
              cancel: ride.cancelCall,
              takeOver: ride.takeOver,
              callDirect: ride.callDirect,
              listen: ride.listen,
              listeningId: ride.listeningId,
            }}
          />


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
        </>
      )}
    </main>
  );
}
