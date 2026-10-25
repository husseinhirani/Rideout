import { useEffect, useRef, useState } from "react";
import { Icon } from "./Dashboard";

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
        const response = await fetch(`/attempts/${attemptId}/audio`, { signal: controller.signal, cache: "no-store" });
        if (stopped) return;
        if (response.status === 202) {
          setMessage("The provider is preparing the recording…");
          timer = window.setTimeout(() => void poll(), 3000); return;
        }
        if (!response.ok) {
          const data = await response.json(); throw new Error(data.error || "Recording is unavailable.");
        }
        const buffer = await context.decodeAudioData(await response.arrayBuffer());
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
