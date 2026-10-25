import { useEffect, useRef, useState } from "react";
import { Icon } from "./Dashboard";

/** Plays only provider audio. Polling tolerates delayed/growing recordings; no synthesized stand-in. */
export function CallAudio({ attemptId, ended, disabled }: { attemptId: number; ended: boolean; disabled: boolean }) {
  const [listening, setListening] = useState(false);
  const [message, setMessage] = useState("");
  const cleanup = useRef<(() => void) | null>(null);
  const finished = useRef(ended);
  finished.current = ended;
  useEffect(() => () => cleanup.current?.(), [attemptId]);
  useEffect(() => { if (disabled) { cleanup.current?.(); setListening(false); } }, [disabled]);

  const toggle = async () => {
    if (cleanup.current) {
      cleanup.current(); cleanup.current = null;
      setListening(false); setMessage("Muted on this device. The phone call continues.");
      return;
    }
    const context = new AudioContext();
    const controller = new AbortController();
    let stopped = false, timer = 0, playedFrames = 0, nextAt = 0;
    const sources = new Set<AudioBufferSourceNode>();
    const stop = () => {
      if (stopped) return;
      stopped = true; controller.abort(); window.clearTimeout(timer);
      for (const source of sources) source.stop();
      sources.clear(); void context.close();
    };
    cleanup.current = stop;
    setListening(true); setMessage("Requesting call audio…");
    try { await context.resume(); } catch {
      stop(); cleanup.current = null; setListening(false); setMessage("Your browser could not start audio playback."); return;
    }
    const poll = async () => {
      try {
        const response = await fetch(`/attempts/${attemptId}/audio`, { signal: controller.signal, cache: "no-store" });
        if (stopped) return;
        if (response.status === 202) {
          setMessage("Waiting for provider audio. The recording may only become available after the call ends.");
        } else if (!response.ok) {
          const result = await response.json(); throw new Error(result.error || "Call audio is unavailable.");
        } else {
          const buffer = await context.decodeAudioData(await response.arrayBuffer());
          if (stopped) return;
          if (buffer.length > playedFrames) {
            const tail = context.createBuffer(buffer.numberOfChannels, buffer.length - playedFrames, buffer.sampleRate);
            for (let channel = 0; channel < buffer.numberOfChannels; channel++) tail.copyToChannel(buffer.getChannelData(channel).subarray(playedFrames), channel);
            const source = context.createBufferSource(); source.buffer = tail; source.connect(context.destination);
            sources.add(source); source.onended = () => sources.delete(source);
            nextAt = Math.max(context.currentTime, nextAt); source.start(nextAt); nextAt += tail.duration;
            playedFrames = buffer.length;
            setMessage(finished.current ? "Playing the actual call recording." : "Playing provider audio with a delay.");
          }
          if (finished.current) {
            timer = window.setTimeout(() => { stop(); cleanup.current = null; setListening(false); setMessage("Playback finished."); }, Math.max(0, nextAt - context.currentTime) * 1000 + 100);
            return;
          }
        }
        timer = window.setTimeout(() => void poll(), 3000);
      } catch (error) {
        if (stopped) return;
        stop(); cleanup.current = null; setListening(false);
        setMessage(error instanceof Error ? error.message : "Call audio is unavailable.");
      }
    };
    void poll();
  };
  return <div className="call-audio-control">
    <div className="call-actions"><button type="button" className={listening ? "on" : ""} disabled={disabled} onClick={() => void toggle()}>
      <Icon name={listening ? "mute" : "sound"} />{listening ? "Mute" : ended ? "Listen to recording" : "Listen · delayed audio"}
    </button></div>
    {message && <p className="focus-note" role="status">{message}</p>}
  </div>;
}
