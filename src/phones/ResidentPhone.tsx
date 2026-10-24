import { Car, Check, Mic, MicOff, Phone, PhoneMissed, Send, ShieldCheck, Siren, Volume2, VolumeX } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { EVAC_POINT } from '../data/scenario'
import { canListen, listen, speak, stopSpeaking } from '../lib/voice'
import { dispatch, useSim } from '../store/store'
import type { CallTurn } from '../types'

const QUICK_REPLIES = [
  "I use a walker and my daughter has the car. I can't get out on my own.",
  "Yes, I can leave. I'm getting in my car.",
  'My son is coming to pick me up.',
  'Hmm… what was that?',
]

/** Speak agent lines that arrive while this screen is open (not the backlog). */
function useSpeakNewLines(turns: CallTurn[], lang: Parameters<typeof speak>[1], enabled: boolean) {
  const seen = useRef(turns.length)
  useEffect(() => {
    const fresh = turns.slice(seen.current).filter((t) => t.speaker === 'agent')
    seen.current = turns.length
    if (enabled && fresh.length) speak(fresh[fresh.length - 1].text, lang)
  }, [turns, lang, enabled])
  useEffect(() => () => stopSpeaking(), [])
}

function Elapsed({ since }: { since: number }) {
  const t = useSim((s) => s.t)
  const s = Math.max(0, Math.floor(t - since))
  return (
    <span className="tabular">
      {Math.floor(s / 60)}:{(s % 60).toString().padStart(2, '0')}
    </span>
  )
}

export default function ResidentPhone({ id, soundDefault = true }: { id: string; soundDefault?: boolean }) {
  const r = useSim((s) => s.residents[id])
  const helpers = useSim((s) => s.helpers)
  const phase = useSim((s) => s.phase)
  const t = useSim((s) => s.t)
  const [sound, setSound] = useState(soundDefault)
  const [draft, setDraft] = useState('')
  const [listening, setListening] = useState(false)
  const [partial, setPartial] = useState('')
  const [micError, setMicError] = useState<string>()
  const stopRef = useRef<() => void>(() => {})

  useSpeakNewLines(r?.transcript ?? [], r?.language ?? 'en', sound)

  if (!r) return <div className="p-6 text-ink-300">Resident not found.</div>
  const first = r.name.split(' ')[0]
  const helper = r.helperId ? helpers[r.helperId] : undefined
  const lastAgent = [...r.transcript].reverse().find((x) => x.speaker === 'agent')

  const send = (text: string) => {
    if (!text.trim()) return
    stopSpeaking()
    dispatch('residentSays', id, text.trim())
    setDraft('')
    setPartial('')
  }

  const toggleMic = () => {
    if (listening) {
      stopRef.current()
      return
    }
    stopSpeaking()
    setMicError(undefined)
    setPartial('')
    setListening(true)
    stopRef.current = listen(
      r.language,
      setPartial,
      (text) => {
        setListening(false)
        if (text) send(text)
      },
      (err) => {
        setListening(false)
        setMicError(err === 'not-allowed' ? 'Microphone blocked — type instead.' : err)
      },
    )
  }

  const SoundToggle = (
    <button
      onClick={() => {
        if (sound) stopSpeaking()
        setSound(!sound)
      }}
      className="rounded-full bg-white/8 p-2 text-ink-200"
      aria-label={sound ? 'Mute agent voice' : 'Play agent voice'}
    >
      {sound ? <Volume2 className="size-4" /> : <VolumeX className="size-4" />}
    </button>
  )

  /* ----- Incoming call ----- */
  if (r.status === 'calling' && r.callState === 'ringing') {
    return (
      <div className="flex flex-1 flex-col items-center justify-between bg-gradient-to-b from-[#1d2a22] to-ink-950 px-6 pt-14 pb-12 text-center">
        <div>
          <div className="mx-auto grid size-20 place-items-center rounded-full bg-fire/20 text-fire">
            <ShieldCheck className="size-10" />
          </div>
          <h2 className="mt-5 text-[26px] font-bold">RideOut Safety Check</h2>
          <p className="mt-1 text-[15px] text-ink-300">Wildfire safety call</p>
          <p className="mt-6 text-[13px] text-ink-400">
            Incoming call… <Elapsed since={r.callStartedAt ?? t} />
          </p>
        </div>
        <button
          onClick={() => dispatch('answerCall', id)}
          className="ro-halo grid size-20 place-items-center rounded-full bg-st-safe text-white"
          aria-label="Answer"
        >
          <Phone className="ro-ring size-9" fill="currentColor" />
        </button>
        <span className="-mt-8 text-sm text-ink-300">Answer</span>
      </div>
    )
  }

  /* ----- On the call ----- */
  if (r.callState === 'connected') {
    const agentTurns = r.transcript.filter((x) => x.speaker !== 'system')
    const recent = agentTurns.slice(-3)
    return (
      <div className="flex min-h-0 flex-1 flex-col bg-gradient-to-b from-[#16201b] to-ink-950">
        <div className="flex items-center justify-between px-5 pt-3">
          <div>
            <div className="text-[17px] font-bold">RideOut Safety Check</div>
            <div className="text-[13px] text-st-safe">
              <Elapsed since={r.callStartedAt ?? t} />
            </div>
          </div>
          {SoundToggle}
        </div>

        <div className="scroll-thin min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4">
          {recent.map((turn, i) => (
            <div key={turn.at + ':' + i} className={`ro-in ${turn.speaker === 'agent' ? '' : 'text-right'}`}>
              <div className="mb-0.5 text-[11px] font-semibold tracking-wide text-ink-400 uppercase">
                {turn.speaker === 'agent' ? 'RideOut' : 'You'}
              </div>
              <p className={`text-[19px] leading-snug ${turn.speaker === 'agent' ? 'text-white' : 'text-sky-200'}`}>{turn.text}</p>
              {turn.translation && <p className="mt-1 text-[13px] text-ink-400 italic">{turn.translation}</p>}
            </div>
          ))}
          {listening && <p className="text-right text-[19px] leading-snug text-sky-200/60">{partial || 'Listening…'}</p>}
        </div>

        <div className="space-y-2.5 border-t border-white/8 px-4 pt-3 pb-4">
          <div className="flex flex-wrap gap-1.5">
            {QUICK_REPLIES.map((q) => (
              <button
                key={q}
                onClick={() => send(q)}
                className="rounded-full border border-white/12 bg-white/5 px-2.5 py-1 text-left text-[11.5px] text-ink-200 hover:bg-white/10"
              >
                {q.length > 38 ? q.slice(0, 36) + '…' : q}
              </button>
            ))}
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault()
              send(draft)
            }}
            className="flex items-center gap-2"
          >
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Say or type an answer…"
              className="min-w-0 flex-1 rounded-full border border-white/12 bg-white/6 px-3.5 py-2 text-[14px] outline-none placeholder:text-ink-400 focus:border-sky-400/60"
            />
            {draft ? (
              <button type="submit" className="grid size-10 place-items-center rounded-full bg-sky-500 text-white" aria-label="Send">
                <Send className="size-4" />
              </button>
            ) : (
              <button
                type="button"
                onClick={toggleMic}
                disabled={!canListen()}
                className={`grid size-10 place-items-center rounded-full text-white disabled:opacity-40 ${
                  listening ? 'animate-pulse bg-st-needs' : 'bg-sky-500'
                }`}
                aria-label={listening ? 'Stop listening' : 'Speak'}
                title={canListen() ? 'Tap and answer out loud' : 'Speech recognition needs Chrome'}
              >
                {listening ? <MicOff className="size-4" /> : <Mic className="size-4" />}
              </button>
            )}
          </form>
          {micError && <p className="text-[11px] text-red-300">{micError}</p>}
        </div>
      </div>
    )
  }

  /* ----- Between calls: what the person needs to know right now ----- */
  const card = (() => {
    switch (r.status) {
      case 'needs_help':
      case 'matching':
        return {
          tone: 'from-[#2a1712]',
          icon: <Car className="size-9 text-st-matching" />,
          title: 'Finding a neighbor to pick you up',
          body: 'Stay by the phone. RideOut will call you back as soon as someone is on the way.',
          extra: (
            <div className="mt-5 flex justify-center gap-1.5">
              {[0, 1, 2].map((i) => (
                <span key={i} className="size-2 animate-bounce rounded-full bg-st-matching" style={{ animationDelay: `${i * 150}ms` }} />
              ))}
            </div>
          ),
        }
      case 'helper_assigned': {
        const eta = Math.max(1, Math.round(((r.etaAt ?? t) - t) / 60))
        return {
          tone: 'from-[#0f1d33]',
          icon: <Car className="size-9 text-blue-300" />,
          title: `${helper?.name.split(' ')[0]} is coming`,
          body: helper ? `In a ${helper.vehicle.color} ${helper.vehicle.make}. Please wait by your front door if you can.` : '',
          extra: (
            <div className="mt-6">
              <div className="tabular text-[64px] leading-none font-extrabold text-white">{eta}</div>
              <div className="mt-1 text-[15px] font-medium text-blue-200">minute{eta === 1 ? '' : 's'} away</div>
            </div>
          ),
        }
      }
      case 'picked_up':
        return {
          tone: 'from-[#0f1d33]',
          icon: <Check className="size-9 text-blue-300" />,
          title: "You're on your way",
          body: `Heading to ${EVAC_POINT.name}. Red Cross volunteers will meet you there.`,
        }
      case 'evacuated':
        return {
          tone: 'from-[#0f2418]',
          icon: <ShieldCheck className="size-9 text-st-safe" />,
          title: "You're safe",
          body: `You've arrived at ${EVAC_POINT.name}. Your family has been told.`,
        }
      case 'safe':
        return {
          tone: 'from-[#0f2418]',
          icon: <ShieldCheck className="size-9 text-st-safe" />,
          title: 'Leave now, head west',
          body: `Go downhill toward ${EVAC_POINT.name}. If anything changes, call this number back.`,
        }
      case 'escalated':
        return {
          tone: 'from-[#22122e]',
          icon: <Siren className="size-9 text-st-escalated" />,
          title: r.escalation?.acknowledged ? 'Responders are on the way' : 'Responders have your address',
          body: 'They know you are waiting and what you need. If you are in immediate danger, call 911.',
        }
      case 'no_answer':
        return {
          tone: 'from-[#2a1712]',
          icon: <PhoneMissed className="size-9 text-st-matching" />,
          title: 'Missed call from RideOut',
          body: "We'll call again in a minute.",
        }
      default:
        return null
    }
  })()

  if (card) {
    return (
      <div className={`flex min-h-0 flex-1 flex-col bg-gradient-to-b ${card.tone} to-ink-950`}>
        <div className="flex justify-end px-4 pt-2">{SoundToggle}</div>
        <div className="ro-in flex flex-1 flex-col items-center justify-center px-7 text-center">
          <div className="grid size-18 place-items-center rounded-full bg-white/6">{card.icon}</div>
          <h2 className="mt-5 text-[28px] leading-tight font-bold">{card.title}</h2>
          <p className="mt-3 text-[17px] leading-snug text-ink-200">{card.body}</p>
          {card.extra}
        </div>
        {lastAgent && (
          <div className="mx-4 mb-4 rounded-2xl bg-white/5 p-3.5">
            <div className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold tracking-wide text-ink-400 uppercase">
              <Volume2 className="size-3" /> RideOut said
            </div>
            <p className="text-[14px] leading-snug text-ink-100">{lastAgent.text}</p>
          </div>
        )}
      </div>
    )
  }

  /* ----- Nothing happening: lock screen ----- */
  return (
    <div className="flex flex-1 flex-col items-center px-6 pt-16 text-center">
      <div className="text-[15px] font-medium text-ink-300">Friday, October 24</div>
      <div className="mt-6 max-w-[260px] rounded-2xl bg-white/6 p-4 text-left">
        <div className="flex items-center gap-2 text-[12px] font-semibold text-ink-300">
          <ShieldCheck className="size-4 text-st-safe" /> RIDEOUT
        </div>
        <p className="mt-1.5 text-[14.5px] leading-snug text-ink-100">
          Hi {first}, you're registered. If a fire threatens your home, we'll call this phone. No app needed.
        </p>
      </div>
      {phase === 'activated' && (
        <p className="mt-6 text-[13px] text-ink-400">Your check-in call is coming up…</p>
      )}
    </div>
  )
}
