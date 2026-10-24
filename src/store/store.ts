import { create } from 'zustand'
import type { SimState } from '../types'
import { initialState, reducers, type ReducerName } from './sim'

/**
 * In-browser stand-in for the shared backend.
 *
 * One tab (whichever grabs the Web Lock first) runs the simulation engine and owns the state.
 * Every other tab — a helper phone, the resident phone, a second monitor — sends actions to it
 * over a BroadcastChannel and renders the snapshots it sends back. So any number of tabs on one
 * machine stay in sync. For phones on other devices, replace `dispatch` with backend mutations
 * and the `state` messages with a live query (e.g. Convex `useQuery`); the reducer names in
 * `sim.ts` are the mutation list.
 */

interface Store {
  sim: SimState
  isLeader: boolean
  /** Per-tab UI state, never synced. */
  selectedResidentId?: string
  select: (id?: string) => void
}

/* A refresh mid-demo shouldn't lose the scenario, so the engine tab keeps a copy in localStorage. */
const SAVE_KEY = 'rideout-sim-v1'
let lastSave = 0

function loadSaved(): SimState | undefined {
  try {
    const raw = localStorage.getItem(SAVE_KEY)
    return raw ? (JSON.parse(raw) as SimState) : undefined
  } catch {
    return undefined
  }
}

function save(sim: SimState, force = false) {
  const now = Date.now()
  if (!force && now - lastSave < 1000) return
  lastSave = now
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(sim))
  } catch {
    // Storage full or blocked: the demo still works, it just won't survive a refresh.
  }
}

export const useStore = create<Store>((set) => ({
  sim: loadSaved() ?? initialState(),
  isLeader: false,
  select: (id) => set({ selectedResidentId: id }),
}))

export const useSim = <T,>(selector: (s: SimState) => T) => useStore((st) => selector(st.sim))

type Tail<T extends unknown[]> = T extends [unknown, ...infer R] ? R : never
type Args<N extends ReducerName> = Tail<Parameters<(typeof reducers)[N]>>

type Message =
  | { type: 'state'; state: SimState }
  | { type: 'action'; name: ReducerName; args: unknown[] }
  | { type: 'hello' }

const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('rideout-demo') : null

function applyLocal(name: ReducerName, args: unknown[]) {
  const next = structuredClone(useStore.getState().sim)
  ;(reducers[name] as (s: SimState, ...a: unknown[]) => void)(next, ...args)
  useStore.setState({ sim: next })
  channel?.postMessage({ type: 'state', state: next } satisfies Message)
  save(next, name !== 'tick')
}

export function dispatch<N extends ReducerName>(name: N, ...args: Args<N>) {
  if (useStore.getState().isLeader || !channel) applyLocal(name, args)
  else channel.postMessage({ type: 'action', name, args } satisfies Message)
}

if (channel) {
  channel.onmessage = (e: MessageEvent<Message>) => {
    const msg = e.data
    const leader = useStore.getState().isLeader
    if (msg.type === 'state' && !leader) useStore.setState({ sim: msg.state })
    else if (msg.type === 'action' && leader) applyLocal(msg.name, msg.args)
    else if (msg.type === 'hello' && leader) channel.postMessage({ type: 'state', state: useStore.getState().sim } satisfies Message)
  }
  channel.postMessage({ type: 'hello' } satisfies Message)
}

/* ------------------------------ the engine loop ------------------------------ */

const TICK_MS = 250
let timer: ReturnType<typeof setInterval> | undefined
let releaseLock: (() => void) | undefined

function startEngine() {
  let last = performance.now()
  timer = setInterval(() => {
    const now = performance.now()
    const realDt = Math.min(2, (now - last) / 1000)
    last = now
    const { sim } = useStore.getState()
    if (sim.running) applyLocal('tick', [realDt * sim.speed])
  }, TICK_MS)
}

function becomeLeader() {
  useStore.setState({ isLeader: true })
  startEngine()
}

if (typeof navigator !== 'undefined' && 'locks' in navigator) {
  navigator.locks.request('rideout-engine', () => {
    becomeLeader()
    return new Promise<void>((resolve) => (releaseLock = resolve))
  })
} else {
  becomeLeader()
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    clearInterval(timer)
    releaseLock?.()
    channel?.close()
  })
}

export { clock, minutes } from '../lib/format'
