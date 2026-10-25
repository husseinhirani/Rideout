import type { DisclosureFact } from "./information-plan"
/** Shared generic investigation inputs. No incident-specific roles or facts. */
export type AreaFilter = { lat: number; lng: number; radius_m: number }
export type ContactScope = { profile_ids?: number[]; radius?: AreaFilter; related_to_profile_id?: number; tags?: string[] }
export type InformationPolicy = { paused: boolean; max_concurrent_calls: number; max_calls_total: number; max_calls_per_destination: number; min_repeat_ms: number }
export type ProfilePreference = { profile_id: number; call_consent?: boolean; availability?: "unknown" | "available" | "unavailable"; tags?: string[]; location_source?: string; intake_allowed?: boolean }
export type CreateInformationInput = { command_id: string; text: string; objective: string; scope?: ContactScope; area?: AreaFilter; policy?: Partial<InformationPolicy>; preferences?: ProfilePreference[]; coordination_enabled?: boolean; disclosure_facts?: DisclosureFact[] }
export type ConfigureInformationInput = { command_id: string; expected_input_revision: number; objective?: string; scope?: ContactScope; policy?: Partial<InformationPolicy>; preferences?: ProfilePreference[]; coordination_enabled?: boolean; disclosure_facts?: DisclosureFact[] }
export type InputInformationInput = { command_id: string; expected_input_revision: number; text: string }
export type QueueDisposition = { attempt_id: number; disposition: "retain" | "cancel" }
export type RequestInformationCallInput = { command_id: string; expected_input_revision: number; profile_id: number; question: string; context: string; queued?: QueueDisposition[] }
export type InformationCommandResult = { incident_id?: number; support_case_id?: number; input_revision?: number; attempt_id?: number; note_id?: number; status: string }
export type InformationIncidentRow = { id: number; description: string; area: AreaFilter | null; status: string; created_at: string }
export type InformationCaseRow = { id: number; incident_id: number; objective: string; scope: ContactScope; policy: InformationPolicy; input_revision: number; evaluated_revision: number; status: string; brief: string }
export type ProfileSettingsRow = { profile_id: number; call_consent: boolean; availability: "unknown" | "available" | "unavailable"; tags: string[]; location_source: string; intake_allowed: boolean }
export type InformationAttemptRow = { attempt_id: number; decision_command_id: string; authorized_revision: number; report_provider_call_id: string; report_direction: string; binding_status: "unbound" | "pending" | "matched" | "conflict"; terminal_observed_at_ms: number | null; provider_terminal_status: string; provider_end_reason: string; interpretation_failure_count: number; interpretation_retry_at_ms: number | null; interpretation_error: string }
export type DirectoryProfile = { id: number; name: string; phone: string; lat: number; lng: number; contact_profile_ids: number[] }
export type DirectoryQuery = ContactScope & { limit?: number; after_id?: number; eligible_only?: boolean }
export const DEFAULT_INFORMATION_POLICY: InformationPolicy = { paused: false, max_concurrent_calls: 2, max_calls_total: 8, max_calls_per_destination: 3, min_repeat_ms: 30_000 }

export function canonicalJson(value: unknown): string {
  const normalize = (item: unknown): unknown => Array.isArray(item) ? item.map(normalize) : item && typeof item === "object" ? Object.fromEntries(Object.entries(item).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, normalize(v)])) : item
  return JSON.stringify(normalize(value))
}
export function object(value: unknown, name: string): Record<string, unknown> { if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(name + " must be an object"); return value as Record<string, unknown> }
export function text(value: unknown, name: string, max = 10_000): string { if (typeof value !== "string" || !value.trim() || value.length > max) throw new Error(name + " must be nonempty text (max " + max + ")"); return value.trim() }
export function id(value: unknown, name: string): number { if (!Number.isSafeInteger(value) || Number(value) <= 0) throw new Error(name + " must be a positive safe integer"); return Number(value) }
export function revision(value: unknown): number { if (!Number.isSafeInteger(value) || Number(value) < 0) throw new Error("expected_input_revision must be a safe nonnegative integer"); return Number(value) }
export function commandId(value: unknown): string { return text(value, "command_id", 200) }
export function normalizePhone(value: string): string { return value.trim().replace(/[\s().-]/g, "") }
export function dialablePhone(value: string): boolean { return /^\+[1-9]\d{7,14}$/.test(normalizePhone(value)) && !normalizePhone(value).startsWith("+1555555") }
export function areaFilter(value: unknown): AreaFilter {
  const v = object(value, "area"); const lat = Number(v.lat); const lng = Number(v.lng); const radius_m = Number(v.radius_m)
  if (typeof v.lat !== "number" || typeof v.lng !== "number" || typeof v.radius_m !== "number" || !Number.isFinite(lat) || Math.abs(lat) > 90 || !Number.isFinite(lng) || Math.abs(lng) > 180 || !Number.isFinite(radius_m) || radius_m < 0 || radius_m > 1_000_000) throw new Error("Invalid bounded geographic filter")
  return { lat, lng, radius_m }
}
export function contactScope(value: unknown): ContactScope {
  const v = object(value, "scope"); const result: ContactScope = {}
  if (Object.keys(v).some(key => !["profile_ids", "radius", "related_to_profile_id", "tags"].includes(key))) throw new Error("Unknown contact scope field")
  if (v.profile_ids !== undefined) { if (!Array.isArray(v.profile_ids) || v.profile_ids.length > 1000) throw new Error("Invalid profile_ids"); result.profile_ids = [...new Set(v.profile_ids.map(n => id(n, "profile_id")))].sort((a,b) => a-b) }
  if (v.radius !== undefined) result.radius = areaFilter(v.radius)
  if (v.related_to_profile_id !== undefined) result.related_to_profile_id = id(v.related_to_profile_id, "related_to_profile_id")
  if (v.tags !== undefined) { if (!Array.isArray(v.tags) || v.tags.length > 20) throw new Error("Invalid tags"); result.tags = [...new Set(v.tags.map(s => text(s, "tag", 100)))].sort() }
  return result
}
export function informationPolicy(patch: unknown, current = DEFAULT_INFORMATION_POLICY): InformationPolicy {
  const v = object(patch, "policy"); if (Object.keys(v).some(key => !(key in DEFAULT_INFORMATION_POLICY))) throw new Error("Unknown policy field")
  const result = { ...current, ...v } as InformationPolicy
  if (typeof result.paused !== "boolean") throw new Error("paused must be boolean")
  for (const [key, max] of [["max_concurrent_calls", 10], ["max_calls_total", 1000], ["max_calls_per_destination", 100], ["min_repeat_ms", 86_400_000]] as const) if (!Number.isSafeInteger(result[key]) || result[key] < (key === "min_repeat_ms" ? 0 : 1) || result[key] > max) throw new Error("Invalid " + key)
  return result
}
export function profilePreferences(value: unknown): ProfilePreference[] {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.length > 1000) throw new Error("Invalid preferences")
  const seen = new Set<number>()
  return value.map(raw => {
    const v = object(raw, "preference"); const result: ProfilePreference = { profile_id: id(v.profile_id, "profile_id") }
    if (seen.has(result.profile_id)) throw new Error("Duplicate profile preference"); seen.add(result.profile_id)
    for (const key of ["call_consent", "intake_allowed"] as const) if (v[key] !== undefined) { if (typeof v[key] !== "boolean") throw new Error(key + " must be boolean"); result[key] = v[key] }
    if (v.availability !== undefined) { if (!["unknown", "available", "unavailable"].includes(String(v.availability))) throw new Error("Invalid availability"); result.availability = v.availability as ProfilePreference["availability"] }
    if (v.tags !== undefined) result.tags = contactScope({ tags: v.tags }).tags
    if (v.location_source !== undefined) result.location_source = text(v.location_source, "location_source", 500)
    return result
  })
}
export function distanceMeters(a: AreaFilter, lat: number, lng: number): number {
  const rad = (v: number) => v * Math.PI / 180
  const h = Math.sin(rad(lat-a.lat)/2)**2 + Math.cos(rad(a.lat))*Math.cos(rad(lat))*Math.sin(rad(lng-a.lng)/2)**2
  return 2 * 6_371_000 * Math.asin(Math.min(1, Math.sqrt(h)))
}
export function matchesScope(profile: DirectoryProfile, scope: ContactScope, profiles: DirectoryProfile[], settings?: ProfileSettingsRow): boolean {
  return (scope.profile_ids === undefined || scope.profile_ids.includes(profile.id)) && (!scope.radius || distanceMeters(scope.radius, profile.lat, profile.lng) <= scope.radius.radius_m) && (scope.related_to_profile_id === undefined || !!profiles.find(p => p.id === scope.related_to_profile_id)?.contact_profile_ids.includes(profile.id)) && (!scope.tags?.length || scope.tags.every(tag => settings?.tags.includes(tag)))
}
export function contactEligibility(profile: DirectoryProfile, settings?: ProfileSettingsRow): string[] {
  const reasons: string[] = []
  if (!settings?.call_consent) reasons.push("Call consent is not recorded")
  if (settings?.availability === "unavailable") reasons.push("Contact is unavailable")
  if (!dialablePhone(profile.phone)) reasons.push("No dialable phone number")
  return reasons
}
