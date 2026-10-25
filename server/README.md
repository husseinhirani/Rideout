# Running the backend

The current startup instructions are in the root [team setup and testing guide](../docs/team-setup.md).
Use that guide for parallel calls, live transcripts, coordinator chat, assistance proposals,
and returning callers. It includes the private roster and complete environment template.

From the repository root:

```bash
npm --prefix server ci
npm --prefix server run server
```

The API requires a published SpacetimeDB module and configured credentials. It listens on
127.0.0.1:8787; the local test console is at 127.0.0.1:8788. Run `setup-agent` only after the
API and its HTTPS callback tunnel are available. The operator and callback secrets are
required for live mode and must differ. Do not expose the operator console through ngrok.

| Root command | Purpose |
| --- | --- |
| `npm --prefix server run configure-drill` | Save ignored roster JSON through the operator API; does not dial |
| `npm --prefix server run setup-agent` | Check callback compatibility, update hosted tools and instructions; does not dial |
| `npm --prefix server run server` | Start API and workers; existing authorized work can resume |
| `npm --prefix server run server:adaptive:sim` | Real Claude with simulated phones; still needs DB/configuration/model access |
| `npm --prefix server run check` | Typecheck API and module |
| `npm run build` | Typecheck and build dispatcher UI |

Do not run `dev-clean-db` for normal setup or updates: it deletes the database. Use
`spacetime publish ... --delete-data=never` as documented in the team guide. The general
`seed` command loads an empty directory from `mock/profiles.json`; it is not required by
the saved drill-roster flow. Retired recording demos and older missing-child scripts do
not represent the current live startup path.

For API details see [INFORMATION-API.md](INFORMATION-API.md); for architecture see the
root [ADRs](../docs/adr/). For live demonstration steps see
[assistance-demo.md](../docs/assistance-demo.md).
