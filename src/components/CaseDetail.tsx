import { Bot, Car, Check, PhoneCall, Siren, Sparkles, X } from 'lucide-react'
import { useMemo } from 'react'
import { LANGUAGE_LABEL } from '../data/scenario'
import { candidatesFor } from '../store/sim'
import { clock, dispatch, minutes, useSim, useStore } from '../store/store'
import type { CallTurn, Resident } from '../types'
import { NeedTags, StatusBadge } from './ui'

export function Transcript({ turns, large = false }: { turns: CallTurn[]; large?: boolean }) {
  if (!turns.length) return <p className="px-1 text-sm text-ink-400">No calls yet.</p>
  return (
    <div className="flex flex-col gap-2">
      {turns.map((turn, i) => {
        if (turn.speaker === 'system')
          return (
            <div key={i} className="text-center text-[11px] font-medium text-ink-400">
              {turn.text}
            </div>
          )
        const isAgent = turn.speaker === 'agent'
        return (
          <div key={i} className={`ro-in flex ${isAgent ? 'justify-start' : 'justify-end'}`}>
            <div
              className={`max-w-[88%] rounded-2xl px-3 py-2 ${large ? 'text-[15px]' : 'text-[13px]'} leading-snug ${
                isAgent ? 'rounded-bl-md bg-ink-700 text-ink-100' : 'rounded-br-md bg-st-calling/20 text-sky-100'
              }`}
            >
              <div className="mb-0.5 text-[10px] font-semibold tracking-wide uppercase opacity-60">
                {isAgent ? 'RideOut agent' : 'Resident'}
              </div>
              {turn.text}
              {turn.translation && <div className="mt-1 text-[12px] italic opacity-60">{turn.translation}</div>}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function Section({ icon: Icon, title, children }: { icon: typeof Bot; title: string; children: React.ReactNode }) {
  return (
    <div className="border-t border-ink-700 px-4 py-3.5">
      <h3 className="mb-2.5 flex items-center gap-1.5 text-[11px] font-semibold tracking-[0.08em] text-ink-300 uppercase">
        <Icon className="size-3.5" />
        {title}
      </h3>
      {children}
    </div>
  )
}

function Matching({ r }: { r: Resident }) {
  const sim = useSim((s) => s)
  const evals = useMemo(() => candidatesFor(sim, r), [sim, r])
  const offers = Object.values(sim.offers).filter((o) => o.residentId === r.id)
  const active = offers.find((o) => o.status === 'pending' || o.status === 'accepted')

  return (
    <Section icon={Sparkles} title="Match">
      {active && (
        <p className="mb-3 rounded-lg border border-ink-600 bg-ink-800 px-3 py-2 text-[12.5px] leading-relaxed text-ink-200">
          <span className="font-semibold text-ink-100">Why {sim.helpers[active.helperId].name.split(' ')[0]}: </span>
          {active.reasoning}
        </p>
      )}

      {offers.length > 0 && (
        <ol className="mb-3 space-y-1">
          {offers.map((o) => (
            <li key={o.id} className="flex items-center justify-between gap-2 text-[12.5px]">
              <span className="text-ink-200">
                <span className="tabular text-ink-400">{clock(o.createdAt)}</span> Asked {sim.helpers[o.helperId].name}
              </span>
              <span
                className={`text-[11px] font-semibold ${
                  o.status === 'accepted'
                    ? 'text-st-safe'
                    : o.status === 'pending'
                      ? 'text-st-matching'
                      : 'text-st-needs'
                }`}
              >
                {o.status === 'pending' ? 'waiting…' : o.status}
              </span>
            </li>
          ))}
        </ol>
      )}

      {(r.status === 'needs_help' || r.status === 'matching' || r.status === 'escalated') && (
        <div className="space-y-1.5">
          {evals.slice(0, 6).map((e) => {
            const h = sim.helpers[e.helperId]
            return (
              <div
                key={e.helperId}
                className={`rounded-lg border px-2.5 py-2 ${
                  e.eligible ? 'border-st-safe/30 bg-st-safe/5' : 'border-ink-700 bg-ink-800/50 opacity-70'
                }`}
              >
                <div className="flex items-center justify-between text-[12.5px]">
                  <span className="font-semibold">{h.name}</span>
                  <span className="tabular text-ink-300">
                    +{e.detourMin} min · {(e.distanceM / 1000).toFixed(1)} km
                  </span>
                </div>
                <div className="mt-1 flex flex-wrap gap-x-2.5 gap-y-0.5 text-[11px]">
                  {e.reasons.map((reason) => (
                    <span key={reason} className={reason.startsWith('✕') ? 'text-red-300' : 'text-ink-400'}>
                      {reason}
                    </span>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </Section>
  )
}

export default function CaseDetail({ id }: { id: string }) {
  const r = useSim((s) => s.residents[id])
  const helpers = useSim((s) => s.helpers)
  const t = useSim((s) => s.t)
  const select = useStore((s) => s.select)
  if (!r) return null
  const helper = r.helperId ? helpers[r.helperId] : undefined
  const ai = r.interpretation

  return (
    <div className="ro-in flex min-h-0 flex-1 flex-col">
      <div className="flex items-start justify-between gap-3 px-4 pt-3.5 pb-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg leading-tight font-bold">{r.name}</h2>
            <StatusBadge status={r.status} size="md" />
          </div>
          <p className="mt-1 text-[12.5px] text-ink-300">
            {r.age} · {r.address} · {LANGUAGE_LABEL[r.language]}
            {r.livesAlone && ' · lives alone'}
          </p>
          <p className="mt-0.5 text-[11.5px] text-ink-400">
            {r.phone} · registered by {r.registeredBy}
          </p>
        </div>
        <button onClick={() => select(undefined)} className="rounded-md p-1 text-ink-400 hover:bg-ink-700 hover:text-ink-100" aria-label="Close">
          <X className="size-4" />
        </button>
      </div>

      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
        <div className="space-y-2 px-4 pb-3.5">
          <NeedTags needs={r.needs} />
          {r.notes && <p className="text-[12.5px] text-ink-300">{r.notes}</p>}

          {r.escalation && (
            <div className="rounded-lg border border-st-escalated/40 bg-st-escalated/10 p-3">
              <div className="flex items-center gap-2 text-[13px] font-semibold text-purple-200">
                <Siren className="size-4" /> With responders · waiting {minutes(t - (r.waitingSince ?? r.escalation.at))}
              </div>
              <p className="mt-1 text-[12.5px] text-purple-100/80">{r.escalation.reason}</p>
              {!r.escalation.acknowledged ? (
                <button
                  onClick={() => dispatch('acknowledgeEscalation', r.id)}
                  className="mt-2 rounded-md bg-st-escalated px-2.5 py-1 text-xs font-bold text-ink-950"
                >
                  Acknowledge · dispatch unit
                </button>
              ) : (
                <p className="mt-1.5 flex items-center gap-1 text-xs font-semibold text-st-safe">
                  <Check className="size-3.5" /> Unit dispatched
                </p>
              )}
            </div>
          )}

          {helper && (r.status === 'helper_assigned' || r.status === 'picked_up') && (
            <div className="flex items-center gap-3 rounded-lg border border-st-assigned/40 bg-st-assigned/10 p-3">
              <Car className="size-5 text-blue-300" />
              <div className="text-[13px]">
                <div className="font-semibold text-blue-100">
                  {helper.name} · <span className="capitalize">{helper.vehicle.color}</span> {helper.vehicle.make}
                </div>
                <div className="text-blue-200/80">
                  {r.status === 'picked_up' ? 'In the car, heading out' : `Arrives in about ${minutes((r.etaAt ?? t) - t)}`}
                </div>
              </div>
            </div>
          )}
        </div>

        {ai && (
          <Section icon={Bot} title="Claude's read of the call">
            <p className="text-[13.5px] font-medium text-ink-100">{ai.summary}</p>
            <div className="mt-2 flex items-center gap-2">
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-ink-700">
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${ai.confidence * 100}%`,
                    background: ai.confidence > 0.8 ? 'var(--color-st-safe)' : ai.confidence > 0.5 ? 'var(--color-st-matching)' : 'var(--color-st-needs)',
                  }}
                />
              </div>
              <span className="tabular text-[11px] text-ink-300">{Math.round(ai.confidence * 100)}% sure</span>
            </div>
            {ai.evidence.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {ai.evidence.map((e) => (
                  <span key={e} className="rounded-md bg-ink-700 px-1.5 py-0.5 text-[11px] text-ink-200">
                    “{e}”
                  </span>
                ))}
              </div>
            )}
          </Section>
        )}

        {r.status !== 'registered' && r.status !== 'calling' && r.status !== 'no_answer' && r.status !== 'safe' && <Matching r={r} />}

        <Section icon={PhoneCall} title={`Check-in call${r.callAttempts > 1 ? `s (${r.callAttempts})` : ''}`}>
          <Transcript turns={r.transcript} />
        </Section>
      </div>
    </div>
  )
}
