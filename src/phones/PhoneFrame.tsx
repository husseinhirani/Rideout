import { BatteryFull, Signal, Wifi } from 'lucide-react'
import type { ReactNode } from 'react'
import { clock, useSim } from '../store/store'

/**
 * Device chrome for the demo stage. With `bare`, renders edge-to-edge for an actual phone
 * browser (open /resident/:id or /helper/:id on the device).
 */
export default function PhoneFrame({
  children,
  bare = false,
  label,
  tone = 'dark',
}: {
  children: ReactNode
  bare?: boolean
  label?: ReactNode
  tone?: 'dark' | 'alert'
}) {
  const t = useSim((s) => s.t)
  const time = clock(t).replace(/ (AM|PM)/, '')

  const statusBar = (
    <div className="flex items-center justify-between px-6 pt-3 pb-1 text-[13px] font-semibold text-white">
      <span className="tabular">{time}</span>
      <span className="flex items-center gap-1">
        <Signal className="size-3.5" />
        <Wifi className="size-3.5" />
        <BatteryFull className="size-4" />
      </span>
    </div>
  )

  const bg = tone === 'alert' ? 'bg-[#1a0b07]' : 'bg-ink-950'

  if (bare)
    return (
      <div className={`flex h-full min-h-0 flex-col ${bg}`}>
        <div className="flex min-h-0 flex-1 flex-col">{children}</div>
      </div>
    )

  return (
    <div className="flex flex-col items-center gap-2">
      {label && <div className="text-[11px] font-semibold tracking-[0.08em] text-ink-300 uppercase">{label}</div>}
      <div className="rounded-[46px] border border-ink-600 bg-ink-800 p-[9px] shadow-[0_30px_80px_-20px_rgba(0,0,0,0.8)]">
        <div className={`relative flex h-[680px] w-[330px] flex-col overflow-hidden rounded-[38px] ${bg} transition-colors`}>
          <div className="absolute top-2.5 left-1/2 z-20 h-[26px] w-[96px] -translate-x-1/2 rounded-full bg-black" />
          {statusBar}
          <div className="flex min-h-0 flex-1 flex-col">{children}</div>
          <div className="mx-auto mt-1 mb-2 h-1 w-28 shrink-0 rounded-full bg-white/30" />
        </div>
      </div>
    </div>
  )
}
