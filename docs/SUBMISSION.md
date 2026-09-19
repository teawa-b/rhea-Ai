# Stocklana submission — Rhea

**One line:** Rhea is a WebXR AI market interface where you explore tokenized stocks — listed *and* pre-IPO — on a 3D globe, talk naturally with a live AI research agent, see news and market impact visualised in the world, inspect live charts and corporate actions, and execute or automate approved trades on Solana.

**Positioning:** an AI-native spatial interface for the onchain stock market — *instead of asking an AI about the market and receiving a wall of text, the AI takes you there.*

## Project description

## Why I built Rhea

Following a market story usually means jumping between a news site, a chart and a trading app. Even then, you are left to work out how an event in one country might affect a company somewhere else.

I built **Rhea** because I wanted that process to feel more direct. Rhea is a spatial interface for tokenized stocks on Solana. You explore the market on a 3D globe and ask questions by voice. Ask what is happening in China and the globe moves there, showing the stocks and recent news. Ask how it could affect Nvidia and Rhea draws the link, takes you to the company and opens its chart.

Rhea finds cited news, marks events on price charts and prepares swaps or conditional orders. Every trade stops at a preview so the user can check the details, confirm and sign with their own wallet.

## Why Solana

Rhea finds the tokenized stocks currently available through Jupiter. It keeps the underlying share price separate from the price available onchain, and shows where each number came from and how recent it is. Trades go through **Jupiter Swap**, conditional orders use **Jupiter Trigger**, and portfolio balances come from Solana RPC.

I am building **OtherChains** through Shroozy Studios. It is my spatial Web3 venture, focused on wallets, onchain agents and financial interfaces that you can speak to and see around you. Most of that work has been on Base. I was waiting for a Solana idea that made sense for the kind of interfaces I build, and tokenized stocks were it. They turn news, geography and markets into something that works naturally in a visual space.

I plan to keep working on Rhea after Stocklana and enter it in **Colosseum's Crypto World's Fair**. That gives me a next deadline to improve the live experience, test the research-to-trade flow with more people and see whether Rhea can grow into a useful Solana product.

## Why Solana is fundamental
- The assets are xStocks — tokenized equities that already trade on Solana (discovered live via Jupiter's Tokens API).
- Research turns into action without leaving the environment: Jupiter Swap for execution, Jupiter Trigger V2 for programmable conditional orders, self-custody through a Privy embedded wallet, sub-second settlement.
- Corporate actions are read straight from the tokens' onchain rebasing multipliers.

## 60–90 second demo script (spec §23)
1. **Enter** — sign in with Google; the globe appears; Rhea greets you with your portfolio and today's most active sector.
2. **"What's happening in China?"** — the globe rotates to China, it illuminates, news cards appear, Rhea summarises the story with sources.
3. **"How does that affect Nvidia?"** — an arc animates CHINA ──── NVIDIA, the camera flies to Santa Clara, the panel opens with underlying vs onchain price and the live chart; an impact card shows confidence and factors.
4. **"Show me when that news came out."** — the chart jumps to the article's timestamp with an event marker; Rhea describes the move ("the stock moved after…").
5. **"Buy $100 if Nvidia falls below $120."** — a holographic order preview appears; you press Confirm and sign; an **AGENT WATCHING** beacon attaches to Nvidia.
6. **Finish** — camera pulls back; the rule remains visible on the US.

## Bounty tracks

### PreStocks — pre-IPO companies

Rhea puts all eight PreStocks names — OpenAI, Anthropic, SpaceX, Anduril, Neuralink, Figure AI, Kalshi
and Polymarket — on the same globe as the listed companies, at their real headquarters, and prices them
the way private companies actually have to be priced.

The interesting part is that almost nothing an equity interface assumes survives contact with a private
company, so Rhea handles them as their own case rather than forcing them into the xStocks shape. There is
no stock price, so the reference is the issuer's mark on the exposure behind the token. There is no
session, so the panel says *private · trades 24/7*. There is no 4pm close to gap against, so the headline
number becomes **premium to mark** — the onchain price against the issuer's own per-token mark — and,
scaling the issuer's valuation by it, the **implied valuation** of the whole company. That formula is
PreStocks' own, and it reproduces their published `impliedValuation` to the decimal.

That gap is live and it runs both ways: while this was being built, Neuralink traded ~25% above mark
while SpaceX sat ~20% below it, so the panel's diverging bar earns its two sides. It is also easy to get
wrong — Jupiter's `stockData` reports these mints on a company-level basis rather than the token's, so
the obvious implementation invents a gap that is not there. Rhea computes the premium only against the
issuer's per-token mark, and says so at both call sites.

Eligibility was handled as an engineering problem rather than an assumption. The bounty excludes projects
carrying non-PreStocks pre-IPO tokens, so every underlying in the ~830-name xStocks catalog was checked
against a live quote. All of them resolve to listed equities — SHEIN, Bending Spoons, Medline, Cerebras
and BitGo included — so the only conflict was **SPCXx**, Backed's SpaceX tracker, competing with a
PreStocks headline name. It is excluded from discovery by symbol, with the audit documented in the
registry so it can be re-run when issuers change.

Throughout, a PreStock is described as what the issuer says it is: a token backed 1:1 by SPV exposure,
carrying economic exposure only, with no ownership, voting, dividend or information rights, not
affiliated with or endorsed by the company, and not available to US persons — stated before any trade.

### Meteora — Dynamic Bonding Curve

DBC's usual shape assumes nobody knows what the token is worth. A tokenized stock already has a reference
price, so Rhea's **Curve studio** builds a reference-anchored curve instead: thin liquidity to close the
launch discount, a thick anchor band that holds most of the raise next to fair value, a thin premium
segment above it, and graduation into DAMM v2 near the reference so the migrated pool opens at fair value
rather than wherever a launch spike ended. Fees decay exponentially from a high open so the discount is
not free money for the first buyer.

Three presets encode the differences that matter for equity-like assets — blue chip, thinly traded, and
pre-IPO, where a mark that moves in steps rather than ticks needs a much wider band. A curve can also be
quoted in another tokenized stock, making the pool a relative-value market between two equities.

Segment amounts are computed with the SDK's own fixed-point helpers and every config passes
`validateConfigParameters` before it is shown, so the JSON you copy is one the program accepts. Live
pools are read through `StateService` for curve progress and distance to graduation.

It is read-only by design. Rhea plans, explains and monitors curves; it never signs, sends or funds
anything, and it will not invent a leftover receiver — the program sends the leftover float there, so
that address has to be a real one the launcher controls.

## Links
- Repo: (add GitHub URL)
- Live demo: (add Railway URL)
- Video: (add)

## What to look at in the code
- `backend/shared/tools.ts` — the 25-tool AI system the backend model uses to control the world and prepare actions
- `backend/src/live.ts` + `backend/src/prompts.ts` — GPT-Live-1 session with Responses delegation (gpt-5.6-terra + web search)
- `frontend/src/ai/liveClient.ts` — WebRTC client, nested function-call handling, context sharing
- `frontend/src/scene/` — procedural dot-matrix Earth, country pins, company spires, animated arcs, in-headset panels
- `backend/src/feeds.ts` — price-feed abstraction (Pyth Pro → Jupiter → Yahoo) with source + staleness on every number
- `frontend/src/solana/trade.ts` — quote → confirm → sign → execute; Trigger V2 challenge → vault → deposit → order
