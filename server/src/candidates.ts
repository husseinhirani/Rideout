export function nextCandidate(input: {
  victimProfileId: number
  contactProfileIds: number[]
  safeProfileIds: number[]
  attemptedProfileIds: number[]
}): number | null {
  const safe = new Set(input.safeProfileIds)
  const attempted = new Set(input.attemptedProfileIds)
  const eligible = (id: number) =>
    id !== input.victimProfileId && safe.has(id) && !attempted.has(id)
  for (const id of input.contactProfileIds) {
    if (eligible(id)) return id
  }
  for (const id of input.safeProfileIds) {
    if (eligible(id)) return id
  }
  return null
}
