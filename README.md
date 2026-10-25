<div align="center">
  <img src="mascot.jpg" alt="Sealert mascot" width="180" />
  <h1>Sealert</h1>
  <p><em>A dispatcher's reliable sidekick</em></p>
  <p>
    <a href="#run-the-live-product">Live setup</a> ·
    <a href="#cartesia">Cartesia</a> ·
    <a href="#spacetimedb">SpacetimeDB</a> ·
    <a href="#claude">Claude</a> ·
    <a href="docs/team-setup.md#updates-and-troubleshooting">Troubleshooting</a>
  </p>
</div>

Sealert helps dispatchers collect information and coordinate a community response during an emergency. It gathers updates from neighbors by phone and organizes reports, needs, and follow-up actions in a shared live map, giving dispatchers a clearer view of what is happening and where help may be needed. Example scenarios include locating a missing child and checking on residents during a wildfire. Sealert uses Cartesia voice agents for phone conversations, Claude to interpret reports and help plan follow-up, and SpacetimeDB to keep coordination state shared and up to date.

## Run the live product

Follow the [team setup and testing guide](docs/team-setup.md) for a fresh machine or an
existing checkout. It covers dependencies, private credentials, database publication,
participant registration, hosted voice setup, and a complete rehearsal.

You need Node.js 24/npm, SpacetimeDB 2.13.0, ngrok, Cartesia agent/number access, and an
Anthropic API key with available credits. Install the application packages from the
repository root:

```bash
npm ci
npm --prefix server ci
```

Copy `.env.sample` to ignored `.env.local` and fill in credentials. The guide starts the
database, publishes without deleting data, starts the API and tunnel, then configures
the hosted agent. This order matters: agent setup checks the running callback API first.

Save consenting participants with `npm --prefix server run configure-drill`, using the
private roster format in the guide. Start Vite with `npm run dev` and open
**http://127.0.0.1:5173**. **Start → Wildfire drill** initiates the calls; setup alone does
not. The [assistance walkthrough](docs/assistance-demo.md) explains what to expect.

Git transfers source and fixtures, not credentials, real phone numbers, local database
history, or provider configuration. Teammates running independently need their own
configured environment. Do not use the historical database-wipe scripts for updates.

## Sponsor tracks

### Cartesia

Cartesia powers the product's outbound voice conversations: its hosted agent calls neighbors, asks context-specific check-in questions, and sends structured reports back to Sealert. Voice is the way neighbors participate hands-free, while the dispatcher sees call progress and reports in the live dashboard.

- Emergency check-ins are completed in a natural phone conversation, so neighbors can respond without opening the app.
- Claude-generated questions and case context are passed to the agent for each call, making conversations relevant to the incident.
- Call status and structured reports flow back through authenticated webhooks into the live case, keeping dispatchers informed as calls finish.
- The flow supports people who cannot use the dashboard during an emergency; dispatchers can review outcomes, stop coordination, and handle calls themselves when needed.

### SpacetimeDB

SpacetimeDB is Sealert's persistent coordination store. Its module holds the shared incident, case, profile, call, and report state that the backend and live dashboard read and update.

- Keeps incident and case updates available to the dispatcher dashboard as the response changes.
- Stores neighbor profiles and their check-in/call outcomes alongside the incident they relate to.
- Tracks incoming requests and reports so new information can inform follow-up coordination.
- Applies coordination changes through module reducers, giving the backend a single persisted view of response state.

### Claude

Claude interprets incident descriptions and call reports, then helps Sealert plan relevant follow-up questions and outreach. Its structured outputs connect conversational input to the case state the dispatcher sees.

- Turns a dispatcher's plain-language incident description into structured incident details.
- Extracts useful facts and locations from a neighbor's phone report for the case timeline and map.
- Re-evaluates follow-up questions and outreach when the case gains new information or the dispatcher adds direction.
- Uses bounded, structured responses so the coordinator can validate plans and keep the dispatcher in control of decisions.


---

This is an emergency coordination aid, not an emergency service. It does not call 911 or replace dispatcher judgment; information from callers may be incomplete or unverified.
