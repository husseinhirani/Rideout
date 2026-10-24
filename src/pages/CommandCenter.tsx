import { ExternalLink } from 'lucide-react'
import { useState } from 'react'
import CaseDetail from '../components/CaseDetail'
import { ActivityFeed, ResponderQueue } from '../components/Feed'
import { HelperList, ResidentList, Stats } from '../components/Lists'
import MapView from '../components/MapView'
import TopBar from '../components/TopBar'
import { Panel, RESIDENT_STATUS } from '../components/ui'
import { useSim, useStore } from '../store/store'

function Tabs<T extends string>({ value, onChange, tabs }: { value: T; onChange: (v: T) => void; tabs: { id: T; label: React.ReactNode }[] }) {
  return (
    <div className="flex gap-1 border-b border-ink-700 px-2 pt-2">
      {tabs.map((t) => (
        <button
          key={t.id}
          onClick={() => onChange(t.id)}
          className={`-mb-px border-b-2 px-2.5 pb-2 text-[12.5px] font-semibold ${
            value === t.id ? 'border-fire text-ink-100' : 'border-transparent text-ink-400 hover:text-ink-200'
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  )
}

function Legend() {
  const items = [
    ['Needs a ride', RESIDENT_STATUS.needs_help.color],
    ['Asking helper', RESIDENT_STATUS.matching.color],
    ['Helper coming', RESIDENT_STATUS.helper_assigned.color],
    ['Safe', RESIDENT_STATUS.safe.color],
    ['Responders', RESIDENT_STATUS.escalated.color],
    ['On call', RESIDENT_STATUS.calling.color],
  ]
  return (
    <div className="rounded-lg border border-ink-700 bg-ink-900/85 px-3 py-2 text-[11px] text-ink-300 backdrop-blur">
      <div className="grid grid-cols-2 gap-x-4 gap-y-1">
        {items.map(([label, color]) => (
          <span key={label} className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-full" style={{ background: color }} />
            {label}
          </span>
        ))}
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-[3px] bg-[#5eead4]" /> Helper car
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-full bg-fire" /> Satellite hotspot
        </span>
      </div>
    </div>
  )
}

export default function CommandCenter() {
  const selected = useStore((s) => s.selectedResidentId)
  const residents = useSim((s) => s.residents)
  const escalated = Object.values(residents).filter((r) => r.status === 'escalated' && !r.escalation?.acknowledged).length
  const [left, setLeft] = useState<'residents' | 'helpers'>('residents')
  const [right, setRight] = useState<'case' | 'activity' | 'responders'>('activity')

  // Jump to the case tab whenever a different resident is picked (on the map, list, or feed).
  const [lastSelected, setLastSelected] = useState(selected)
  if (selected !== lastSelected) {
    setLastSelected(selected)
    setRight(selected ? 'case' : 'activity')
  }

  const liveResident = Object.values(residents).find((r) => r.live)

  return (
    <div className="flex h-full flex-col">
      <TopBar />
      <main className="grid min-h-0 flex-1 grid-cols-[300px_1fr_380px] gap-3 p-3 max-xl:grid-cols-[260px_1fr_340px]">
        <Panel className="overflow-hidden">
          <Tabs
            value={left}
            onChange={setLeft}
            tabs={[
              { id: 'residents', label: `Residents (${Object.keys(residents).length})` },
              { id: 'helpers', label: 'Helpers' },
            ]}
          />
          <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">{left === 'residents' ? <ResidentList /> : <HelperList />}</div>
          <div className="space-y-1 border-t border-ink-700 p-3 text-[12px]">
            <div className="mb-1 font-semibold text-ink-400">Open a demo phone</div>
            {liveResident && (
              <a href={`/resident/${liveResident.id}`} target="_blank" className="flex items-center gap-1.5 text-sky-300 hover:underline">
                <ExternalLink className="size-3" /> Resident: {liveResident.name}
              </a>
            )}
            <a href="/helper/daniel" target="_blank" className="flex items-center gap-1.5 text-sky-300 hover:underline">
              <ExternalLink className="size-3" /> Helper: Daniel Reyes
            </a>
          </div>
        </Panel>

        <div className="relative min-h-0 overflow-hidden rounded-xl border border-ink-700">
          <MapView />
          <div className="pointer-events-none absolute top-3 left-14 z-[500]">
            <Stats />
          </div>
          <div className="pointer-events-none absolute bottom-6 left-3 z-[500]">
            <Legend />
          </div>
        </div>

        <Panel className="overflow-hidden">
          <Tabs
            value={right}
            onChange={setRight}
            tabs={[
              ...(selected ? [{ id: 'case' as const, label: residents[selected]?.name.split(' ')[0] ?? 'Case' }] : []),
              { id: 'activity' as const, label: 'Activity' },
              {
                id: 'responders' as const,
                label: (
                  <span className="flex items-center gap-1.5">
                    Responders
                    {escalated > 0 && (
                      <span className="tabular rounded-full bg-st-escalated px-1.5 text-[10px] leading-4 font-bold text-ink-950">{escalated}</span>
                    )}
                  </span>
                ),
              },
            ]}
          />
          {right === 'case' && selected ? (
            <CaseDetail id={selected} />
          ) : (
            <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">{right === 'responders' ? <ResponderQueue /> : <ActivityFeed />}</div>
          )}
        </Panel>
      </main>
    </div>
  )
}
