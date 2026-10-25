<div align="center">
  <img src="mascot.jpg" alt="Sealert mascot" width="180" />
  <h1>Sealert</h1>
  <p><em>A dispatcher's reliable sidekick</em></p>
  <p>
    <a href="#run-the-live-product">Live setup</a> ·
    <a href="#cartesia">Cartesia</a> ·
    <a href="#spacetimedb">SpacetimeDB</a> ·
    <a href="#claude">Claude</a> ·
    <a href="#known-limitations">Limitations</a>
  </p>
</div>

Sealert helps dispatchers collect information and coordinate a community response during an emergency. It gathers updates from neighbors by phone and organizes reports, needs, and follow-up actions in a shared live map, giving dispatchers a clearer view of what is happening and where help may be needed. Example scenarios include locating a missing child and checking on residents during a wildfire. Sealert uses Cartesia voice agents for phone conversations, Claude to interpret reports and help plan follow-up, and SpacetimeDB to keep coordination state shared and up to date.

## Setup Sealert live

### 1. Install the prerequisites

- Install [Node.js 22.12 or newer](https://nodejs.org/en/download/). This includes `npm`.
- Install the [SpacetimeDB CLI](https://spacetimedb.com/install). On macOS or Linux, the official installer is:

  ```sh
  curl -sSf https://install.spacetimedb.com | sh
  ```

  Open a new terminal and check that it is installed:

  ```sh
  spacetime --version
  ```

- Install [ngrok](https://ngrok.com/download). On macOS with Homebrew:

  ```sh
  brew install ngrok
  ```

  For other systems, follow ngrok's [installation guide](https://ngrok.com/docs/agent/). Create or sign in to an [ngrok account](https://dashboard.ngrok.com/signup), then open [Your Authtoken](https://dashboard.ngrok.com/get-started/your-authtoken) and run the `ngrok config add-authtoken ...` command shown there.

  In the ngrok dashboard, open [Domains](https://dashboard.ngrok.com/domains) and copy the Dev Domain assigned to your account. Use its full HTTPS URL as `NGROK_URL`. The assigned Dev Domain stays the same when ngrok restarts, so Cartesia's webhook URLs remain valid. See ngrok's [domain guide](https://ngrok.com/docs/gateway/domains/).

### 2. Prepare Cartesia

1. Sign in to [Cartesia Playground](https://play.cartesia.ai/). Create a **Managed Agent** and configure its voice and an available LLM. Sealert's setup command will install the agent instructions and webhook tools, so you do not need to write those yourself. See [Managed Agents](https://docs.cartesia.ai/agents/introduction) and [LLM configuration](https://docs.cartesia.ai/agents/models).
2. Open [Cartesia API keys](https://play.cartesia.ai/keys) and create an API key for this local server. Keep it private; Sealert uses it on the backend only. See [Cartesia authentication](https://docs.cartesia.ai/get-started/authenticate-your-client-applications).
3. Provision a Cartesia phone number in Playground's **Phone Numbers** section, following [Cartesia's number guide](https://docs.cartesia.ai/line/integrations/telephony/cartesia-numbers). Cartesia-provisioned numbers call US destinations. Record the agent ID, API key, and the outbound number ID. The number ID is the provider's identifier, not the phone number shown to callers. For outbound call behavior, see [Cartesia outbound calling](https://docs.cartesia.ai/line/integrations/telephony/outbound-dialing).
4. Use an agent dedicated to Sealert. `npm run setup-agent` updates that agent's instructions and tools.

### 3. Prepare Claude

Sign in to the [Claude Console](https://platform.claude.com/), create an API key from [API keys](https://platform.claude.com/settings/keys), and copy it somewhere safe. API access is configured separately from the Claude chat app; see Anthropic's [API key guide](https://platform.claude.com/docs/en/get-api-key).

### 4. Install Sealert's dependencies

Run these commands from the repository root:

```sh
npm install
cd server
npm install
cd ..
```

### 5. Add your local credentials

Create a file named `.env` in the repository root and fill it with the values from Cartesia, Claude, and ngrok:

```dotenv
CARTESIA_API_KEY=paste-your-cartesia-api-key
CARTESIA_AGENT_ID=paste-your-cartesia-agent-id
CARTESIA_FROM_NUMBER_ID=paste-your-cartesia-outbound-number-id
ANTHROPIC_API_KEY=paste-your-claude-api-key
NGROK_URL=https://your-account-domain.ngrok-free.dev
CALLBACK_SECRET=paste-a-random-secret
```

Generate the callback secret by running `openssl rand -hex 24` and pasting its output into `.env`. The same secret is installed on Cartesia's webhook tools when you run `setup-agent`. `.env` is ignored by Git; do not commit it or paste its contents into issues or chat.

### 6. Create user data

Copy the example profile file without overwriting an existing local file:

```sh
cp -n server/mock/profiles.json.example server/mock/profiles.json
```

Edit `server/mock/profiles.json`. Replace each sample phone with a real number in international E.164 format (for example, `+14155550123`) for someone who has agreed to participate. Keep the JSON structure valid and ensure each contact name matches a profile name. The example `+1555555...` numbers are placeholders and will not be dialed.

### 7. Publish the database and configure Cartesia

Open Terminal 1 from the repository root and start the local database. Leave it running:

```sh
spacetime start
```

Open Terminal 2 from the repository root and run the first-time initialization:

```sh
cd server
spacetime publish rideout --server local --module-path spacetimedb
npm run seed
npm run setup-agent
```

`seed` should print the profiles and mark real numbers as `dialable`. If it says `placeholder, not dialed`, revisit step 6 before making calls. `setup-agent` should report that it created or updated the `record_check_in`, `report_call`, and `report_request` webhook tools and updated the agent prompt. Seeding is a one-time step for a fresh database; do not run it again after profiles already exist.

### 8. Start the backend and webhook tunnel

In Terminal 2, still in `server/`, start the live backend and leave it running:

```sh
npm run server
```

Open Terminal 3 from the repository root and start the tunnel. Leave it running:

```sh
cd server
./dev-tunnel
```

The tunnel forwards Cartesia webhooks to the backend on port `8787`; `NGROK_URL` must match the Dev Domain in your ngrok account and `.env`.

### 9. Start the dispatcher app

Open Terminal 4 from the repository root and start the frontend:

```sh
npm run dev
```

Open [http://localhost:5173](http://localhost:5173). Enter an incident in the dispatcher app to collect neighbor updates and coordinate follow-up. Keep Terminals 1–4 running while the live product is in use. The backend also serves a simple status page at [http://localhost:8787](http://localhost:8787).

For provider troubleshooting and backend operations, see [`server/README.md`](server/README.md).

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
