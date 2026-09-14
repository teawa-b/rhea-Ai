/* Rhea — shared data model (spec §19). Imported by both server and client.
 * DUPLICATED in frontend/shared/ and backend/shared/ (they deploy separately).
 * If you edit this file, copy it to the other folder too. */

export type CountryCode =
  | "US" | "CN" | "HK" | "TW" | "GB" | "JP" | "DK" | "NL" | "DE" | "FR" | "CH" | "KR" | "IN" | "CA" | "AU" | "SG" | "IE";

export type Company = {
  id: string;               // slug, e.g. "nvidia"
  name: string;             // "NVIDIA"
  ticker: string;           // underlying, e.g. "NVDA"
  countryCode: CountryCode;
  sector: string;
  headquarters?: { name: string; lat: number; lng: number };
  /** Symbol of the tokenized equity on Solana, e.g. "NVDAx" */
  tokenSymbol: string;
  /** Pyth Pro symbol when known, e.g. "Equity.US.NVDA/USD" */
  pythSymbol?: string;
  /** Yahoo Finance symbol for the keyless OHLC fallback (defaults to ticker) */
  yahooSymbol?: string;
  /** Curated, polished companies get a hero building in the country view */
  featured?: boolean;
  /** Known xStocks mint (seed) so keyless discovery needs no search calls.
   *  Verified 12 Sep 2026 via Jupiter Tokens v2; refreshed live when a key is set. */
  seedMint?: string;
};

export type TokenizedAsset = {
  id: string;               // `${companyId}:solana`
  companyId: string;
  chain: "solana";
  mint: string;
  symbol: string;
  name: string;
  issuer: string;           // "xStocks (Backed)"
  decimals: number;
  tradable: boolean;        // has liquidity / a price
  icon?: string;
  tokenProgram?: string;
  liquidityUsd?: number;
  holderCount?: number;
};

export type PriceSnapshot = {
  companyId: string;
  mint: string;
  /** Executable onchain token price (Jupiter Price v3) */
  tokenPriceUsd: number | null;
  /** Underlying equity reference price (Pyth Pro or Jupiter stockData) */
  underlyingPriceUsd: number | null;
  underlyingSource: "pyth" | "jupiter-stockdata" | "yahoo" | "none";
  change24hPct: number | null;
  marketSession: "regular" | "pre_market" | "post_market" | "closed" | "unknown";
  /** ISO timestamps so the UI can show data age (trust principle #7/#8) */
  tokenUpdatedAt: string | null;
  underlyingUpdatedAt: string | null;
  stale: boolean;
  /** xStocks rebasing multiplier data (corporate actions surface here) */
  rebase?: {
    multiplier: number;
    newMultiplier?: number;
    newMultiplierEffectiveAt?: string;
  };
};

export type ChartRange = "1D" | "5D" | "1M" | "3M" | "1Y" | "5Y" | "MAX";

export type Candle = { t: number; o: number; h: number; l: number; c: number; v?: number };

export type ChartHistory = {
  companyId: string;
  range: ChartRange;
  resolution: string;
  source: "pyth" | "yahoo";
  candles: Candle[];
  fetchedAt: string;
};

export type NewsEvent = {
  id: string;
  companyIds: string[];
  countryCodes: string[];
  title: string;
  source: string;
  url: string;
  publishedAt: string;      // ISO
  summary?: string;
};

export type ImpactAnalysis = {
  event: string;
  companyId: string;
  impact: "potentially_positive" | "potentially_negative" | "mixed" | "neutral";
  confidence: number;       // 0..1
  time_horizon: "short_term" | "medium_term" | "long_term";
  factors: string[];
  sources?: string[];
};

export type CorporateAction = {
  id: string;
  companyId: string;
  type: "dividend" | "split" | "reverse_split" | "merger" | "ticker_change" | "delisting" | "rebase";
  effectiveAt: string;
  source: string;
  detail?: string;
  previousMultiplier?: number;
  newMultiplier?: number;
};

export type TradeSide = "buy" | "sell";

export type TradeQuote = {
  requestId: string;
  side: TradeSide;
  companyId: string;
  inputMint: string;
  outputMint: string;
  inAmount: string;          // base units
  outAmount: string;         // base units
  inAmountUi: number;
  outAmountUi: number;
  inSymbol: string;
  outSymbol: string;
  priceImpactPct: number;
  slippageBps: number;
  route: string;             // "Jupiter" + engine label
  feeLamports: number;
  transaction: string;       // base64 unsigned
  quotedAt: string;
  provider: "jupiter-swap-v2" | "jupiter-ultra";
};

export type TradeIntent = {
  id: string;
  userId: string;
  assetId: string;
  companyId: string;
  side: TradeSide;
  amount: number;            // in `currency`
  currency: string;          // "USDC" or the token symbol for sells
  status: "draft" | "quoted" | "awaiting_confirmation" | "submitted" | "confirmed" | "failed";
  quote?: TradeQuote;
  signature?: string;
  error?: string;
  createdAt: string;
};

export type AgentRule = {
  id: string;
  userId: string;
  assetId: string;
  companyId: string;
  type: "price_trigger" | "research_alert";
  condition: { kind: "price_below" | "price_above"; priceUsd: number; triggerMint: string };
  action: { side: TradeSide; amount: number; currency: string };
  status: "active" | "paused" | "completed" | "cancelled" | "pending";
  createdAt: string;
  expiresAt?: string;
  jupiterOrderId?: string;
  txSignature?: string;
  simulated?: boolean;       // true when JUPITER_API_KEY is absent
};

export type AssetCapability = {
  assetId: string;
  issuer: string;
  supportedJurisdictions: string[] | "all";
  restrictedJurisdictions: string[];
  requiresKyc: boolean;
  tradable: boolean;
  transferable: boolean;
  minimumTradeUsd: number;
  disclosureUrl: string;
};

export type EligibilityResult = {
  allowed: boolean;
  reasons: string[];
  disclosure: string;
  disclosureUrl: string;
};

export type Position = {
  companyId: string;
  mint: string;
  symbol: string;
  amountUi: number;
  valueUsd: number | null;
  tokenPriceUsd: number | null;
};

export type Portfolio = {
  wallet: string;
  solBalance: number;
  usdcBalance: number;
  positions: Position[];
  totalValueUsd: number;
  fetchedAt: string;
};

export type CountrySummary = {
  code: CountryCode;
  name: string;
  lat: number;
  lng: number;
  assetCount: number;
  tradableCount: number;
  companies: string[];       // company ids
};

export type MarketOverview = {
  countries: CountrySummary[];
  companies: Company[];
  assets: TokenizedAsset[];
  fetchedAt: string;
  source: string;
};
