/* Rhea — the AI tool system (spec §8).
 *
 * These are the function tools registered on the GPT-Live Responses backend.
 * The backend model decides to call them; the BROWSER executes them (it owns
 * the 3D world, the wallet and the user's confirmation UI) and returns the
 * result over the WebRTC data channel. Nothing here executes a trade — the
 * trade tools only open an app-owned confirmation panel (spec §11.1, §13.1).
 */

export type ToolDef = {
  type: "function";
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  strict?: boolean;
};

const obj = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});

const companyParam = {
  type: "string",
  description: "Company name, underlying ticker (NVDA) or token symbol (NVDAx). Loosely matched.",
};
const countryParam = {
  type: "string",
  description: "Country name or ISO code (US, CN, HK, TW, GB, JP, DK, NL).",
};

export const RHEA_TOOLS: ToolDef[] = [
  /* ---------------- Visual / spatial ---------------- */
  {
    type: "function",
    name: "focus_country",
    description: "Rotate and zoom the globe to a country, highlight it and open the country view listing its tokenized companies. Call this BEFORE talking about a country so the world moves while you speak.",
    parameters: obj({ country: countryParam }, ["country"]),
  },
  {
    type: "function",
    name: "focus_region",
    description: "Rotate and zoom the globe to a continent or market region, highlight its countries and open a region view of its tradable stocks. Use for questions like \"show me Europe\" or \"what's happening in Asia\"; use focus_country for a single country.",
    parameters: obj({ region: { type: "string", description: "Europe, Asia, Greater China, North America or Oceania. Loosely matched." } }, ["region"]),
  },
  {
    type: "function",
    name: "focus_company",
    description: "Fly the camera to a company's headquarters, open its holographic panel (prices, chart, news, position, orders). Call this before discussing a specific company.",
    parameters: obj({ company: companyParam }, ["company"]),
  },
  {
    type: "function",
    name: "show_holdings",
    description: "Fly away from Earth to the user's holdings planet: their USDC, SOL and every tokenized-stock position orbit it as labelled moons, with the portfolio panel open. Use for \"show me my holdings / portfolio / wallet / balances\". Returns the balances and positions to speak. reset_globe or any focus_* flies back to Earth.",
    parameters: obj({}),
  },
  {
    type: "function",
    name: "reset_globe",
    description: "Pull the camera back to the full world view and clear focus (keeps highlights/connections unless clear=true).",
    parameters: obj({ clear: { type: "boolean", description: "Also clear highlights and connections." } }),
  },
  {
    type: "function",
    name: "highlight_countries",
    description: "Illuminate one or more countries on the globe (e.g. to show geographic exposure).",
    parameters: obj({ countries: { type: "array", items: countryParam } }, ["countries"]),
  },
  {
    type: "function",
    name: "highlight_companies",
    description: "Illuminate company markers on the globe/country view.",
    parameters: obj({ companies: { type: "array", items: companyParam } }, ["companies"]),
  },
  {
    type: "function",
    name: "draw_connection",
    description: "Animate a glowing arc between two places (country→company, company→company, or country→country) with a short label such as 'export restrictions' or '18% revenue exposure'. Use it to visualise relationships you are explaining.",
    parameters: obj(
      {
        from: { type: "string", description: "Country or company (loosely matched)." },
        to: { type: "string", description: "Country or company (loosely matched)." },
        label: { type: "string", description: "≤ 6 words shown on the arc." },
        sentiment: { type: "string", enum: ["negative", "positive", "neutral"], description: "Colours the arc: negative=magenta, positive=green, neutral=cyan." },
      },
      ["from", "to"],
    ),
  },
  {
    type: "function",
    name: "clear_connections",
    description: "Remove all drawn arcs.",
    parameters: obj({}),
  },
  {
    type: "function",
    name: "show_chart",
    description: "Open or switch the live price chart for a company to a time range.",
    parameters: obj(
      {
        company: companyParam,
        range: { type: "string", enum: ["1D", "5D", "1M", "3M", "1Y", "5Y", "MAX"] },
        mode: { type: "string", enum: ["line", "candles"] },
      },
      ["company", "range"],
    ),
  },
  {
    type: "function",
    name: "focus_chart_timestamp",
    description: "Scroll/zoom the chart to a moment in time (ISO 8601) so the user sees what the price did around it.",
    parameters: obj({ company: companyParam, timestamp: { type: "string", description: "ISO 8601 date-time" } }, ["company", "timestamp"]),
  },
  {
    type: "function",
    name: "add_chart_event",
    description: "Place a news/corporate-action marker on the chart at a timestamp. Use after you have found the event with web search. Never present the marker as proof the news caused the move.",
    parameters: obj(
      {
        company: companyParam,
        timestamp: { type: "string", description: "ISO 8601 date-time of the event" },
        title: { type: "string", description: "≤ 8 words" },
        kind: { type: "string", enum: ["news", "earnings", "corporate_action", "macro"] },
        url: { type: "string" },
      },
      ["company", "timestamp", "title"],
    ),
  },
  {
    type: "function",
    name: "compare_companies",
    description: "Show 2–4 companies side by side (price, 24h move, token vs underlying) and highlight them on the globe.",
    parameters: obj({ companies: { type: "array", items: companyParam, minItems: 2, maxItems: 4 } }, ["companies"]),
  },
  {
    type: "function",
    name: "show_portfolio_exposure",
    description: "Visualise the user's holdings by country or sector on the globe (illuminates countries proportional to exposure).",
    parameters: obj({ dimension: { type: "string", enum: ["country", "sector"] } }, ["dimension"]),
  },
  {
    type: "function",
    name: "show_news",
    description: "Render news cards in the world next to a company or country. Pass the articles you found with web search (title, source, url, ISO publishedAt, ≤ 25-word summary). Call this whenever you summarise news so the user can SEE sources.",
    parameters: obj(
      {
        target: { type: "string", description: "Company or country the news is about." },
        items: {
          type: "array",
          maxItems: 6,
          items: obj(
            {
              title: { type: "string" },
              source: { type: "string" },
              url: { type: "string" },
              publishedAt: { type: "string", description: "ISO 8601" },
              summary: { type: "string" },
            },
            ["title", "source", "url", "publishedAt"],
          ),
        },
      },
      ["target", "items"],
    ),
  },
  {
    type: "function",
    name: "show_impact",
    description: "Render a structured market-impact card (spec: impact object) for a company after analysing news. This is an estimate, never a price prediction.",
    parameters: obj(
      {
        company: companyParam,
        event: { type: "string", description: "One-line event description" },
        impact: { type: "string", enum: ["potentially_positive", "potentially_negative", "mixed", "neutral"] },
        confidence: { type: "number", minimum: 0, maximum: 1 },
        time_horizon: { type: "string", enum: ["short_term", "medium_term", "long_term"] },
        factors: { type: "array", items: { type: "string" }, maxItems: 6 },
      },
      ["company", "event", "impact", "confidence", "time_horizon", "factors"],
    ),
  },
  {
    type: "function",
    name: "show_street_view",
    description: "Show a real-world Street View image of a company's headquarters (falls back to a map marker if unavailable).",
    parameters: obj({ company: companyParam }, ["company"]),
  },

  /* ---------------- Market ---------------- */
  {
    type: "function",
    name: "get_briefing",
    description: "What changed while the US regular session was closed: the user's holdings (or a default watchlist when signed out) vs the 4pm close, distributions, proof of reserves, session status. Call first for 'what changed', 'what did I miss', 'how are my stocks'. Opens the holdings planet when signed in.",
    parameters: obj({}),
  },
  {
    type: "function",
    name: "get_market_overview",
    description: "Live list of supported countries with tradable counts, plus every tradable tokenized company with its onchain liquidity (liquidityUsd) and tradeable_size_ok (true at $25k or more; only suggest trading those). Use to answer 'what can I trade', 'which countries', or to resolve names.",
    parameters: obj({}),
  },
  {
    type: "function",
    name: "show_private_markets",
    description:
      "Open the pre-IPO panel and return every private company Rhea can price: the issuer's mark per token, the executable onchain price, the premium or discount between them, implied and issuer valuations, holders and liquidity. Use for 'pre-IPO', 'private companies', 'OpenAI', 'SpaceX', 'Kalshi', 'what's OpenAI worth', or any question about a company that is not listed on an exchange. These are loan participation rights, not shares — say so before discussing buying one.",
    parameters: obj({}),
  },
  {
    type: "function",
    name: "design_bonding_curve",
    description:
      "Open the curve studio and plan a Meteora Dynamic Bonding Curve for launching a tokenized version of a company, anchored on its live reference price (the equity price for a listed company, the issuer's mark for a private one). Returns the price band, where the raise lands across the curve's segments, the raise needed to graduate into DAMM v2, and the fee schedule. This only designs and explains a curve — it never launches one, and Rhea cannot sign or fund a pool.",
    parameters: obj(
      {
        company: companyParam,
        preset: {
          type: "string",
          enum: ["blue-chip", "thin-listing", "pre-ipo"],
          description: "Curve shape. Omit to let Rhea pick: pre-ipo for a private company, blue-chip otherwise.",
        },
        totalTokenSupply: { type: "number", description: "Optional token supply to plan against." },
      },
      ["company"],
    ),
  },
  {
    type: "function",
    name: "get_company_profile",
    description: "Company profile + live prices: underlying equity price, executable onchain token price, 24h change, market session, data timestamps, tokenized asset (mint, issuer, tradable), user position and active orders.",
    parameters: obj({ company: companyParam }, ["company"]),
  },
  {
    type: "function",
    name: "get_historical_prices",
    description: "OHLC summary for a company and range (first/last/high/low/change and a sparse sample of candles). Use for 'what did the stock do' questions.",
    parameters: obj({ company: companyParam, range: { type: "string", enum: ["1D", "5D", "1M", "3M", "1Y", "5Y", "MAX"] } }, ["company", "range"]),
  },
  {
    type: "function",
    name: "get_portfolio",
    description: "The user's wallet: SOL, USDC, tokenized-stock positions with values, country exposure. Requires the user to be logged in.",
    parameters: obj({}),
  },
  {
    type: "function",
    name: "get_swap_quote",
    description: "Live Jupiter quote for buying or selling a tokenized stock with USDC. Returns expected amount, price impact, route. Does NOT trade.",
    parameters: obj(
      {
        company: companyParam,
        side: { type: "string", enum: ["buy", "sell"] },
        amount: { type: "number", description: "USDC amount for buys; token amount for sells." },
      },
      ["company", "side", "amount"],
    ),
  },
  {
    type: "function",
    name: "get_corporate_actions",
    description: "Dividends, splits and other corporate actions for the tokenized asset from the xStocks issuer API (caType verbatim, gross/net USD per share-equivalent, upcoming and last 90 days), with the balance-multiplier change that reflects each one.",
    parameters: obj({ company: companyParam }, ["company"]),
  },

  /* ---------------- Trading (prepare only) ---------------- */
  {
    type: "function",
    name: "prepare_buy",
    description: "Run compliance checks, fetch a live quote and open the BUY confirmation panel for the user. Never executes. Ask the user to confirm on the panel; the app reports the result.",
    parameters: obj({ company: companyParam, amount_usdc: { type: "number", minimum: 1 } }, ["company", "amount_usdc"]),
  },
  {
    type: "function",
    name: "prepare_sell",
    description: "Run compliance checks, fetch a live quote and open the SELL confirmation panel. Never executes.",
    parameters: obj(
      {
        company: companyParam,
        amount_tokens: { type: "number", description: "Token amount to sell. Omit with fraction instead." },
        fraction: { type: "number", minimum: 0, maximum: 1, description: "Fraction of the position, e.g. 0.5 for 'sell half'." },
      },
      ["company"],
    ),
  },
  {
    type: "function",
    name: "create_price_trigger",
    description: "Translate a natural-language conditional order into a deterministic Jupiter Trigger rule and open the confirmation panel. Supported: buy_below, sell_above. Never executes without the user's confirmation.",
    parameters: obj(
      {
        company: companyParam,
        kind: { type: "string", enum: ["buy_below", "sell_above"] },
        trigger_price_usd: { type: "number", description: "USD price threshold on the token." },
        amount: { type: "number", description: "USDC to spend (buy_below) or tokens to sell (sell_above)." },
        expires_in_days: { type: "integer", minimum: 1, maximum: 90 },
      },
      ["company", "kind", "trigger_price_usd", "amount"],
    ),
  },
  {
    type: "function",
    name: "get_active_orders",
    description: "List the user's active conditional orders / watching agents.",
    parameters: obj({}),
  },
  {
    type: "function",
    name: "cancel_price_trigger",
    description: "Ask the app to cancel an active order (opens a confirmation).",
    parameters: obj({ order_id: { type: "string" } }, ["order_id"]),
  },

  /* ---------------- Compliance ---------------- */
  {
    type: "function",
    name: "check_trade_eligibility",
    description: "Whether this asset can be traded right now: enough onchain liquidity (at least $25k) and the order minimums, plus the xStocks risk disclosure. The app enforces this regardless; use it to explain why a trade is refused.",
    parameters: obj({ company: companyParam, action: { type: "string", enum: ["buy", "sell", "trigger"] } }, ["company", "action"]),
  },
];

export const RHEA_TOOL_NAMES = new Set(RHEA_TOOLS.map((t) => t.name));
