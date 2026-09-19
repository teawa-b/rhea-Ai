# Rhea — AI-native spatial markets on Solana

> Explore the market. Ask anything. Act onchain.

Rhea is a WebXR market interface for **tokenized stocks on Solana** — listed companies through xStocks,
and pre-IPO companies (OpenAI, Anthropic, SpaceX, Anduril and more) through **PreStocks**. Instead of rows in a brokerage
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
| Tokenized stocks | **Jupiter Tokens API v2** (`xstocks` / `stocks` tags) | xStocks across 7 countries — counts are live, never hardcoded |
| Pre-IPO companies | **PreStocks** public API | 8 private companies: issuer mark, mark valuation, implied valuation |
| Curve design | **Meteora Dynamic Bonding Curve SDK** | reference-anchored launch curves for tokenized equities; read-only, never launches |
| Onchain token price | **Jupiter Price API v3** | `usdPrice`, 24h change, liquidity |
| Underlying equity price | **Pyth Pro** (with key) → Jupiter `stockData` → Yahoo (fallback) | source + timestamp always shown; stale data is flagged |
| Market session | **Pyth** symbol schedules (keyless) | open / pre / post / closed |
| OHLC history | **Pyth Pro History API** (with key) → Yahoo Finance (fallback, labelled) | 1D · 5D · 1M · 3M · 1Y · 5Y · MAX |
| Corporate actions | xStocks **scaled-UI multiplier** (onchain rebasing) | e.g. NVDAx's dividend rebase on 10 Sep 2026 shows up automatically |
| Swap execution | **Jupiter Swap V2** (with key) / Ultra (keyless) | live quote → you sign with Privy → Jupiter lands it |
| Conditional orders | **Jupiter Trigger V2** (needs `JUPITER_API_KEY`) | buy-below / sell-above; without a key the rule is recorded locally and clearly marked *simulated* |
| Auth + wallet | **Privy** (Google / email / existing wallet) | embedded Solana wallet created on login; private keys never touch the app or the AI |
| Voice + reasoning | **GPT-Live-1** (voice) delegating to **GPT-5.6 Terra** (tools + web search) | 32 function tools move the world; the model cites sources it found |
| Portfolio | Solana RPC (`getParsedTokenAccountsByOwner`, SPL + Token-2022) | positions, USDC, SOL, country exposure |
| Trade checks | liquidity floor ($25k onchain) + order minimums | enforced server-side before every quote and order; the AI cannot bypass them |

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

### On a phone — AR

Phones get one extra control: an **AR** button beside the voice orb (never shown on desktop or in the
Quest browser). What it does depends on the device:

| Device | Path | What you get |
| --- | --- | --- |
| Android Chrome | WebXR `immersive-ar` + `dom-overlay` + hit test | Full AR: a reticle tracks the real surface you point at, and a tap rests the globe on it. Walk around it — ARCore tracks position and rotation. The normal HUD stays on screen over the camera feed. |
| iOS Safari (no WebXR) | rear camera behind the transparent canvas + gyroscope | Labelled **AR · gyro**: tap anywhere to move the globe there; it holds that direction as you turn (rotation tracked; walking isn't, Safari has no WebXR). Without a motion sensor it degrades to a plain **Camera view** and says so. |

In either mode the HUD collapses to the essentials — an **Exit AR** bar (plus **Recenter**, which re-places
the globe in front of you), crumbs, captions, the voice orb and the ask box; the brand, market chip, session pill and
account row step aside. Tap empty space to move the globe there, drag it to spin, pinch to zoom (pinch works
on every touch screen, AR or not); taps that hit the planet, a marker or a HUD control are left alone. Panels
open as bottom sheets and the globe rises above them. Where a runtime advertises hit test but refuses it, a
tap still places the globe, floating at arm's length rather than resting on a surface. Wallet prompts are DOM modals
a WebXR session would hide, so confirming a trade or signing in leaves AR first and tells you so.

Camera access needs a secure origin (`npm run dev:https` on your LAN, or the deployment). `?ar=1` forces the
button on for QA; the `localhost` IWER emulator covers the WebXR path headlessly.

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
  ├── GET  /api/market/company/:id       prices (Pyth/Jupiter/issuer mark), corporate actions, every wrapper
  ├── GET  /api/market/private           pre-IPO: issuer marks, premium to mark, implied valuation
  ├── POST /api/market/dbc/plan          Meteora DBC curve anchored on a company's reference price
  ├── GET  /api/market/dbc/pool/:address live DBC pool state (read-only)
  ├── GET  /api/market/history/:id       OHLC (Pyth Pro → Yahoo)
  ├── GET  /api/market/portfolio/:wallet Solana RPC
  ├── POST /api/market/eligibility|quote|execute   compliance → Jupiter quote → execute
  └── POST /api/market/trigger/:step     Jupiter Trigger V2 proxy (challenge/verify/vault/deposit/order)
```

Key files: `backend/shared/tools.ts` (the AI tool system), `backend/src/prompts.ts` (live + backend prompts),
`frontend/src/ai/liveClient.ts` (GPT-Live WebRTC client), `frontend/src/ai/toolRunner.ts` (tool execution),
`frontend/src/scene/*` (globe), `frontend/src/state/world.ts` (what the world shows), `frontend/src/solana/trade.ts` (trade + trigger flows).

## Private markets (pre-IPO)

Rhea prices eight companies that no exchange lists — **OpenAI**, **Anthropic**, **SpaceX**, **Anduril**,
**Neuralink**, **Figure AI**, **Kalshi** and **Polymarket** — through [PreStocks](https://prestocks.com)
on Solana. They sit on the globe at their real headquarters alongside the listed companies, and the
**Pre-IPO** chip in the top bar opens the panel.

A private company breaks most of the assumptions an equity interface makes, so it is handled differently
rather than squeezed into the same shape:

- **There is no stock price.** The reference is the issuer's *mark* on the exposure behind the token.
  Rhea labels it as the issuer's mark and never calls it a market price.
- **There is no session.** The panel says *private · trades 24/7* instead of quoting US market hours.
- **The number that matters is the gap.** `premiumToMarkPct` is the onchain price against the issuer's
  own per-token mark, and it runs both ways — while this was built, Neuralink traded ~25% above mark
  and SpaceX ~20% below. Scaling the issuer's mark valuation by that premium gives the **implied
  valuation**: what the market says the whole company is worth. The formula is PreStocks' own and
  reproduces their published `impliedValuation` exactly.
- **Jupiter's `stockData` is deliberately ignored for these.** It reports these mints on a
  company-level basis rather than the token's, so using it as the mark would invent a gap.
- **A PreStock is not a share.** It is an issuer token backed 1:1 by SPV exposure: economic exposure
  only, no ownership, voting, dividend or information rights, and not affiliated with or endorsed by the
  company it references. The disclosure and the US restriction are stated in the panel and before any
  trade.

To keep the pre-IPO layer single-issuer, **SPCXx** (Backed's SpaceX tracker) is excluded from discovery
— see `EXCLUDED_XSTOCK_SYMBOLS` in `shared/registry.ts`. Every other underlying in the xStocks catalog
was checked against a live quote and resolves to a listed equity, so nothing else needed gating.

## Curve studio (Meteora DBC)

Meteora's Dynamic Bonding Curve is usually pointed at memecoins: start near zero, run a long way up,
discover a price. A tokenized stock is the opposite problem — Pyth publishes the underlying and a private
issuer publishes a mark — so that curve is not price discovery, it just hands the launch gap to whoever
buys first.

**Curve studio** (*Design a curve* on any company panel) builds the curve that case wants instead, in
three segments anchored on the live reference price:

```
start ──(discovery)──> band low ══(anchor)══> band high ──(premium)──> migration
```

Thin liquidity closes the launch discount quickly, a thick anchor band puts most of the raise next to
fair value, and a thin premium segment above it still lets real demand revalue the token. It graduates
into DAMM v2 near the reference, so the migrated pool opens at fair value rather than wherever a spike
ended. Fees decay exponentially from a high open, and the dynamic fee makes trading dearer exactly when
price is being pushed off the anchor.

Three presets differ in band width, anchor weight and fee decay: **blue chip**, **thinly traded** and
**pre-IPO** (a mark that moves in steps, not ticks, needs a wider band). A curve can also be quoted in
another tokenized stock, which makes the pool a relative-value market between two equities.

Segment amounts come from the SDK's own fixed-point helpers and every config is run through
`validateConfigParameters` before it is shown, so what you copy is a config the program accepts. It is
read-only throughout: Rhea plans and explains curves and reads live pool state, and never signs, sends
or funds anything. Launching stays a human action with real money.

## Trust principles (spec §26) — how they are enforced

- Analysis is framed as estimate; the impact card says so and confidence is shown.
- News shown by Rhea is always the articles the backend found with web search — each card links to its source.
- The AI can only *prepare* trades; execution requires pressing **Confirm** and signing in your wallet.
- Trade preview shows asset, amount, route, price impact, fee, and the quote's age; stale quotes are refreshed before signing.
- Trade checks (`checkEligibility`: liquidity floor and minimums) run before every quote and order; research stays open.
- Underlying price and executable token price are separate data with separate timestamps; divergence > 0.5% is flagged.
- Private keys never leave Privy; the server never sees them; the AI never sees the wallet beyond a truncated address.

## Scope notes

- Without `JUPITER_API_KEY` conditional orders are recorded locally and labelled *simulated*; swaps still execute for real through Jupiter's keyless Ultra endpoint.
- App state (order cache) is kept in `localStorage` for the hackathon; the spec's Postgres/Supabase layer is a straightforward swap behind `frontend/src/state/market.ts`.
