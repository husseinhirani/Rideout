class MediaRequestError extends Error {
  constructor(message: string, readonly retryable: boolean) { super(message); }
}

/** Retry interrupted reads only. This never places a call or changes its state. */
export async function readCallMedia<T>(
  path: string,
  signal: AbortSignal,
  decode: (response: Response) => Promise<T>,
  onRetry: () => void,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    signal.throwIfAborted();
    try {
      const response = await fetch(path, {
        signal: AbortSignal.any([signal, AbortSignal.timeout(50000)]), cache: "no-store",
      });
      if (!response.ok) {
        const body = await response.text();
        let message = "";
        try { message = JSON.parse(body).error ?? ""; } catch { /* A disconnected proxy can return plain text. */ }
        throw new MediaRequestError(message || (response.status >= 500
          ? "RideOut could not load the call. Check the connection and try again."
          : `The call could not be loaded (${response.status}).`), [500, 502, 503, 504].includes(response.status));
      }
      return await decode(response);
    } catch (error) {
      signal.throwIfAborted();
      const interrupted = error instanceof TypeError || (error instanceof DOMException && error.name === "TimeoutError");
      const retryable = interrupted || (error instanceof MediaRequestError && error.retryable);
      if (!retryable || attempt >= 2) {
        if (interrupted) throw new Error("Connection to RideOut was interrupted. Check the connection and try again.");
        throw error;
      }
      onRetry();
      await new Promise<void>((resolve, reject) => {
        const abort = () => { window.clearTimeout(timer); reject(signal.reason); };
        const timer = window.setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, 1500 * (attempt + 1));
        signal.addEventListener("abort", abort, { once: true });
      });
    }
  }
}
