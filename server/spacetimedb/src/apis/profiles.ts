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
