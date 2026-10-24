import {
  Accessibility,
  CarFront,
  EarOff,
  EyeOff,
  PawPrint,
  PersonStanding,
  Wind,
  type LucideIcon,
} from 'lucide-react'
import type { ReactNode } from 'react'
import { NEED_LABEL } from '../data/scenario'
import type { HelperStatus, Need, ResidentStatus } from '../types'

export const RESIDENT_STATUS: Record<ResidentStatus, { label: string; color: string; urgent?: boolean }> = {
  registered: { label: 'Registered', color: 'var(--color-st-registered)' },
  calling: { label: 'On call', color: 'var(--color-st-calling)' },
  no_answer: { label: 'No answer', color: 'var(--color-st-matching)' },
  safe: { label: 'Leaving on own', color: 'var(--color-st-safe)' },
  needs_help: { label: 'Needs a ride', color: 'var(--color-st-needs)', urgent: true },
  matching: { label: 'Asking helper', color: 'var(--color-st-matching)', urgent: true },
  helper_assigned: { label: 'Helper coming', color: 'var(--color-st-assigned)' },
  picked_up: { label: 'Picked up', color: 'var(--color-st-assigned)' },
  evacuated: { label: 'Evacuated', color: 'var(--color-st-safe)' },
  escalated: { label: 'Escalated', color: 'var(--color-st-escalated)', urgent: true },
}

export const HELPER_STATUS: Record<HelperStatus, { label: string; color: string }> = {
  standby: { label: 'Standby', color: 'var(--color-ink-400)' },
  leaving: { label: 'Leaving now', color: '#5eead4' },
  asked: { label: 'Being asked', color: 'var(--color-st-matching)' },
  en_route: { label: 'En route to pickup', color: 'var(--color-st-assigned)' },
  carrying: { label: 'Driving out', color: 'var(--color-st-assigned)' },
  evacuated: { label: 'Out of zone', color: 'var(--color-st-safe)' },
}

export const NEED_ICON: Record<Need, LucideIcon> = {
  walker: PersonStanding,
  wheelchair: Accessibility,
  oxygen: Wind,
  pets: PawPrint,
  hearing: EarOff,
  vision: EyeOff,
  no_car: CarFront,
}

export function StatusBadge({ status, size = 'sm' }: { status: ResidentStatus; size?: 'sm' | 'md' }) {
  const meta = RESIDENT_STATUS[status]
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full font-semibold whitespace-nowrap ${
        size === 'md' ? 'px-2.5 py-1 text-xs' : 'px-2 py-0.5 text-[11px]'
      }`}
      style={{ color: meta.color, background: `color-mix(in srgb, ${meta.color} 14%, transparent)` }}
    >
      <span
        className={`size-1.5 rounded-full ${meta.urgent ? 'animate-pulse' : ''}`}
        style={{ background: meta.color }}
      />
      {meta.label}
    </span>
  )
}

export function HelperBadge({ status }: { status: HelperStatus }) {
  const meta = HELPER_STATUS[status]
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap"
      style={{ color: meta.color, background: `color-mix(in srgb, ${meta.color} 14%, transparent)` }}
    >
      <span className="size-1.5 rounded-full" style={{ background: meta.color }} />
      {meta.label}
    </span>
  )
}

export function NeedTags({ needs, size = 'sm' }: { needs: Need[]; size?: 'sm' | 'lg' }) {
  if (!needs.length) return null
  return (
    <div className="flex flex-wrap gap-1">
      {needs.map((n) => {
        const Icon = NEED_ICON[n]
        return (
          <span
            key={n}
            className={`inline-flex items-center gap-1 rounded-md border border-ink-600 bg-ink-800 text-ink-200 ${
              size === 'lg' ? 'px-2 py-1 text-sm' : 'px-1.5 py-0.5 text-[11px]'
            }`}
          >
            <Icon className={size === 'lg' ? 'size-4' : 'size-3'} />
            {NEED_LABEL[n]}
          </span>
        )
      })}
    </div>
  )
}

export function Panel({
  title,
  right,
  children,
  className = '',
}: {
  title?: ReactNode
  right?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section className={`flex min-h-0 flex-col rounded-xl border border-ink-700 bg-ink-850 ${className}`}>
      {title && (
        <header className="flex items-center justify-between gap-2 border-b border-ink-700 px-3.5 py-2.5">
          <h2 className="text-[11px] font-semibold tracking-[0.08em] text-ink-300 uppercase">{title}</h2>
          {right}
        </header>
      )}
      {children}
    </section>
  )
}

export function Initials({ name, color, size = 32 }: { name: string; color: string; size?: number }) {
  const initials = name
    .split(' ')
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
  return (
    <span
      className="grid shrink-0 place-items-center rounded-full font-bold text-ink-900"
      style={{ width: size, height: size, background: color, fontSize: size * 0.36 }}
    >
      {initials}
    </span>
  )
}
