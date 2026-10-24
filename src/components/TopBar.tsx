import { Bot, Flame, Pause, Play, RotateCcw } from 'lucide-react'
import { NavLink } from 'react-router-dom'
import { ZONE } from '../data/scenario'
import { clock, dispatch, useSim } from '../store/store'

const PHASE = {
  idle: { label: 'Standing by', color: 'var(--color-ink-300)' },
  monitoring: { label: 'Monitoring satellites', color: '#5eead4' },
  activated: { label: 'Zone activated', color: 'var(--color-fire)' },
  resolved: { label: 'All accounted for', color: 'var(--color-st-safe)' },
}

export function Logo({ className = '' }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 font-extrabold tracking-tight ${className}`}>
      <span className="grid size-7 place-items-center rounded-lg bg-fire/15 text-fire">
        <Flame className="size-4.5" strokeWidth={2.5} />
      </span>
      RideOut
    </span>
  )
}

export default function TopBar() {
  const phase = useSim((s) => s.phase)
  const running = useSim((s) => s.running)
  const t = useSim((s) => s.t)
  const speed = useSim((s) => s.speed)
  const autopilot = useSim((s) => s.autopilot)
  const meta = PHASE[phase]

  const nav = ({ isActive }: { isActive: boolean }) =>
    `rounded-md px-2.5 py-1.5 text-[13px] font-medium transition ${
      isActive ? 'bg-ink-700 text-ink-100' : 'text-ink-300 hover:bg-ink-800 hover:text-ink-100'
    }`

  return (
    <header className="flex shrink-0 flex-wrap items-center gap-x-5 gap-y-2 border-b border-ink-700 bg-ink-900/95 px-4 py-2.5">
      <Logo className="text-[17px]" />

      <nav className="flex items-center gap-1">
        <NavLink to="/" end className={nav}>
          Command center
        </NavLink>
        <NavLink to="/stage" className={nav}>
          Demo stage
        </NavLink>
        <NavLink to="/register" className={nav}>
          Register
        </NavLink>
      </nav>

      <div className="flex items-center gap-3">
        <span className="rounded-md border border-ink-600 px-2 py-1 font-mono text-[11px] text-ink-300">
          {ZONE.id} · {ZONE.name}
        </span>
        <span className="flex items-center gap-2 text-[13px] font-semibold" style={{ color: meta.color }}>
          <span className="relative flex size-2">
            {phase !== 'idle' && (
              <span className="absolute inline-flex size-full animate-ping rounded-full opacity-60" style={{ background: meta.color }} />
            )}
            <span className="relative inline-flex size-2 rounded-full" style={{ background: meta.color }} />
          </span>
          {meta.label}
        </span>
        <span className="tabular font-mono text-[15px] text-ink-100">{clock(t)}</span>
      </div>

      <div className="ml-auto flex items-center gap-2">
        <span className="rounded-md bg-fire/12 px-2 py-1 text-[11px] font-bold tracking-wider text-fire uppercase">
          Simulated fire
        </span>

        <div className="flex rounded-lg border border-ink-600 p-0.5" role="group" aria-label="Simulation speed">
          {[1, 3, 6, 12].map((s) => (
            <button
              key={s}
              onClick={() => dispatch('setSpeed', s)}
              className={`tabular rounded-md px-2 py-1 text-xs font-semibold ${
                speed === s ? 'bg-ink-600 text-ink-100' : 'text-ink-400 hover:text-ink-200'
              }`}
            >
              {s}×
            </button>
          ))}
        </div>

        <button
          onClick={() => dispatch('setAutopilot', !autopilot)}
          title="Autopilot plays the live resident and helper too, so the demo runs without teammates"
          className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-semibold ${
            autopilot ? 'border-st-assigned/60 bg-st-assigned/15 text-blue-300' : 'border-ink-600 text-ink-300 hover:text-ink-100'
          }`}
        >
          <Bot className="size-3.5" />
          Autopilot {autopilot ? 'on' : 'off'}
        </button>

        <button
          onClick={() => dispatch('reset')}
          className="flex items-center gap-1.5 rounded-lg border border-ink-600 px-2.5 py-1.5 text-xs font-semibold text-ink-300 hover:text-ink-100"
        >
          <RotateCcw className="size-3.5" />
          Reset
        </button>

        <button
          onClick={() => dispatch(running ? 'pause' : 'start')}
          className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold ${
            running ? 'bg-ink-600 text-ink-100 hover:bg-ink-500' : 'bg-fire text-ink-950 hover:brightness-110'
          }`}
        >
          {running ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
          {running ? 'Pause' : phase === 'idle' ? 'Start simulation' : 'Resume'}
        </button>
      </div>
    </header>
  )
}
