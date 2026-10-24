import { Clock } from 'lucide-react'
import { LANGUAGE_LABEL } from '../data/scenario'
import { minutes, useSim, useStore } from '../store/store'
import type { Resident, ResidentStatus } from '../types'
import { HELPER_STATUS, HelperBadge, Initials, NEED_ICON, RESIDENT_STATUS, StatusBadge } from './ui'

const ORDER: ResidentStatus[] = [
  'escalated',
  'needs_help',
  'matching',
  'calling',
  'no_answer',
  'helper_assigned',
  'picked_up',
  'registered',
  'safe',
  'evacuated',
]

export function sortResidents(list: Resident[]) {
  return [...list].sort((a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status) || b.age - a.age)
}

export function ResidentList() {
  const residents = useSim((s) => s.residents)
  const t = useSim((s) => s.t)
  const selected = useStore((s) => s.selectedResidentId)
  const select = useStore((s) => s.select)

  return (
    <ul className="divide-y divide-ink-700/70">
      {sortResidents(Object.values(residents)).map((r) => {
        const meta = RESIDENT_STATUS[r.status]
        const waiting =
          r.waitingSince !== undefined && (r.status === 'needs_help' || r.status === 'matching' || r.status === 'escalated')
        return (
          <li key={r.id}>
            <button
              onClick={() => select(r.id === selected ? undefined : r.id)}
              className={`flex w-full items-start gap-3 px-3.5 py-2.5 text-left transition ${
                r.id === selected ? 'bg-ink-700/70' : 'hover:bg-ink-800'
              }`}
            >
              <Initials name={r.name} color={meta.color} size={30} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-[13.5px] font-semibold text-ink-100">
                    {r.name} <span className="font-normal text-ink-400">{r.age}</span>
                  </span>
                  <StatusBadge status={r.status} />
                </div>
                <div className="mt-0.5 flex items-center gap-2 text-[11.5px] text-ink-400">
                  <span className="truncate">{r.address}</span>
                  {r.language !== 'en' && <span className="shrink-0 text-ink-300">· {LANGUAGE_LABEL[r.language]}</span>}
                </div>
                <div className="mt-1.5 flex items-center gap-1.5">
                  {r.needs.map((n) => {
                    const Icon = NEED_ICON[n]
                    return (
                      <span key={n} title={n} className="grid size-5 place-items-center rounded bg-ink-700 text-ink-300">
                        <Icon className="size-3" />
                      </span>
                    )
                  })}
                  {r.live && (
                    <span className="ml-1 rounded bg-fire/15 px-1.5 py-px text-[10px] font-bold tracking-wide text-fire uppercase">
                      Live
                    </span>
                  )}
                  {waiting && (
                    <span className="tabular ml-auto flex items-center gap-1 text-[11px] font-semibold text-st-needs">
                      <Clock className="size-3" />
                      {minutes(t - r.waitingSince!)}
                    </span>
                  )}
                </div>
              </div>
            </button>
          </li>
        )
      })}
    </ul>
  )
}

export function HelperList() {
  const helpers = useSim((s) => s.helpers)
  const residents = useSim((s) => s.residents)

  return (
    <ul className="divide-y divide-ink-700/70">
      {Object.values(helpers).map((h) => {
        const going = h.trip ? residents[h.trip.residentId] : undefined
        return (
          <li key={h.id} className="flex items-start gap-3 px-3.5 py-2.5">
            <Initials name={h.name} color={HELPER_STATUS[h.status].color} size={30} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-[13.5px] font-semibold">{h.name}</span>
                <HelperBadge status={h.status} />
              </div>
              <div className="mt-0.5 text-[11.5px] text-ink-400">
                <span className="capitalize">{h.vehicle.color}</span> {h.vehicle.make} · {h.vehicle.seats} seat
                {h.vehicle.seats === 1 ? '' : 's'}
                {h.vehicle.wheelchair && ' · ♿ fits'}
              </div>
              {going && <div className="mt-0.5 text-[11.5px] text-blue-300">Picking up {going.name}</div>}
              {h.live && (
                <span className="mt-1 inline-block rounded bg-fire/15 px-1.5 py-px text-[10px] font-bold tracking-wide text-fire uppercase">
                  Live
                </span>
              )}
            </div>
          </li>
        )
      })}
    </ul>
  )
}

export function Stats() {
  const residents = useSim((s) => s.residents)
  const list = Object.values(residents)
  const count = (...st: ResidentStatus[]) => list.filter((r) => st.includes(r.status)).length
  const checked = list.filter((r) => r.interpretation || r.status === 'escalated').length

  const items = [
    { label: 'Registered', value: list.length, color: 'var(--color-ink-200)' },
    { label: 'Reached', value: checked, color: 'var(--color-st-calling)' },
    { label: 'Need a ride', value: count('needs_help', 'matching'), color: 'var(--color-st-needs)' },
    { label: 'Helper coming', value: count('helper_assigned', 'picked_up'), color: 'var(--color-st-assigned)' },
    { label: 'Safe', value: count('safe', 'evacuated'), color: 'var(--color-st-safe)' },
    { label: 'Responders', value: count('escalated'), color: 'var(--color-st-escalated)' },
  ]
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((i) => (
        <div key={i.label} className="rounded-lg border border-ink-700 bg-ink-900/85 px-2.5 py-1.5 backdrop-blur">
          <div className="tabular text-lg leading-none font-bold" style={{ color: i.color }}>
            {i.value}
          </div>
          <div className="mt-1 text-[10px] font-medium tracking-wide text-ink-400 uppercase">{i.label}</div>
        </div>
      ))}
    </div>
  )
}
