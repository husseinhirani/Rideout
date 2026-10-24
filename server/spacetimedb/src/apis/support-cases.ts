import { t } from "spacetimedb/server"
import spacetimedb, { ACCEPTED, CONTACTING, DECLINED, NO_ANSWER, OPEN } from "../models"

export const recordAttempt = spacetimedb.reducer(
  { support_case_id: t.u64(), profile_id: t.u64(), outcome: t.string() },
  (ctx, { support_case_id, profile_id, outcome }) => {
    if (outcome !== "" && outcome !== ACCEPTED && outcome !== DECLINED && outcome !== NO_ANSWER) {
      throw new Error("outcome must be accepted, declined, no_answer, or empty")
    }
    const current = ctx.db.supportCase.id.find(support_case_id)
    if (!current) throw new Error("Support case not found")
    if (!ctx.db.profile.id.find(profile_id)) throw new Error("Profile not found")
    const attempts = [...ctx.db.attempt.support_case_id.filter(support_case_id)]
    const open = attempts.find((row) => row.profile_id === profile_id && row.outcome === undefined)
    if (outcome === "") {
      if (current.status === ACCEPTED) throw new Error("Support case is already accepted")
      if (open || attempts.some((row) => row.outcome === undefined)) {
        throw new Error("Support case already has an open attempt")
      }
      ctx.db.attempt.insert({ id: 0n, support_case_id, profile_id, outcome: undefined })
      if (current.status === OPEN) {
        ctx.db.supportCase.id.update({ ...current, status: CONTACTING })
      }
      return
    }
    if (outcome === ACCEPTED && current.helper_profile_id !== undefined && current.helper_profile_id !== profile_id) {
      throw new Error("Support case already has a helper")
    }
    if (open) {
      ctx.db.attempt.id.update({ ...open, outcome })
    } else {
      ctx.db.attempt.insert({ id: 0n, support_case_id, profile_id, outcome })
    }
    if (outcome === ACCEPTED) {
      ctx.db.supportCase.id.update({
        ...current,
        helper_profile_id: profile_id,
        status: ACCEPTED,
      })
    }
  },
)

export const setCallId = spacetimedb.reducer(
  { support_case_id: t.u64(), call_id: t.string() },
  (ctx, { support_case_id, call_id }) => {
    const current = ctx.db.supportCase.id.find(support_case_id)
    if (!current) throw new Error("Support case not found")
    ctx.db.supportCase.id.update({
      ...current,
      call_id: call_id.length === 0 ? undefined : call_id,
    })
  },
)
