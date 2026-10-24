import { CarFront, Check, Clock, HeartHandshake, MapPin, Navigation, Phone, TriangleAlert, X } from 'lucide-react'
import { EVAC_POINT, ZONE } from '../data/scenario'
import MapView from '../components/MapView'
import { NeedTags } from '../components/ui'
import { blocksAway, distanceM } from '../lib/geo'
import { dispatch, minutes, useSim } from '../store/store'
import type { Need } from '../types'

const TIPS: Partial<Record<Need, string>> = {
  walker: 'Uses a walker. It folds; put it in the back.',
  wheelchair: 'Folding wheelchair. Help with the transfer to the front seat.',
  oxygen: 'Portable oxygen. Keep it upright, and no smoking in the car.',
  pets: 'Bringing a pet. Have them ready on a leash.',
  hearing: 'Hard of hearing. Face them and speak slowly.',
  vision: 'Low vision. Offer your arm and talk them to the car.',
}

function Countdown({ until }: { until: number }) {
  const t = useSim((s) => s.t)
  const s = Math.max(0, Math.ceil(until - t))
  return (
    <span className="tabular">
      {Math.floor(s / 60)}:{(s % 60).toString().padStart(2, '0')}
    </span>
  )
}

export default function HelperPhone({ id }: { id: string }) {
  const h = useSim((s) => s.helpers[id])
  const offers = useSim((s) => s.offers)
  const residents = useSim((s) => s.residents)
  const t = useSim((s) => s.t)
  if (!h) return <div className="p-6 text-ink-300">Helper not found.</div>

  const first = h.name.split(' ')[0]
  const offer = h.offerId ? offers[h.offerId] : undefined
  const tripResident = h.trip ? residents[h.trip.residentId] : undefined

  /* ----- A neighbor needs a ride ----- */
  if (h.status === 'asked' && offer) {
    const r = residents[offer.residentId]
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="bg-st-matching/15 px-5 pt-2 pb-3">
          <div className="flex items-center justify-between text-[11px] font-bold tracking-wider text-st-matching uppercase">
            <span className="flex items-center gap-1.5">
              <HeartHandshake className="size-3.5" /> RideOut · neighbor needs a ride
            </span>
            <span className="flex items-center gap-1">
              <Clock className="size-3" />
              <Countdown until={offer.expiresAt} />
            </span>
          </div>
          <p className="ro-in mt-2 text-[19px] leading-snug font-semibold text-white">{offer.message}</p>
        </div>
        <div className="relative min-h-0 flex-1">
          <MapView variant="phone" focus={{ helperId: h.id, residentId: r.id }} />
        </div>
        <div className="space-y-3 px-5 pt-3 pb-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-[16px] font-bold">
                {r.name}, {r.age}
              </div>
              <div className="mt-0.5 flex items-center gap-1 text-[13px] text-ink-300">
                <MapPin className="size-3.5" /> {r.address} · {blocksAway(distanceM(h.home, r.pos))}
              </div>
            </div>
            <div className="text-right">
              <div className="tabular text-[20px] leading-none font-extrabold text-st-matching">+{offer.detourMin}</div>
              <div className="text-[11px] text-ink-400">min detour</div>
            </div>
          </div>
          <NeedTags needs={r.needs} />
          <div className="grid grid-cols-[1fr_2fr] gap-2">
            <button
              onClick={() => dispatch('respondToOffer', offer.id, false, "Can't right now")}
              className="flex items-center justify-center gap-1.5 rounded-2xl bg-ink-700 py-3.5 text-[15px] font-semibold text-ink-200"
            >
              <X className="size-4" /> Can't
            </button>
            <button
              onClick={() => dispatch('respondToOffer', offer.id, true)}
              className="ro-halo flex items-center justify-center gap-1.5 rounded-2xl bg-st-safe py-3.5 text-[15px] font-bold text-ink-950"
            >
              <Check className="size-5" strokeWidth={3} /> Yes, I'll get {r.name.split(' ')[0]}
            </button>
          </div>
        </div>
      </div>
    )
  }

  /* ----- Driving ----- */
  if ((h.status === 'en_route' || h.status === 'carrying') && tripResident && h.trip) {
    const r = tripResident
    const trip = h.trip
    const pickupAt = trip.startedAt + trip.prepS + trip.leg1S
    const arriveAt = pickupAt + trip.boardS + trip.leg2S
    const toPickup = h.status === 'en_route' && r.status === 'helper_assigned'
    const tips = r.needs.map((n) => TIPS[n]).filter(Boolean)

    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="bg-st-assigned px-5 pt-2 pb-3 text-white">
          <div className="flex items-center gap-2 text-[12px] font-semibold opacity-80">
            <Navigation className="size-3.5" /> {toPickup ? 'Pick up' : r.status === 'picked_up' && h.status === 'en_route' ? 'Boarding' : 'Drive to'}
          </div>
          <div className="mt-0.5 text-[21px] leading-tight font-bold">
            {toPickup ? r.address : r.status === 'picked_up' && h.status === 'en_route' ? `Helping ${r.name.split(' ')[0]} in` : EVAC_POINT.name}
          </div>
          <div className="mt-1 text-[13px] opacity-85">
            {toPickup ? `${r.name}, ${r.age} · ${minutes(pickupAt - t)}` : `${EVAC_POINT.detail} · ${minutes(arriveAt - t)}`}
          </div>
        </div>
        <div className="relative min-h-0 flex-1">
          <MapView variant="phone" focus={{ helperId: h.id, residentId: r.id }} />
        </div>
        <div className="space-y-2.5 px-5 pt-3 pb-4">
          {toPickup && (
            <>
              <p className="text-[13.5px] text-ink-200">
                {r.name.split(' ')[0]} knows you're coming in a {h.vehicle.color} {h.vehicle.make}.
              </p>
              {tips.map((tip) => (
                <p key={tip} className="flex gap-2 text-[13px] text-ink-300">
                  <span className="text-blue-300">•</span> {tip}
                </p>
              ))}
              <button className="flex w-full items-center justify-center gap-2 rounded-2xl bg-ink-700 py-3 text-[14px] font-semibold">
                <Phone className="size-4" /> Call {r.name.split(' ')[0]}
              </button>
            </>
          )}
          {!toPickup && (
            <p className="text-[13.5px] text-ink-200">
              Stay on the route shown. It keeps at least half a kilometer from the fire.
            </p>
          )}
        </div>
      </div>
    )
  }

  /* ----- Done ----- */
  if (h.status === 'evacuated') {
    const helped = Object.values(residents).find((r) => r.helperId === h.id)
    return (
      <div className="ro-in flex flex-1 flex-col items-center justify-center bg-gradient-to-b from-[#0f2418] to-ink-950 px-7 text-center">
        <div className="grid size-18 place-items-center rounded-full bg-st-safe/15">
          <HeartHandshake className="size-9 text-st-safe" />
        </div>
        <h2 className="mt-5 text-[26px] leading-tight font-bold">{helped ? `You got ${helped.name.split(' ')[0]} out.` : "You're out."}</h2>
        <p className="mt-3 text-[16px] text-ink-200">Thank you, {first}. Check in with the Red Cross volunteers at {EVAC_POINT.name}.</p>
      </div>
    )
  }

  /* ----- Evacuation warning, available to help ----- */
  if (h.status === 'leaving') {
    return (
      <div className="flex flex-1 flex-col bg-gradient-to-b from-[#3a1209] to-ink-950 px-5 pt-6">
        <div className="ro-in rounded-2xl border border-fire/40 bg-fire/12 p-4">
          <div className="flex items-center gap-2 text-[12px] font-bold tracking-wider text-fire uppercase">
            <TriangleAlert className="size-4" /> Evacuation warning
          </div>
          <p className="mt-2 text-[20px] leading-snug font-bold">Zone {ZONE.id} ({ZONE.name}). Leave now.</p>
          <p className="mt-1.5 text-[14px] text-ink-200">Head west toward {EVAC_POINT.name}.</p>
        </div>
        <div className="mt-4 rounded-2xl bg-white/5 p-4">
          <div className="flex items-center gap-2 text-[13px] font-semibold text-ink-200">
            <HeartHandshake className="size-4 text-st-safe" /> Keep this screen open
          </div>
          <p className="mt-1.5 text-[14px] leading-snug text-ink-300">
            If a neighbor on your way out can't leave, we'll ask you here. You can always say no.
          </p>
        </div>
        <div className="mt-auto mb-6 flex items-center gap-3 rounded-2xl bg-white/5 p-3.5">
          <CarFront className="size-5 text-ink-300" />
          <div className="text-[13px] text-ink-300">
            <span className="capitalize">{h.vehicle.color}</span> {h.vehicle.make} · {h.vehicle.seats} free seat
            {h.vehicle.seats === 1 ? '' : 's'}
          </div>
        </div>
      </div>
    )
  }

  /* ----- Calm times ----- */
  return (
    <div className="flex flex-1 flex-col px-5 pt-10">
      <div className="text-[13px] font-semibold text-ink-400">RideOut helper</div>
      <h2 className="mt-1 text-[26px] leading-tight font-bold">Hi {first}. You're on the list.</h2>
      <p className="mt-3 text-[15px] leading-snug text-ink-300">
        During an evacuation, we'll only ask you to pick up a neighbor whose home is on your way out, never toward the fire.
      </p>
      <div className="mt-6 space-y-2 rounded-2xl bg-white/5 p-4 text-[14px]">
        <div className="flex justify-between">
          <span className="text-ink-400">Car</span>
          <span className="capitalize">
            {h.vehicle.color} {h.vehicle.make}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-ink-400">Free seats</span>
          <span>{h.vehicle.seats}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-ink-400">Fits a wheelchair</span>
          <span>{h.vehicle.wheelchair ? 'Yes' : 'No'}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-ink-400">Pets OK</span>
          <span>{h.vehicle.petsOk ? 'Yes' : 'No'}</span>
        </div>
      </div>
    </div>
  )
}
