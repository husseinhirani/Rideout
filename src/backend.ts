import { useCallback, useEffect, useRef, useState } from "react";
import { api, type BackendState } from "./api";

const POLL_MS = 1000;

/**
 * Polls GET /state once a second. The backend owns every case, call and report;
 * this hook only mirrors the latest snapshot and refreshes right after an action.
 */
export function useBackend() {
  const [state, setState] = useState<BackendState | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);

  const refresh = useCallback(async () => {
    try {
      const next = await api.state();
      if (!alive.current) return;
      setState(next);
      setConnected(true);
      setError(null);
    } catch (problem) {
      if (!alive.current) return;
      setConnected(false);
      setError(problem instanceof Error ? problem.message : "Backend unavailable");
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    let timer = 0;
    const loop = async () => {
      await refresh();
      if (alive.current) timer = window.setTimeout(loop, POLL_MS);
    };
    void loop();
    return () => {
      alive.current = false;
      window.clearTimeout(timer);
    };
  }, [refresh]);

  /** Runs one backend action, then refreshes so the result shows without waiting for the next poll. */
  const run = useCallback(
    async <T,>(work: () => Promise<T>): Promise<T> => {
      try {
        return await work();
      } finally {
        void refresh();
      }
    },
    [refresh],
  );

  return { state, connected, error, run };
}

export function eventKey(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `form-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
