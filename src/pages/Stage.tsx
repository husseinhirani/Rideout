import { useState } from 'react'
import { ActivityFeed } from '../components/Feed'
import { Stats } from '../components/Lists'
import MapView from '../components/MapView'
import TopBar from '../components/TopBar'
import HelperPhone from '../phones/HelperPhone'
import PhoneFrame from '../phones/PhoneFrame'
import ResidentPhone from '../phones/ResidentPhone'
import { useSim } from '../store/store'

/** One screen for judges: the resident's call, the live map, and the helper's phone side by side. */
export default function Stage() {
  const residents = useSim((s) => s.residents)
  const helpers = useSim((s) => s.helpers)
  const [residentId, setResidentId] = useState(() => Object.values(residents).find((r) => r.live)?.id ?? 'margaret')
  const [helperId, setHelperId] = useState(() => Object.values(helpers).find((h) => h.live)?.id ?? 'daniel')

  const picker = (value: string, onChange: (v: string) => void, options: { id: string; name: string }[]) => (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="rounded-md border border-ink-600 bg-ink-800 px-2 py-1 text-[12px] font-medium text-ink-200 outline-none"
    >
      {options.map((o) => (
        <option key={o.id} value={o.id}>
          {o.name}
        </option>
      ))}
    </select>
  )

  return (
    <div className="flex h-full flex-col">
      <TopBar />
      <main className="scroll-thin flex min-h-0 flex-1 items-start justify-center gap-6 overflow-auto p-5">
        <div className="flex shrink-0 flex-col items-center gap-2">
          <div className="flex items-center gap-2 text-[11px] font-semibold tracking-[0.08em] text-ink-300 uppercase">
            Resident · phone call
            {picker(residentId, setResidentId, Object.values(residents))}
          </div>
          <PhoneFrame>
            <ResidentPhone key={residentId} id={residentId} />
          </PhoneFrame>
          <p className="max-w-[330px] text-center text-[11.5px] text-ink-400">
            Residents never need an app. In production this is an ordinary phone call; here, answer and talk to it.
          </p>
        </div>

        <div className="flex h-[740px] min-w-[420px] flex-1 flex-col gap-3">
          <div className="relative min-h-0 flex-1 overflow-hidden rounded-2xl border border-ink-700">
            <MapView variant="compact" />
            <div className="pointer-events-none absolute top-3 left-14 z-[500]">
              <Stats />
            </div>
          </div>
          <div className="scroll-thin h-[190px] shrink-0 overflow-y-auto rounded-2xl border border-ink-700 bg-ink-850">
            <ActivityFeed limit={30} />
          </div>
        </div>

        <div className="flex shrink-0 flex-col items-center gap-2">
          <div className="flex items-center gap-2 text-[11px] font-semibold tracking-[0.08em] text-ink-300 uppercase">
            Helper · neighbor's phone
            {picker(helperId, setHelperId, Object.values(helpers))}
          </div>
          <PhoneFrame>
            <HelperPhone key={helperId} id={helperId} />
          </PhoneFrame>
          <p className="max-w-[330px] text-center text-[11.5px] text-ink-400">
            Helpers get a push notification or a call. They only see requests that are on their way out.
          </p>
        </div>
      </main>
    </div>
  )
}
