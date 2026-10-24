import { Bot, Car, CheckCircle2, Flame, Handshake, Info, MapPin, PhoneCall, Siren, type LucideIcon } from 'lucide-react'
import { NEED_LABEL } from '../data/scenario'
import { clock, dispatch, minutes, useSim, useStore } from '../store/store'
import type { LogKind } from '../types'

const KIND: Record<LogKind, { icon: LucideIcon; color: string }> = {
  fire: { icon: Flame, color: 'var(--color-fire)' },
  call: { icon: PhoneCall, color: 'var(--color-st-calling)' },
  ai: { icon: Bot, color: '#f0abfc' },
  match: { icon: Handshake, color: 'var(--color-st-matching)' },
  helper: { icon: Car, color: '#93c5fd' },
  escalate: { icon: Siren, color: 'var(--color-st-escalated)' },
  safe: { icon: CheckCircle2, color: 'var(--color-st-safe)' },
  system: { icon: Info, color: 'var(--color-ink-300)' },
}

export function ActivityFeed({ limit }: { limit?: number }) {
  const log = useSim((s) => s.log)
  const select = useStore((s) => s.select)
  const entries = [...log].reverse().slice(0, limit)

  if (!entries.length)
    return (
      <div className="px-4 py-8 text-center text-[13px] text-ink-400">
        Press <span className="font-semibold text-fire">Start simulation</span> to begin watching satellite fire detections.
      </div>
    )

  return (
    <ol className="space-y-px py-1">
      {entries.map((e) => {
        const k = KIND[e.kind]
        const Icon = k.icon
        return (
          <li key={e.id} className="ro-in">
            <button
              onClick={() => e.residentId && select(e.residentId)}
              className={`flex w-full gap-2.5 px-3.5 py-1.5 text-left ${e.residentId ? 'hover:bg-ink-800' : 'cursor-default'}`}
            >
              <Icon className="mt-0.5 size-3.5 shrink-0" style={{ color: k.color }} />
              <span className="min-w-0 flex-1 text-[12.5px] leading-snug text-ink-200">{e.text}</span>
              <span className="tabular shrink-0 pt-px font-mono text-[10.5px] text-ink-400">{clock(e.at)}</span>
            </button>
          </li>
        )
      })}
    </ol>
  )
}

export function ResponderQueue() {
  const residents = useSim((s) => s.residents)
  const t = useSim((s) => s.t)
  const select = useStore((s) => s.select)
  const queue = Object.values(residents)
    .filter((r) => r.status === 'escalated')
    .sort((a, b) => (a.escalation?.at ?? 0) - (b.escalation?.at ?? 0))

  if (!queue.length)
    return (
      <div className="px-4 py-8 text-center text-[13px] text-ink-400">
        Nobody needs responders yet. Cases land here when no neighbor can safely help in time.
      </div>
    )

  return (
    <ul className="space-y-2 p-3">
      {queue.map((r) => (
        <li key={r.id} className="ro-in rounded-lg border border-st-escalated/35 bg-st-escalated/8 p-3">
          <div className="flex items-start justify-between gap-2">
            <button onClick={() => select(r.id)} className="text-left">
              <div className="text-[14px] font-semibold">
                {r.name}, {r.age}
              </div>
              <div className="mt-0.5 flex items-center gap-1 text-[12px] text-ink-300">
                <MapPin className="size-3" /> {r.address} · {r.phone}
              </div>
            </button>
            <span className="tabular shrink-0 rounded-md bg-st-escalated/20 px-1.5 py-0.5 text-[11px] font-bold text-purple-200">
              {minutes(t - (r.waitingSince ?? r.escalation!.at))} waiting
            </span>
          </div>
          <p className="mt-2 text-[12.5px] text-purple-100/85">{r.escalation?.reason}</p>
          <p className="mt-1 text-[12px] text-ink-300">
            Needs: {r.needs.map((n) => NEED_LABEL[n]).join(', ') || 'unknown'}
            {r.livesAlone && ' · lives alone'}
          </p>
          {r.escalation?.acknowledged ? (
            <p className="mt-2 flex items-center gap-1 text-xs font-semibold text-st-safe">
              <CheckCircle2 className="size-3.5" /> Unit dispatched
            </p>
          ) : (
            <button
              onClick={() => dispatch('acknowledgeEscalation', r.id)}
              className="mt-2 rounded-md bg-st-escalated px-2.5 py-1 text-xs font-bold text-ink-950 hover:brightness-110"
            >
              Acknowledge · dispatch unit
            </button>
          )}
        </li>
      ))}
    </ul>
  )
}
