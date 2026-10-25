import { useEffect, useRef, useState } from "react";
import type { Device, Call } from "@twilio/voice-sdk";
import { api, type DispatcherCallRow } from "./api";

type Line = { key: string; speaker: string; text: string };

export function DispatcherCallModal({ caseId, profileId, name, logs, existingId, onClose, onSaved }: {
  caseId: number;
  profileId: number;
  name: string;
  logs: DispatcherCallRow[];
  existingId?: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [callId, setCallId] = useState<string | null>(existingId ?? null);
  const log = logs.find(row => row.id === callId);
  const [status, setStatus] = useState("Ready to call");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [saved, setSaved] = useState(false);
  const device = useRef<Device | null>(null);
  const connection = useRef<Call | null>(null);
  const connected = useRef(false);
  const ended = useRef(false);

  useEffect(() => () => {
    connection.current?.disconnect();
    device.current?.destroy();
  }, []);

  const start = async () => {
    if (busy || callId) return;
    setBusy(true);
    setStatus("Requesting microphone and call…");
    let opened: string | null = null;
    try {
      if (!window.isSecureContext) throw new Error("Browser calling requires HTTPS or localhost.");
      const result = await api.dispatcherCall(caseId, profileId);
      opened = result.id;
      setCallId(result.id);
      const { Device } = await import("@twilio/voice-sdk");
      const voice = new Device(result.token);
      device.current = voice;
      setStatus("Dialing…");
      const active = await voice.connect({ params: { call_id: result.id } });
      connection.current = active;
      active.on("accept", () => { connected.current = true; setStatus("On the line"); });
      active.on("disconnect", () => { ended.current = true; setStatus("Call ended"); });
      active.on("cancel", () => { ended.current = true; setStatus("Call canceled"); });
      active.on("reject", () => { ended.current = true; setStatus("Call declined"); });
      active.on("error", (error) => setStatus(error.message));
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not start call");
      ended.current = true;
      if (opened && !connected.current) void api.cancelDispatcherCall(opened).catch(() => {});
      setCallId(null);
      device.current?.destroy();
      device.current = null;
    } finally {
      setBusy(false);
    }
  };

  const hangUp = () => {
    connection.current?.disconnect();
    ended.current = true;
    setStatus("Call ended");
  };

  const save = async () => {
    if (!note.trim()) return;
    setBusy(true);
    try {
      await api.caseInput(caseId, `Dispatcher called ${name}: ${note.trim()}`);
      setSaved(true);
      onSaved();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not save note");
    } finally {
      setBusy(false);
    }
  };

  let lines: Line[] = [];
  try { lines = JSON.parse(log?.transcript ?? "[]") as Line[]; } catch { /* preserve call controls */ }
  const over = Boolean(existingId) || ended.current || Boolean(log?.ended_at);

  return (
    <div className="dispatcher-call-backdrop" role="presentation">
      <section className="dispatcher-call-modal" role="dialog" aria-modal="true" aria-label={`Call ${name}`}>
        <header>
          <div><small>Case #{caseId} · Dispatcher call</small><h2>{name}</h2></div>
          <button type="button" disabled={busy} onClick={() => { if (!over && callId) hangUp(); onClose(); }} aria-label="Close call">×</button>
        </header>
        <p className="dispatcher-call-status" role="status">{existingId || log?.ended_at ? `Call ${log?.status ?? "loading"}` : status}</p>
        <p className="dispatcher-call-hint">{existingId ? "This call log and coordinator guidance are visible only to the dispatcher." : "Your microphone connects through the browser. The person answers on their phone. The coordinator's text is visible only here."}</p>
        {!callId ? <button type="button" className="hot" disabled={busy} onClick={() => void start()}>Start call</button> : !over && !existingId ? <button type="button" onClick={hangUp}>Hang up</button> : null}
        <div className="dispatcher-call-guidance">
          <h3>Coordinator guidance</h3>
          <p>{log?.guidance || (callId && !over ? "Listening for the conversation…" : "Guidance will appear during the call.")}</p>
        </div>
        <div className="dispatcher-call-transcript" aria-live="polite">
          <h3>Live transcript</h3>
          {lines.length ? lines.map(line => <p key={line.key}><b>{line.speaker === "dispatcher" ? "You" : name}:</b> {line.text}</p>) : <p>No transcript yet.</p>}
        </div>
        {over && !existingId ? <div className="dispatcher-call-note">
          <label htmlFor="dispatcher-call-note">Your case note</label>
          <textarea id="dispatcher-call-note" value={note} onChange={event => setNote(event.target.value)} placeholder="What did they tell you? Mark unverified details as reported." disabled={saved} />
          <button type="button" onClick={() => void save()} disabled={busy || saved || !note.trim()}>{saved ? "Saved to case" : "Save note to case"}</button>
        </div> : null}
      </section>
    </div>
  );
}
