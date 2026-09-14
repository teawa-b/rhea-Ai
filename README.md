# Rhea — AI-native spatial markets on Solana

> Explore the market. Ask anything. Act onchain.

Rhea is a WebXR market interface for **tokenized stocks on Solana**. Instead of rows in a brokerage
dashboard, the market is a holographic globe. You talk to Rhea — a full-duplex voice agent built on
**OpenAI GPT-Live-1** — and instead of a wall of text, *the AI takes you there*: it rotates the globe,
illuminates a country, drops you at a company's headquarters, opens the live chart, pins the news that
moved the stock, draws the relationships, and prepares a trade or a conditional order that **you**
confirm with your embedded Solana wallet.

Built for the [Stocklana hackathon](https://hackathons.solana.com/hackathons/stocklana).

```
"What's happening in China?"          → globe rotates, China lights up, news cards appear
"How does that affect Nvidia?"        → an arc animates CHINA ──── NVIDIA, camera flies to Santa Clara
"Show me what the stock did."         → live chart, event marker at the article's timestamp
"Buy $100 if it falls below $120."    → holographic order preview → you confirm → Jupiter Trigger order
```

## What is real

| Layer | Source | Notes |
| --- | --- | --- |
| Tokenized stocks | **Jupiter Tokens API v2** (`xstocks` / `stocks` tags) | 66 xStocks across 7 countries at time of writing — counts are live, never hardcoded |
| Onchain token price | **Jupiter Price API v3** | `usdPrice`, 24h change, liquidity |
| Underlying equity price | **Pyth Pro** (with key) → Jupiter `stockData` → Yahoo (fallback) | source + timestamp always shown; stale data is flagged |
| Market session | **Pyth** symbol schedules (keyless) | open / pre / post / closed |
| OHLC history | **Pyth Pro History API** (with key) → Yahoo Finance (fallback, labelled) | 1D · 5D · 1M · 3M · 1Y · 5Y · MAX |
| Corporate actions | xStocks **scaled-UI multiplier** (onchain rebasing) | e.g. NVDAx's dividend rebase on 10 Sep 2026 shows up automatically |
| Swap execution | **Jupiter Swap V2** (with key) / Ultra (keyless) | live quote → you sign with Privy → Jupiter lands it |
| Conditional orders | **Jupiter Trigger V2** (needs `JUPITER_API_KEY`) | buy-below / sell-above; without a key the rule is recorded locally and clearly marked *simulated* |
| Auth + wallet | **Privy** (Google / email / existing wallet) | embedded Solana wallet created on login; private keys never touch the app or the AI |
| Voice + reasoning | **GPT-Live-1** (voice) delegating to **GPT-5.6 Terra** (tools + web search) | 25 function tools move the world; the model cites sources it found |
| Portfolio | Solana RPC (`getParsedTokenAccountsByOwner`, SPL + Token-2022) | positions, USDC, SOL, country exposure |
| Compliance | asset capability table + jurisdiction gate | illustrative, from the issuer's public terms; the AI cannot bypass it |

## Repo layout

```
frontend/   Vite + React WebXR client      → Railway service "frontend"  (env: frontend/.env.example)
backend/    Express API, owns all secrets  → Railway service "backend"   (env: backend/.env.example)
docs/       submission notes
```

**Deploying? Follow [DEPLOY.md](DEPLOY.md).** Two services in one Railway project, with copy-paste variable blocks.

## Quick start

```bash
npm run install:all
cp backend/.env.example backend/.env      # add at least OPENAI_API_KEY
cp frontend/.env.example frontend/.env    # add VITE_PRIVY_APP_ID; leave VITE_API_URL empty locally
npm run dev                               # http://localhost:3000  (API on :5050, proxied)
```

Without any keys the globe, market data, charts and corporate actions still work (guest mode);
voice needs `OPENAI_API_KEY`, sign-in/trading needs `VITE_PRIVY_APP_ID`.

### Keys

| Variable | Lives in | Needed for | Where |
| --- | --- | --- | --- |
| `VITE_API_URL` | frontend | Pointing the deployed client at the Railway API | on Railway: `https://${{ backend.RAILWAY_PUBLIC_DOMAIN }}` (empty locally) |
| `VITE_PRIVY_APP_ID` | frontend | Sign-in + embedded Solana wallet | dashboard.privy.io → create app → enable Solana embedded wallets, Google + email login. Add your dev/prod origins to *Allowed origins*. |
| `OPENAI_API_KEY` | backend | Rhea's voice (GPT-Live-1 + Responses backend) | platform.openai.com |
| `CORS_ORIGIN` | backend | Restricting which sites can call the API | on Railway: `https://${{ frontend.RAILWAY_PUBLIC_DOMAIN }}` |
| `JUPITER_API_KEY` | backend | Swap V2, Trigger V2 (real conditional orders), full `stocks` tag | portal.jup.ag (free tier is enough) |
| `PYTH_PRO_API_KEY` | backend | real-time equity feeds + OHLC history | docs.pyth.network/price-feeds/pro (optional; Yahoo fallback otherwise) |
| `GOOGLE_MAPS_API_KEY` | backend | Street View Static images of HQs | optional; restrict the key to the Street View Static API |
| `SOLANA_RPC_URL` | backend | portfolio reads | defaults to the public mainnet RPC; use a provider for reliability |

### On a Meta Quest — mixed reality

Rhea is passthrough-first: on a headset it requests an `immersive-ar` session (Meta's WebXR MR path), the
scene renders on a transparent background, and the globe, chart and controls float in your room. If AR
isn't available it falls back to immersive VR with the starfield.

WebXR and the microphone both need a secure origin, so either deploy (below) or run the dev server
over HTTPS on your LAN and open it in Quest Browser:

```bash
npm run dev:https           # https://<your-LAN-IP>:3000 — accept the self-signed cert on the headset
```

Press **Enter Mixed Reality**. In the room: the globe floats to your left at chest height (countries glow
deeper Solana purple the more tokenized stocks they list); when you open a company the live chart floats
to your right with **no backdrop** and the assistant's buttons — Talk, Buy $100, Sell all, Buy-below
trigger, chart ranges — float in a row beneath it. Point-and-pinch (hands) or ray-and-trigger (controllers)
on anything; **A** toggles Rhea's microphone, **B** returns to the world view. The session targets 90 Hz
and only hero company markers render in-headset to stay inside Quest's draw-call budget. Sign in on
desktop first (Privy's login is a web flow); the same wallet is used in the headset.

On a desktop without WebXR, `localhost` gets a built-in Quest 3 emulator (IWER) so the MR layout can be
previewed — `node frontend/scripts/qa-xr.mjs <name>` captures it headlessly.

### Deploy

Two services (`frontend`, `backend`) in one Railway project. See **[DEPLOY.md](DEPLOY.md)**.

## Architecture

```
Quest / Browser
  ├── React Three Fiber + @react-three/xr  (globe, spires, arcs, in-world panels)
  ├── Microphone ⇄ WebRTC ⇄ GPT-Live-1 (full duplex, interruptible)
  │       └── data channel: transcripts, delegation events, nested Responses events
  │           ├── function calls → executed in the browser (world store, market API, trade prep)
  │           └── function_call_output + response.create → backend continues
  └── Privy embedded Solana wallet (signTransaction / signMessage only)

Express API (backend/, Railway)         secrets live here only
  ├── POST /api/live/session             GPT-Live session w/ Responses delegation + tools + web_search
  ├── GET  /api/market/overview          countries + assets (Jupiter)
  ├── GET  /api/market/company/:id       prices (Pyth/Jupiter), corporate actions, capability
  ├── GET  /api/market/history/:id       OHLC (Pyth Pro → Yahoo)
  ├── GET  /api/market/portfolio/:wallet Solana RPC
  ├── POST /api/market/eligibility|quote|execute   compliance → Jupiter quote → execute
  └── POST /api/market/trigger/:step     Jupiter Trigger V2 proxy (challenge/verify/vault/deposit/order)
```

Key files: `backend/shared/tools.ts` (the AI tool system), `backend/src/prompts.ts` (live + backend prompts),
`frontend/src/ai/liveClient.ts` (GPT-Live WebRTC client), `frontend/src/ai/toolRunner.ts` (tool execution),
`frontend/src/scene/*` (globe), `frontend/src/state/world.ts` (what the world shows), `frontend/src/solana/trade.ts` (trade + trigger flows).

## Trust principles (spec §26) — how they are enforced

- Analysis is framed as estimate; the impact card says so and confidence is shown.
- News shown by Rhea is always the articles the backend found with web search — each card links to its source.
- The AI can only *prepare* trades; execution requires pressing **Confirm** and signing in your wallet.
- Trade preview shows asset, amount, route, price impact, fee, and the quote's age; stale quotes are refreshed before signing.
- Compliance (`checkEligibility`) runs before every quote and order; restricted jurisdictions cannot trade, research stays open.
- Underlying price and executable token price are separate data with separate timestamps; divergence > 0.5% is flagged.
- Private keys never leave Privy; the server never sees them; the AI never sees the wallet beyond a truncated address.

## Scope notes

- xStocks jurisdiction restrictions in `backend/shared/registry.ts` (and its `frontend/shared/` copy) are illustrative and must be confirmed against the issuer's terms before production.
- Without `JUPITER_API_KEY` conditional orders are recorded locally and labelled *simulated*; swaps still execute for real through Jupiter's keyless Ultra endpoint.
- App state (orders, jurisdiction) is kept in `localStorage` for the hackathon; the spec's Postgres/Supabase layer is a straightforward swap behind `frontend/src/state/market.ts`.
