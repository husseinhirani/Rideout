import { useCallback, useEffect, useRef, useState } from "react";
import { api, type BackendState } from "./api";

export function useBackend(enabled = true) {
  const [state, setState] = useState<BackendState | null>(null);
  const [connected, setConnected] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);
  const online = useRef(false);
  const inFlight = useRef<Promise<void> | null>(null);
  const refresh = useCallback(() => {
    if (inFlight.current) return inFlight.current;
    const request = (async () => {
      try {
        const next = await api.state();
        if (next.read_model_version !== 2) throw new Error("This UI requires the generic backend (read model 2).");
        if (!alive.current) return;
        setState(next);
        setConnected(true);
        online.current = true;
        setUpdatedAt(Date.now());
        setError(null);
      } catch (problem) {
        if (!alive.current) return;
        setConnected(false);
        online.current = false;
        setError(problem instanceof Error ? problem.message : "Backend unavailable");
      }
    })();
    inFlight.current = request;
    void request.finally(() => { inFlight.current = null; });
    return request;
  }, []);

  useEffect(() => {
    alive.current = true;
    if (!enabled) { online.current = false; setConnected(false); return; }
    let stopped = false;
    let timer = 0;
    const loop = async () => {
      await refresh();
      if (!stopped) timer = window.setTimeout(loop, 1000);
    };
    void loop();
    return () => { stopped = true; alive.current = false; window.clearTimeout(timer); };
  }, [enabled, refresh]);

  const run = useCallback(async <T,>(work: () => Promise<T>): Promise<T> => {
    if (!online.current) throw new Error("Disconnected. Reconnect before changing the investigation.");
    try { return await work(); }
    finally {
      // Finish any older poll, then read the state after the mutation.
      if (inFlight.current) await inFlight.current;
      await refresh();
    }
  }, [refresh]);
  return { state, connected, error, updatedAt, run, refresh };
}

export function eventKey(): string { return crypto.randomUUID(); }
export type RunAction = ReturnType<typeof useBackend>["run"];
