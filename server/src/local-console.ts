import { readFileSync } from "node:fs"
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http"
import { ServiceError } from "./service"

type ConsoleOptions = {
  port: number
  apiPort: number
  operatorSecret: string
  htmlPath: string
}

const BODY_LIMIT = 1_000_000

/** Local-only browser surface. The caller must listen on 127.0.0.1, never the tunnel interface. */
export function createLocalConsole(options: ConsoleOptions): Server {
  for (const port of [options.port, options.apiPort]) {
    if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error("Console and API ports must be valid")
  }
  if (options.port === options.apiPort) throw new Error("Console and API require separate ports")
  if (!options.operatorSecret.trim()) throw new Error("The local console requires OPERATOR_SECRET")
  const hosts = new Set(["127.0.0.1:" + options.port, "localhost:" + options.port])
  return createServer((req, res) => {
    handle(req, res, options, hosts).catch((error: unknown) => {
      if (res.headersSent || res.writableEnded) return
      const status = error instanceof ServiceError ? error.status : 502
      send(res, status, { error: error instanceof ServiceError ? error.message : "Backend is unavailable" })
    })
  })
}

async function handle(req: IncomingMessage, res: ServerResponse, options: ConsoleOptions, hosts: Set<string>): Promise<void> {
  const host = req.headers.host ?? ""
  if (!hosts.has(host)) throw new ServiceError(403, "Use the local console address")
  // A tunnel accidentally pointed at this port must not become an authenticated proxy.
  if (Object.keys(req.headers).some((name) => name === "forwarded" || name.startsWith("x-forwarded-"))) {
    throw new ServiceError(403, "The console cannot be accessed through a forwarding proxy")
  }
  const expectedOrigin = "http://" + host
  const origin = req.headers.origin
  const site = req.headers["sec-fetch-site"]
  if ((origin !== undefined && origin !== expectedOrigin) || (site !== undefined && site !== "same-origin" && site !== "none")) {
    throw new ServiceError(403, "Use the local console origin")
  }
  if (req.method !== "GET" && origin !== expectedOrigin) throw new ServiceError(403, "Console writes require the local origin")
  const target = req.url ?? "/"
  if (!target.startsWith("/") || target.startsWith("//")) throw new ServiceError(400, "Invalid request target")
  const url = new URL(target, expectedOrigin)
  if (url.origin !== expectedOrigin) throw new ServiceError(400, "Invalid request target")
  if (req.method === "GET" && url.pathname === "/") {
    res.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "Content-Security-Policy": "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; object-src 'none'",
    })
    res.end(readFileSync(options.htmlPath, "utf8"))
    return
  }
  if (!isOperatorProxyRoute(req.method ?? "", url.pathname)) throw new ServiceError(404, "not found")
  const body = req.method === "POST" ? await readBody(req) : undefined
  // Never forward browser-supplied authorization, cookies or destination headers.
  const response = await fetch("http://127.0.0.1:" + options.apiPort + url.pathname + url.search, {
    method: req.method,
    headers: {
      Authorization: "Bearer " + options.operatorSecret,
      Origin: expectedOrigin,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body,
    redirect: "error",
    signal: AbortSignal.timeout(30_000),
  })
  const payload = Buffer.from(await response.arrayBuffer())
  res.writeHead(response.status, {
    "Content-Type": response.headers.get("content-type") ?? "application/json",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  })
  res.end(payload)
}

function isOperatorProxyRoute(method: string, path: string): boolean {
  if (method === "GET") return ["/state", "/profiles", "/intake-configuration"].includes(path)
  if (method !== "POST") return false
  return ["/incidents", "/cases", "/profiles", "/profiles/preferences", "/intake", "/intake-configuration"].includes(path)
    || /^\/cases\/\d+\/(calls|configuration|input|close)$/.test(path)
    || /^\/attempts\/\d+\/(cancel|reconcile|retry-interpretation)$/.test(path)
    || /^\/incoming-requests\/\d+\/review$/.test(path)
    || ["/simulation/report", "/simulation/request"].includes(path)
}

async function readBody(req: IncomingMessage): Promise<string> {
  let length = 0
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    length += buffer.length
    if (length > BODY_LIMIT) throw new ServiceError(413, "body is too large")
    chunks.push(buffer)
  }
  return Buffer.concat(chunks).toString("utf8")
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" })
  res.end(JSON.stringify(body))
}
