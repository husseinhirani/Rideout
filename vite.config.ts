import { defineConfig, loadEnv, type ProxyOptions } from "vite";
import react from "@vitejs/plugin-react";

// The backend serves same-origin routes with no CORS, so the dev server proxies them.
// BACKEND_URL picks the backend (8787 by default; the recording runs use their own port).
// The callback routes need CALLBACK_SECRET when the backend sets one. The proxy adds it
// here, on the dev server, so the secret never reaches the browser bundle, and only for
// requests from this machine, because the dev server also listens on the network.
export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, process.cwd(), ""), ...process.env };
  const target = env.BACKEND_URL || "http://127.0.0.1:8787";
  const secret = (env.CALLBACK_SECRET ?? "").trim();
  const loopback = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);
  const route = (callback: boolean): ProxyOptions => ({
    target,
    configure: (proxy) => {
      if (!callback || !secret) return;
      proxy.on("proxyReq", (request, incoming) => {
        if (loopback.has(incoming.socket.remoteAddress ?? "")) request.setHeader("Authorization", `Bearer ${secret}`);
      });
    },
  });
  return {
    plugins: [react()],
    server: {
      port: 5173,
      host: true,
      proxy: {
        "^/state$": route(false),
        "^/(incidents|intake|profiles)$": route(false),
        "^/cases(/\\d+/(input|close))?$": route(false),
        "^/attempts/\\d+/cancel$": route(false),
        "^/(calls/report|check-ins|requests)$": route(true),
      },
    },
  };
});
