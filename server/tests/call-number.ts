import { spawn, type ChildProcess } from "node:child_process"
import { connect } from "node:net"
import { resolve } from "node:path"
import { callReducer, profiles } from "../src/db"
import { loadEnv } from "../src/env"

const E164 = /^\+[1-9]\d{1,14}$/
const API_PORT = process.env.PORT ?? "8787"

loadEnv()

const phone = process.argv[2]?.trim() ?? ""
if (E164.test(phone) === false) {
  console.error("usage: npm run test:call -- +14155550123")
  process.exit(1)
}

callNumber(phone).then(
  (callId) => {
    console.log(callId)
    console.log("Cartesia is calling " + phone)
  },
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : "Call test failed")
    process.exit(1)
  },
)

async function callNumber(to: string): Promise<string> {
  const name = "call-" + String(Date.now())
  const lat = -20
  const lng = -140 + Math.random() * 20
  await callReducer("insertProfile", [name, to, lat, lng, []])
  const profile = (await profiles()).find((row) => row.name === name)
  if (!profile) throw new Error("Profile was not inserted")
  const server = await ensureServer()
  try {
    let response: Response
    try {
      response = await fetch("http://127.0.0.1:" + API_PORT + "/incidents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "wildfire", lat, lng, radius_m: 50 }),
      })
    } catch (error) {
      throw new Error("POST /incidents could not reach 127.0.0.1:" + API_PORT + ": " + (error instanceof Error ? error.message : "request failed"))
    }
    const body = (await response.json()) as {
      calls?: { profile_id: number; call_id: string }[]
      errors?: { profile_id: number; error: string }[]
      error?: string
    }
    if (!response.ok) {
      throw new Error(body.error ?? "POST /incidents failed (" + String(response.status) + ")")
    }
    const failure = body.errors?.find((row) => row.profile_id === profile.id)
    if (failure) throw new Error(failure.error)
    const call = body.calls?.find((row) => row.profile_id === profile.id)
    if (!call?.call_id) throw new Error("POST /incidents did not call " + to)
    return call.call_id
  } finally {
    server?.kill()
  }
}

async function ensureServer(): Promise<ChildProcess | null> {
  if (await serverUp()) return null
  const child = spawn(resolve(import.meta.dirname, "../node_modules/.bin/tsx"), ["src/server.ts"], {
    cwd: resolve(import.meta.dirname, ".."),
    stdio: "inherit",
    env: process.env,
  })
  const started = Date.now()
  while (Date.now() - started < 10_000) {
    if (await serverUp()) return child
    if (child.exitCode !== null) throw new Error("HTTP server exited before it listened on " + API_PORT)
    await delay(200)
  }
  child.kill()
  throw new Error("HTTP server did not listen on " + API_PORT)
}

function serverUp(): Promise<boolean> {
  return new Promise((resolvePromise) => {
    const socket = connect(Number(API_PORT), "127.0.0.1")
    const done = (up: boolean) => {
      socket.removeAllListeners()
      socket.end()
      resolvePromise(up)
    }
    socket.once("connect", () => done(true))
    socket.once("error", () => done(false))
  })
}

function delay(ms: number): Promise<void> {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms))
}
