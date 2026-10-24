import { CONFIG } from '../data/scenario'

/** Sim seconds → wall-clock string, starting at 2:07 AM. */
export function clock(t: number) {
  const start = CONFIG.clockStart.h * 3600 + CONFIG.clockStart.m * 60
  const total = Math.floor(start + t)
  const h24 = Math.floor(total / 3600) % 24
  const m = Math.floor((total % 3600) / 60)
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12
  return `${h12}:${m.toString().padStart(2, '0')} ${h24 < 12 ? 'AM' : 'PM'}`
}

export function minutes(seconds: number) {
  const m = Math.max(0, Math.round(seconds / 60))
  return m < 1 ? '<1 min' : `${m} min`
}
