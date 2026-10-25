import { t } from "spacetimedb/server"
import spacetimedb from "../models"

export const insertProfile = spacetimedb.reducer(
  {
    name: t.string(),
    phone: t.string(),
    lat: t.f64(),
    lng: t.f64(),
    contact_profile_ids: t.array(t.u64()),
  },
  (ctx, { name, phone, lat, lng, contact_profile_ids }) => {
    ctx.db.profile.insert({ id: 0n, name, phone, lat, lng, contact_profile_ids })
  },
)

export const setContacts = spacetimedb.reducer(
  { profile_id: t.u64(), contact_profile_ids: t.array(t.u64()) },
  (ctx, { profile_id, contact_profile_ids }) => {
    const profile = ctx.db.profile.id.find(profile_id)
    if (!profile) throw new Error("Profile not found")
    for (const contactId of contact_profile_ids) {
      if (contactId === profile_id) throw new Error("Profile cannot be its own contact")
      if (!ctx.db.profile.id.find(contactId)) throw new Error("Contact profile not found")
    }
    ctx.db.profile.id.update({ ...profile, contact_profile_ids })
  },
)
