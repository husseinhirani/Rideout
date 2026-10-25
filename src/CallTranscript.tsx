import { useEffect, useState } from "react";
import { mmss, Timeline } from "./Dashboard";

type Turn = { id: string; role: "assistant" | "user"; text: string; start: number; interrupted: boolean };

export function CallTranscript({ attemptId, name, ended }: { attemptId: number; name: string; ended: boolean }) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [message, setMessage] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    let timer = 0;
    const poll = async () => {
      try {
        const response = await fetch(`/attempts/${attemptId}/transcript`, { signal: controller.signal, cache: "no-store" });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Conversation is temporarily unavailable.");
        if (controller.signal.aborted) return;
        setTurns(data.turns);
        setMessage(data.turns.length ? (data.saved ? "Saved conversation" : "Conversation updates as each person finishes speaking.")
          : ended ? "Waiting for the provider to save the conversation…" : "Waiting for the first spoken turn…");
        if (data.saved) return;
      } catch (error) {
        if (controller.signal.aborted) return;
        setMessage(error instanceof Error ? error.message : "Conversation is temporarily unavailable.");
      }
      timer = window.setTimeout(() => void poll(), ended ? 5000 : 2000);
    };
    void poll();
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [attemptId, ended]);
  return <div className="call-transcript">
    <p className="focus-note" role="status">{message}</p>
    <Timeline lines={turns.map(turn => ({
      at: mmss(Math.floor(turn.start)), who: turn.role === "assistant" ? "Agent" : name,
      text: turn.text + (turn.interrupted ? " (interrupted)" : ""),
      kind: turn.role === "assistant" ? "you" : "them",
    }))} />
  </div>;
}
