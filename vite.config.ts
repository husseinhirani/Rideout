import { defineConfig, loadEnv, type Plugin, type ProxyOptions } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, process.cwd(), ""), ...process.env };
  const target = env.BACKEND_URL || "http://127.0.0.1:8787";
  const secret = (env.OPERATOR_SECRET ?? "").trim();
  const paths = /^\/(state|profiles|incidents|drills\/wildfire|intake-configuration|cases\/\d+\/(configuration|calls|input|close)|incoming-requests\/\d+\/review|attempts\/\d+\/(cancel|retry-interpretation|audio|transcript)|simulation\/(report|incoming))$/;
  const hosts = new Set(["127.0.0.1:5173", "localhost:5173"]);
  const loopback = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);
  const guard: Plugin = {
    name: "local-operator-access",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = new URL(req.url ?? "/", "http://localhost").pathname;
        if (!paths.test(path)) return next();
        const host = req.headers.host ?? "";
        const sameOrigin = req.headers.origin === `http://${host}`;
        if (!loopback.has(req.socket.remoteAddress ?? "") || !hosts.has(host)
          || Object.keys(req.headers).some(name => name === "forwarded" || name.startsWith("x-forwarded-"))
          || (req.headers["sec-fetch-site"] !== undefined && !["same-origin", "none"].includes(String(req.headers["sec-fetch-site"])))
          || (req.headers.origin !== undefined && !sameOrigin)
          || (req.method !== "GET" && !sameOrigin)) {
          res.writeHead(403, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Use the local operator UI origin." }));
          return;
        }
        if (!secret) {
          res.writeHead(503, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Configure OPERATOR_SECRET on the UI server." }));
          return;
        }
        next();
      });
    },
  };
  const route: ProxyOptions = {
    target,
    configure(proxy) {
      proxy.on("proxyReq", (request) => request.setHeader("Authorization", `Bearer ${secret}`));
    },
  };
  return {
    plugins: [react(), guard],
    server: { host: "127.0.0.1", port: 5173, strictPort: true, proxy: { [paths.source.slice(0, -1) + "(?:\\?.*)?$"]: route } },
  };
});
