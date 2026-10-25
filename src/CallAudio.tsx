import { useEffect, useRef, useState } from "react";
import { Icon } from "./Dashboard";
import { readCallMedia } from "./call-media";

/** Mounted only for ended calls. The API also enforces that restriction. */
export function CallAudio({ attemptId }: { attemptId: number }) {
  const [listening, setListening] = useState(false);
  const [message, setMessage] = useState("");
  const cleanup = useRef<(() => void) | null>(null);
  useEffect(() => () => cleanup.current?.(), [attemptId]);

  const toggle = async () => {
    if (cleanup.current) {
      cleanup.current(); cleanup.current = null;
      setListening(false); setMessage("Playback stopped."); return;
    }
    const context = new AudioContext();
    const controller = new AbortController();
    let stopped = false, timer = 0;
    const started = Date.now();
    let source: AudioBufferSourceNode | null = null;
    const stop = () => {
      if (stopped) return;
      stopped = true; controller.abort(); window.clearTimeout(timer);
      source?.stop(); void context.close();
    };
    cleanup.current = stop;
    setListening(true); setMessage("Loading call recording…");
    try { await context.resume(); } catch {
      stop(); cleanup.current = null; setListening(false); setMessage("Your browser could not start playback."); return;
    }
    const poll = async () => {
      try {
        const audio = await readCallMedia(`/attempts/${attemptId}/audio`, controller.signal, async response => {
          if (response.status === 202) return null;
          if (!response.headers.get("content-type")?.startsWith("audio/")) throw new Error("RideOut did not return a recording. Refresh the page and try again.");
          return response.arrayBuffer();
        }, () => setMessage("Recording connection interrupted. Reconnecting…"));
        if (stopped) return;
        if (!audio) {
          if (Date.now() - started > 120000) throw new Error("The recording is still being prepared. Try again shortly.");
          setMessage("The provider is preparing the recording…");
          timer = window.setTimeout(() => void poll(), 3000); return;
        }
        const buffer = await context.decodeAudioData(audio);
        if (stopped) return;
        source = context.createBufferSource(); source.buffer = buffer; source.connect(context.destination);
        source.onended = () => {
          if (stopped) return;
          stop(); cleanup.current = null; setListening(false); setMessage("Playback finished.");
        };
        source.start(); setMessage("Playing the call recording.");
      } catch (error) {
        if (stopped) return;
        stop(); cleanup.current = null; setListening(false);
        setMessage(error instanceof Error ? error.message : "Recording is unavailable.");
      }
    };
    void poll();
  };
  return <div className="call-audio-control">
    <div className="call-actions"><button type="button" className={listening ? "on" : ""} onClick={() => void toggle()}>
      <Icon name={listening ? "mute" : "sound"} />{listening ? "Stop playback" : "Listen to recording"}
    </button></div>
    {message && <p className="focus-note" role="status">{message}</p>}
  </div>;
}
