import { useEffect, useRef, useState } from "react";
import { householdFor } from "./households";
import type { CallCard, House, HouseStatus, OperatorOutcome, OperatorSession } from "./types";

/**
 * The lead on the line: a direct call, a take-over from the AI, or a call the AI handed over.
 * The browser records the lead's microphone and transcribes it. Tomorrow the line itself runs
 * through the Twilio Voice SDK, and Twilio records both sides of the call.
 */

type Props = {
  session: OperatorSession;
  call: CallCard | undefined;
  house: House | undefined;
  now: number;
  onSaid: (text: string) => void;
  onHangUp: (outcome: OperatorOutcome) => void;
  // Live mode: the dispatcher phones the person themselves. RideOut is not on that line.
  outside?: boolean;
};

type Mic = "starting" | "recording" | "blocked";

type Recognition = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};

const OUTCOMES: { status: HouseStatus | null; label: string }[] = [
  { status: "out", label: "Out" },
  { status: "needs_ride", label: "Needs a ride" },
  { status: "unknown", label: "Could not confirm" },
  { status: null, label: "Keep status" },
];

export function OperatorPanel({ session, call, house, now, onSaid, onHangUp, outside = false }: Props) {
  const [mic, setMic] = useState<Mic>("starting");
  const [heard, setHeard] = useState("");
  const [note, setNote] = useState("");
  const [status, setStatus] = useState<HouseStatus | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const stream = useRef<MediaStream | null>(null);
  const recognition = useRef<Recognition | null>(null);
  const open = useRef(true);
  const said = useRef(onSaid);
  said.current = onSaid;

  useEffect(() => {
    open.current = true;
    navigator.mediaDevices
      ?.getUserMedia({ audio: true })
      .then((media) => {
        if (!open.current) {
          media.getTracks().forEach((track) => track.stop());
          return;
        }
        stream.current = media;
        const rec = new MediaRecorder(media);
        rec.ondataavailable = (event) => {
          if (event.data.size) chunks.current.push(event.data);
        };
        rec.start(1000);
        recorder.current = rec;
        setMic("recording");
      })
      .catch(() => setMic("blocked"));

    const Speech =
      (window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition }).SpeechRecognition ??
      (window as unknown as { webkitSpeechRecognition?: new () => Recognition }).webkitSpeechRecognition;
    if (Speech) {
      const listener = new Speech();
      listener.continuous = true;
      listener.interimResults = true;
      listener.lang = "en-US";
      listener.onresult = (event) => {
        let interim = "";
        for (let i = event.resultIndex; i < event.results.length; i += 1) {
          const result = event.results[i];
          if (result.isFinal) said.current(result[0].transcript);
          else interim += result[0].transcript;
        }
        setHeard(interim);
      };
      // Chrome stops listening after a pause; keep it going while the call is open.
      listener.onend = () => {
        if (open.current) {
          try {
            listener.start();
          } catch {
            /* already restarting */
          }
        }
      };
      try {
        listener.start();
        recognition.current = listener;
      } catch {
        recognition.current = null;
      }
    }

    return () => {
      open.current = false;
      recognition.current?.stop();
      if (recorder.current?.state === "recording") recorder.current.stop();
      stream.current?.getTracks().forEach((track) => track.stop());
    };
  }, [session.callId]);

  const hangUp = () => {
    open.current = false;
    recognition.current?.stop();
    const durationMs = Date.now() - session.startedAt;
    const finish = (audio: Blob | null) => {
      stream.current?.getTracks().forEach((track) => track.stop());
      onHangUp({ status, note, audio, durationMs });
    };
    const rec = recorder.current;
    if (rec && rec.state === "recording") {
      rec.onstop = () => finish(chunks.current.length ? new Blob(chunks.current, { type: rec.mimeType || "audio/webm" }) : null);
      rec.stop();
    } else {
      finish(null);
    }
  };

  const home = session.householdId !== null ? householdFor(session.householdId, house?.name) : null;
  const elapsed = Math.max(0, Math.round((now - session.startedAt) / 1000));
  const clock = `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, "0")}`;
  const lead = outside
    ? "You are calling them yourself, outside RideOut. Your note is saved to the case as dispatcher input."
    : session.mode === "escalation"
      ? `The AI handed this call to you. ${call?.escalation?.reason ?? ""}`
      : session.mode === "takeover"
        ? "You took over from the AI."
        : "You called directly.";
  const residentLines = (call?.segments ?? []).filter((part) => part.speaker !== "system").slice(-4);

  return (
    <aside className="operator-panel" aria-label={`On the line with ${session.name}`}>
      <div className="operator-head">
        <p className="kicker hot">
          <i className="rec-dot" /> On the line · {clock}
        </p>
        <span className={`mic ${mic}`}>{mic === "recording" ? "Recording" : mic === "starting" ? "Starting mic…" : "Mic blocked · notes only"}</span>
      </div>
      <h3>{session.name}</h3>
      {home ? (
        <p className="operator-meta">
          {home.address} · {home.people} {home.people === 1 ? "person" : "people"} · {home.vehicles.length ? home.vehicles.join(", ") : "No vehicle"}
          {home.needs ? ` · ${home.needs}` : ""}
        </p>
      ) : null}
      <p className="operator-lead">{lead}</p>
      {residentLines.length ? (
        <div className="operator-said">
          {residentLines.map((part, index) => (
            <p key={`${part.at}-${index}`}>
              <b>{part.speaker === "operator" ? "You" : session.name.split(" ")[0]}:</b> {part.text}
            </p>
          ))}
        </div>
      ) : null}
      {heard ? <p className="operator-heard">You: {heard}…</p> : null}
      <p className="operator-hint">
        {outside
          ? "Only your side is recorded, in this browser, for the export. It is not transferred to the phone call or the backend."
          : "Demo: only your side is live. With Twilio, both sides are recorded."}
      </p>
      <div className="operator-outcomes" role="group" aria-label="Outcome" hidden={outside}>
        {OUTCOMES.map((option) => (
          <button
            key={option.label}
            type="button"
            className={status === option.status ? "on" : ""}
            aria-pressed={status === option.status}
            onClick={() => setStatus(option.status)}
          >
            {option.label}
          </button>
        ))}
      </div>
      <textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="Note for the log (what they need, who is going)" rows={2} />
      <button type="button" className="hang-up" onClick={hangUp}>
        Hang up and save
      </button>
    </aside>
  );
}
