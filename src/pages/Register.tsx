import L from 'leaflet'
import { CheckCircle2, ExternalLink, HeartHandshake, Phone, UserRound } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { MapContainer, Marker, Polygon, useMapEvents } from 'react-leaflet'
import BaseTiles from '../components/BaseTiles'
import { LANGUAGE_LABEL, NEED_LABEL, ZONE } from '../data/scenario'
import type { LatLng } from '../lib/geo'
import TopBar from '../components/TopBar'
import { NEED_ICON } from '../components/ui'
import { dispatch } from '../store/store'
import type { Language, Need } from '../types'

const pinIcon = L.divIcon({
  className: '',
  iconSize: [40, 40],
  iconAnchor: [20, 20],
  html: '<div class="ro-pin" style="--c:#38bdf8"><span class="pulse"></span><span class="dot"></span></div>',
})

function Clicks({ onChange }: { onChange: (p: LatLng) => void }) {
  useMapEvents({ click: (e) => onChange([+e.latlng.lat.toFixed(5), +e.latlng.lng.toFixed(5)]) })
  return null
}

function LocationPicker({ value, onChange }: { value: LatLng; onChange: (p: LatLng) => void }) {
  return (
    <div className="h-56 overflow-hidden rounded-xl border border-ink-600">
      <MapContainer center={ZONE.center} zoom={15} className="h-full w-full" attributionControl={false}>
        <BaseTiles />
        <Polygon positions={ZONE.polygon} pathOptions={{ color: '#5d6775', weight: 1, dashArray: '6 6', fillOpacity: 0.03 }} />
        <Marker position={value} icon={pinIcon} />
        <Clicks onChange={onChange} />
      </MapContainer>
    </div>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="text-[13px] font-semibold text-ink-200">{label}</span>
      {hint && <span className="ml-2 text-[12px] text-ink-400">{hint}</span>}
      <div className="mt-1.5">{children}</div>
    </label>
  )
}

const input =
  'w-full rounded-lg border border-ink-600 bg-ink-800 px-3 py-2.5 text-[15px] text-ink-100 outline-none placeholder:text-ink-500 focus:border-sky-400/70'

function Toggle({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-[14px] font-medium transition ${
        on ? 'border-sky-400/70 bg-sky-400/12 text-sky-100' : 'border-ink-600 bg-ink-800 text-ink-300 hover:text-ink-100'
      }`}
    >
      {children}
    </button>
  )
}

const slug = (name: string) =>
  name.toLowerCase().replace(/[^a-z]+/g, '-').replace(/^-|-$/g, '').slice(0, 20) + '-' + Math.random().toString(36).slice(2, 6)

type Done = { kind: 'resident' | 'helper'; id: string; name: string }

function ResidentForm({ onDone }: { onDone: (d: Done) => void }) {
  const [by, setBy] = useState<'self' | 'family' | 'center' | 'neighbor'>('family')
  const [registrant, setRegistrant] = useState('')
  const [name, setName] = useState('')
  const [age, setAge] = useState('')
  const [phone, setPhone] = useState('')
  const [address, setAddress] = useState('')
  const [language, setLanguage] = useState<Language>('en')
  const [needs, setNeeds] = useState<Need[]>(['no_car'])
  const [livesAlone, setLivesAlone] = useState(true)
  const [notes, setNotes] = useState('')
  const [pos, setPos] = useState<LatLng>([37.8628, -122.2412])

  const toggleNeed = (n: Need) => setNeeds((cur) => (cur.includes(n) ? cur.filter((x) => x !== n) : [...cur, n]))
  const byLabel = { self: 'Self (web)', family: 'Family', center: 'Senior center', neighbor: 'Neighbor' }[by]

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        const id = slug(name)
        dispatch('registerResident', {
          id,
          name: name.trim(),
          age: Number(age) || 0,
          phone: phone || '(510) 555-0100',
          address: address || 'Pinned on map',
          pos,
          language,
          needs,
          livesAlone,
          notes: notes || undefined,
          registeredBy: by === 'self' ? byLabel : `${byLabel}${registrant ? ` · ${registrant}` : ''}`,
          live: true,
        })
        onDone({ kind: 'resident', id, name })
      }}
      className="space-y-5"
    >
      <Field label="Who is registering?">
        <div className="flex flex-wrap gap-2">
          {(['self', 'family', 'center', 'neighbor'] as const).map((k) => (
            <Toggle key={k} on={by === k} onClick={() => setBy(k)}>
              {{ self: 'Myself', family: 'A family member', center: 'Senior center / caregiver', neighbor: 'A neighbor' }[k]}
            </Toggle>
          ))}
        </div>
      </Field>
      {by !== 'self' && (
        <Field label="Your name">
          <input className={input} value={registrant} onChange={(e) => setRegistrant(e.target.value)} placeholder="Grace Chen" />
        </Field>
      )}

      <div className="grid grid-cols-[1fr_110px] gap-3">
        <Field label="Resident's name">
          <input className={input} required value={name} onChange={(e) => setName(e.target.value)} placeholder="Margaret Chen" />
        </Field>
        <Field label="Age">
          <input className={input} inputMode="numeric" value={age} onChange={(e) => setAge(e.target.value)} placeholder="84" />
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Phone we should call" hint="landline is fine">
          <input className={input} value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(510) 555-0142" />
        </Field>
        <Field label="Language for the call">
          <select className={input} value={language} onChange={(e) => setLanguage(e.target.value as Language)}>
            {Object.entries(LANGUAGE_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <Field label="Home address">
        <input className={input} value={address} onChange={(e) => setAddress(e.target.value)} placeholder="2814 Gravatt Dr" />
      </Field>
      <Field label="Pin the home" hint="click the map">
        <LocationPicker value={pos} onChange={setPos} />
      </Field>

      <Field label="What would make leaving hard?">
        <div className="flex flex-wrap gap-2">
          {(Object.keys(NEED_LABEL) as Need[]).map((n) => {
            const Icon = NEED_ICON[n]
            return (
              <Toggle key={n} on={needs.includes(n)} onClick={() => toggleNeed(n)}>
                <Icon className="size-4" /> {NEED_LABEL[n]}
              </Toggle>
            )
          })}
          <Toggle on={livesAlone} onClick={() => setLivesAlone(!livesAlone)}>
            <UserRound className="size-4" /> Lives alone
          </Toggle>
        </div>
      </Field>

      <Field label="Anything a helper should know?">
        <textarea
          className={`${input} min-h-20`}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Daughter has the car on weeknights. Keeps a go-bag by the door."
        />
      </Field>

      <button type="submit" className="w-full rounded-xl bg-fire py-3.5 text-[16px] font-bold text-ink-950 hover:brightness-110">
        Register {name.split(' ')[0] || 'resident'}
      </button>
    </form>
  )
}

function HelperForm({ onDone }: { onDone: (d: Done) => void }) {
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [address, setAddress] = useState('')
  const [make, setMake] = useState('')
  const [color, setColor] = useState('gray')
  const [seats, setSeats] = useState(2)
  const [wheelchair, setWheelchair] = useState(false)
  const [petsOk, setPetsOk] = useState(true)
  const [languages, setLanguages] = useState<Language[]>(['en'])
  const [pos, setPos] = useState<LatLng>([37.8605, -122.2365])

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        const id = slug(name)
        dispatch('registerHelper', {
          id,
          name: name.trim(),
          phone: phone || '(510) 555-0200',
          address: address || 'Pinned on map',
          home: pos,
          languages,
          vehicle: { make: make || 'Car', color, seats, wheelchair, petsOk },
          live: true,
        })
        onDone({ kind: 'helper', id, name })
      }}
      className="space-y-5"
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label="Your name">
          <input className={input} required value={name} onChange={(e) => setName(e.target.value)} placeholder="Daniel Reyes" />
        </Field>
        <Field label="Phone">
          <input className={input} value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(510) 555-0210" />
        </Field>
      </div>
      <Field label="Home address">
        <input className={input} value={address} onChange={(e) => setAddress(e.target.value)} placeholder="2860 Gravatt Dr" />
      </Field>
      <Field label="Pin your home" hint="we use it to see who's on your way out">
        <LocationPicker value={pos} onChange={setPos} />
      </Field>
      <div className="grid grid-cols-[1fr_140px_110px] gap-3">
        <Field label="Car">
          <input className={input} value={make} onChange={(e) => setMake(e.target.value)} placeholder="Honda CR-V" />
        </Field>
        <Field label="Color">
          <select className={input} value={color} onChange={(e) => setColor(e.target.value)}>
            {['gray', 'white', 'black', 'blue', 'red', 'green'].map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </Field>
        <Field label="Free seats">
          <input className={input} type="number" min={1} max={7} value={seats} onChange={(e) => setSeats(Number(e.target.value))} />
        </Field>
      </div>
      <Field label="What can your car take?">
        <div className="flex flex-wrap gap-2">
          <Toggle on={wheelchair} onClick={() => setWheelchair(!wheelchair)}>
            Folding wheelchair
          </Toggle>
          <Toggle on={petsOk} onClick={() => setPetsOk(!petsOk)}>
            Pets
          </Toggle>
        </div>
      </Field>
      <Field label="Languages you speak">
        <div className="flex flex-wrap gap-2">
          {(Object.keys(LANGUAGE_LABEL) as Language[]).map((l) => (
            <Toggle
              key={l}
              on={languages.includes(l)}
              onClick={() => setLanguages((cur) => (cur.includes(l) ? cur.filter((x) => x !== l) : [...cur, l]))}
            >
              {LANGUAGE_LABEL[l]}
            </Toggle>
          ))}
        </div>
      </Field>
      <p className="rounded-lg bg-ink-800 px-3.5 py-3 text-[13px] leading-relaxed text-ink-300">
        We'll only ask during an evacuation, only for someone whose home is on your route out, and never toward the fire. You can
        always say no.
      </p>
      <button type="submit" className="w-full rounded-xl bg-st-safe py-3.5 text-[16px] font-bold text-ink-950 hover:brightness-110">
        Sign up as a helper
      </button>
    </form>
  )
}

export default function Register() {
  const [tab, setTab] = useState<'resident' | 'helper'>('resident')
  const [done, setDone] = useState<Done>()

  return (
    <div className="flex h-full flex-col">
      <TopBar />
      <main className="scroll-thin min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto grid max-w-5xl grid-cols-[1fr_300px] gap-10 px-6 py-10 max-lg:grid-cols-1">
          <div>
            <h1 className="text-[30px] leading-tight font-extrabold tracking-tight">Get ready before the fire.</h1>
            <p className="mt-2 max-w-xl text-[16px] text-ink-300">
              Register someone who might not be able to leave on their own, or sign up to give a neighbor a ride on your way out.
            </p>

            <div className="mt-7 flex gap-2">
              {(
                [
                  ['resident', 'Register a resident', UserRound],
                  ['helper', 'Become a helper', HeartHandshake],
                ] as const
              ).map(([id, label, Icon]) => (
                <button
                  key={id}
                  onClick={() => {
                    setTab(id)
                    setDone(undefined)
                  }}
                  className={`flex items-center gap-2 rounded-xl border px-4 py-2.5 text-[14px] font-semibold ${
                    tab === id ? 'border-ink-400 bg-ink-700 text-ink-100' : 'border-ink-700 text-ink-400 hover:text-ink-200'
                  }`}
                >
                  <Icon className="size-4" /> {label}
                </button>
              ))}
            </div>

            <div className="mt-6">
              {done ? (
                <div className="ro-in rounded-2xl border border-st-safe/40 bg-st-safe/8 p-6">
                  <CheckCircle2 className="size-8 text-st-safe" />
                  <h2 className="mt-3 text-[22px] font-bold">{done.name} is registered.</h2>
                  <p className="mt-1 text-[15px] text-ink-300">
                    {done.kind === 'resident'
                      ? 'They now appear on the command center map. If the zone activates, the AI agent calls them first thing.'
                      : "You're on the map as a possible helper for this zone."}
                  </p>
                  <div className="mt-4 flex flex-wrap gap-3">
                    <a
                      href={`/${done.kind}/${done.id}`}
                      target="_blank"
                      className="flex items-center gap-1.5 rounded-lg bg-ink-700 px-3 py-2 text-[13px] font-semibold text-ink-100"
                    >
                      <ExternalLink className="size-3.5" /> Open their demo phone
                    </a>
                    <button onClick={() => setDone(undefined)} className="rounded-lg px-3 py-2 text-[13px] font-semibold text-ink-300">
                      Register another
                    </button>
                  </div>
                </div>
              ) : tab === 'resident' ? (
                <ResidentForm onDone={setDone} />
              ) : (
                <HelperForm onDone={setDone} />
              )}
            </div>
          </div>

          <aside className="space-y-4 pt-2 max-lg:order-first">
            <div className="rounded-2xl border border-ink-700 bg-ink-850 p-5">
              <Phone className="size-5 text-fire" />
              <h3 className="mt-2 text-[15px] font-bold">No internet? Call instead.</h3>
              <p className="mt-1 text-[13.5px] leading-relaxed text-ink-300">
                Residents can register by phone in English, Spanish, Vietnamese or Cantonese. Senior centers can register people in bulk.
              </p>
            </div>
            <div className="rounded-2xl border border-ink-700 bg-ink-850 p-5 text-[13.5px] leading-relaxed text-ink-300">
              <h3 className="text-[15px] font-bold text-ink-100">What happens in a fire</h3>
              <ol className="mt-2 list-decimal space-y-1.5 pl-4">
                <li>Satellites spot the fire near your zone.</li>
                <li>An AI voice agent calls each resident: “Are you able to leave right now?”</li>
                <li>If not, it asks a registered neighbor who is already driving out.</li>
                <li>The resident hears who's coming, and in what car.</li>
                <li>If nobody can help in time, responders get the address and needs.</li>
              </ol>
            </div>
          </aside>
        </div>
      </main>
    </div>
  )
}
