# Stocklana submission — Rhea

**One line:** Rhea is a WebXR AI market interface where you explore tokenized stocks on a 3D globe, talk naturally with a live AI research agent, see news and market impact visualised in the world, inspect live charts and corporate actions, and execute or automate approved trades on Solana.

**Positioning:** an AI-native spatial interface for the onchain stock market — *instead of asking an AI about the market and receiving a wall of text, the AI takes you there.*

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

## Links
- Repo: (add GitHub URL)
- Live demo: (add Railway URL)
- Video: (add)

## What to look at in the code
- `shared/tools.ts` — the 25-tool AI system the backend model uses to control the world and prepare actions
- `server/live.ts` + `server/prompts.ts` — GPT-Live-1 session with Responses delegation (gpt-5.6-terra + web search)
- `src/ai/liveClient.ts` — WebRTC client, nested function-call handling, context sharing
- `src/scene/` — procedural dot-matrix Earth, country pins, company spires, animated arcs, in-headset panels
- `server/feeds.ts` — price-feed abstraction (Pyth Pro → Jupiter → Yahoo) with source + staleness on every number
- `src/solana/trade.ts` — quote → confirm → sign → execute; Trigger V2 challenge → vault → deposit → order
