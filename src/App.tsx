import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "./api";
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
import { OperatorPanel } from "./OperatorPanel";
import { RegisterForm } from "./RegisterForm";
import { downloadLog } from "./exportLog";
import { householdFor } from "./households";
import { assignHouses, footprints, GEO, useRideOut } from "./telemetry";
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
  const [now, setNow] = useState(() => new Date());
  const [menu, setMenu] = useState(false);
  const [form, setForm] = useState(false);
  const [register, setRegister] = useState(false);
  const [caseId, setCaseId] = useState<number | null>(null);
  const [liveChat, setLiveChat] = useState<ChatMessage[]>([]);
  const [chatBusy, setChatBusy] = useState(false);
  const [liveSelected, setLiveSelected] = useState<number | null>(null);
  const [outside, setOutside] = useState<{ session: OperatorSession; call: LiveCall } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const recordings = useRef(new Map<string, Blob>());
  const waiting = ride.calls.find((call) => call.phase === "holding");
  const child = ride.incident.kind === "missing_child" ? ride.incident.child : null;
  const selected = ride.selected;
  const clock = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const state = backend.state;
  const live = Boolean(backend.connected && state && !preferOffline);

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
  const liveHouses = useMemo(() => (state ? housesFrom(state, residents, spots, GEO) : []), [state, residents, spots]);
  const liveCalls = useMemo(() => (state ? callsFor(state, liveCase?.id ?? null) : []), [state, liveCase?.id]);
  const liveSightings = useMemo(() => (state ? sightingsFrom(state, liveCase?.id ?? null) : []), [state, liveCase?.id]);
  const liveGraph = useMemo(() => graphCalls(liveCalls, liveHouses), [liveCalls, liveHouses]);
  const livePerson = liveHouses.find((house) => house.id === liveSelected) ?? null;
  const concern = live ? liveCalls.find((call) => call.attempt.concern && call.transport !== "ended" && call.transport !== "cancelled") : undefined;

  // A newly opened case takes over the view; choosing one by hand holds until the next opens.
  const newestCase = state?.cases.reduce((max, row) => Math.max(max, row.id), 0) ?? 0;
  useEffect(() => {
    setCaseId(null);
  }, [newestCase]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const say = (from: ChatMessage["from"], text: string) =>
    setLiveChat((current) => [...current, { id: `${from}-${Date.now()}-${current.length}`, from, text, at: Date.now() }]);

  const fail = (error: unknown) => setNotice(error instanceof Error ? error.message : "The backend refused that");

  const liveActions = {
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
      if (!state) return;
      say("lead", text);
      setChatBusy(true);
      try {
        if (liveCase && liveCase.status !== "closed") {
          const result = await backend.run(() => api.caseInput(liveCase.id, text));
          say("facilitator", `Saved to case #${liveCase.id} as dispatcher input, not verified. ${result.reason}`);
        } else if (state.demo_mode.scripted) {
          say("facilitator", "This backend runs a scripted model, so it cannot read a free-text incident. Use Start → Missing child.");
        } else {
          const result = await backend.run(() => api.incident({ text }));
          say("facilitator", `Opened incident #${result.incident_id}${result.case_ids.length ? ` with case ${result.case_ids.map((id) => `#${id}`).join(", ")}` : ""}. Check-in calls go to everyone in range.`);
        }
      } catch (error) {
        say("facilitator", error instanceof Error ? `Not saved: ${error.message}` : "Not saved.");
      } finally {
        setChatBusy(false);
      }
    },
  };

  const startWildfire = async () => {
    try {
      const radius_m = 400;
      const result = await backend.run(() =>
        api.incident({ type: "wildfire evacuation drill", lat: (GEO.south + GEO.north) / 2, lng: (GEO.west + GEO.east) / 2, radius_m }),
      );
      setNotice(`Wildfire incident #${result.incident_id} opened. Check-in calls go to every registered neighbor within ${radius_m} m.`);
      setTab("checks");
    } catch (error) {
      fail(error);
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
      incident: { kind: latestIncident(state, true) ? "wildfire" : "missing_child", startedAt: 0, child: null, sightings: liveSightings, foundAt: null },
      chat: liveChat,
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
    <main className={`${tab === "checks" ? "stage checks-on" : "stage"}${scene === "nodes" ? " nodes-on" : ""}`}>
      <NeighborhoodMap
        place={ride.place}
        houses={live ? liveHouses : ride.houses}
        onSelect={live ? setLiveSelected : ride.select}
        angle={scene === "aerial" ? "aerial" : "side"}
        showFire={live ? false : ride.incident.kind === "wildfire"}
        sightings={live ? liveSightings : ride.incident.sightings}
      />
      {scene === "nodes" ? (
        live ? (
          <BlockGraph houses={liveHouses} calls={liveGraph} selectedId={liveSelected} onSelect={setLiveSelected} />
        ) : (
          <BlockGraph houses={ride.houses} calls={ride.calls} selectedId={selected?.id ?? null} onSelect={ride.select} />
        )
      ) : null}

      <header className="top">
        <div className="brand">
          <strong>RideOut</strong>
          {state && backend.connected ? (
            <button
              type="button"
              className={live ? "mode-pill live" : "mode-pill"}
              onClick={() => setPreferOffline((value) => !value)}
              title={live ? "Switch to the offline demo" : "Switch back to the live backend"}
            >
              {live ? `Live · ${demoLabel(state)}` : "Offline demo · switch to live"}
            </button>
          ) : (
            <span className="mode-pill offline" title={backend.error ?? undefined}>
              Offline demo · not connected
            </span>
          )}
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
          <button type="button" className="ghost" onClick={live ? exportLive : exportOffline}>
            Export log
          </button>
          <div className="start-menu">
            <button type="button" onClick={() => setMenu((open) => !open)} disabled={!live && ride.running} aria-expanded={menu}>
              {live ? "Start ▾" : ride.running ? "Live" : ride.started ? "New incident ▾" : "Start ▾"}
            </button>
            {menu && live && state ? (
              <div className="start-options" role="menu">
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMenu(false);
                    void startWildfire();
                  }}
                >
                  <b>Wildfire drill</b>
                  <small>{state.demo_mode.simulate ? "Simulated check-in calls to every registered neighbor" : "Places real check-in calls to every registered neighbor"}</small>
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
                  <small>Open a case; the backend calls the two helpers</small>
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

      {notice ? (
        <div className="live-notice" role="status">
          <p>{notice}</p>
          <button type="button" onClick={() => setNotice(null)}>
            Dismiss
          </button>
        </div>
      ) : null}

      {live && state ? (
        <>
          {tab === "map" ? (
            <>
              <LiveStats state={state} caseId={liveCase?.id ?? null} />
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
                    <p>{householdFor(livePerson.id, livePerson.name).address}</p>
                    <p>{livePerson.note}</p>
                  </article>
                ) : null}
              </aside>
            </>
          ) : null}

          <LiveChecks
            visible={tab === "checks"}
            state={state}
            caseId={liveCase?.id ?? null}
            houses={liveHouses}
            chat={liveChat}
            busy={chatBusy}
            operatorBusy={Boolean(outside)}
            now={now.getTime()}
            actions={liveActions}
          />

          {concern && !outside ? (
            <div className="handoff-banner" role="alert">
              <p>
                <b>{concern.person?.name ?? "A helper"} raised a concern.</b> {concern.attempt.concern}
              </p>
              <button type="button" className="pick-up" onClick={() => liveActions.callYourself(concern)}>
                Call them yourself
              </button>
            </div>
          ) : null}

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
        </>
      )}
    </main>
  );
}
