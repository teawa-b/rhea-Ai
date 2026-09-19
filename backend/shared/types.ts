/* Rhea — shared data model (spec §19). Imported by both server and client.
 * DUPLICATED in frontend/shared/ and backend/shared/ (they deploy separately).
 * If you edit this file, copy it to the other folder too. */

export type CountryCode =
  | "US" | "CN" | "HK" | "TW" | "GB" | "JP" | "DK" | "NL" | "DE" | "FR" | "CH" | "KR" | "IN" | "CA" | "AU" | "SG" | "IE" | "IT";

/** Who wrapped the company into a Solana token. A company can have more than
 *  one: SpaceX is tokenized by both Backed (xStocks) and Tessera. */
export type IssuerKey = "xstocks" | "tessera";

/** A tokenized wrapper beyond the company's primary one. */
export type CompanyWrapper = {
  issuerKey: IssuerKey;
  /** Onchain symbol as Jupiter reports it, e.g. "tSpaceX" */
  tokenSymbol: string;
  mint: string;
};

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
  /** xStocks mint from the issuer catalog (xstocks-catalog.ts), so keyless
   *  discovery needs no search calls; refreshed live when a Jupiter key is set. */
  seedMint?: string;
  /** Issuer icon URL from the xStocks catalog */
  icon?: string;
  /** A pre-IPO company: no exchange listing, so no session and no last trade.
   *  Its reference price is the issuer's mark, never an equity feed. */
  private?: boolean;
  /** Issuer behind `tokenSymbol` (the company's primary wrapper). Defaults to xStocks. */
  issuerKey?: IssuerKey;
  /** Additional wrappers of the same company by other issuers. */
  wrappers?: CompanyWrapper[];
};

export type TokenizedAsset = {
  /** `${companyId}:solana` for a company's primary wrapper, suffixed with the
   *  issuer key for any additional one (`spacex:solana:tessera`). Stable: saved
   *  orders and cached state key off it. */
  id: string;
  companyId: string;
  /** Which issuer wrapped it. */
  issuerKey: IssuerKey;
  /** The company's primary wrapper — the one a bare "buy SpaceX" resolves to. */
  primary: boolean;
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
  /** Token-2022 scaled-UI multiplier config (xStocks corporate actions). Convert
   *  UI ↔ raw with effectiveUiMultiplier / uiToRawAmount from shared/registry. */
  scaledUi?: { multiplier: number; newMultiplier?: number; newMultiplierEffectiveAt?: string };
};

export type PriceSnapshot = {
  companyId: string;
  mint: string;
  /** Executable onchain token price (Jupiter Price v3) */
  tokenPriceUsd: number | null;
  /** Reference price for the underlying. For a listed company that is the
   *  equity price; for a private one it is the issuer's mark on the portfolio. */
  underlyingPriceUsd: number | null;
  underlyingSource: "pyth" | "jupiter-stockdata" | "yahoo" | "tessera-mark" | "none";
  /** Private companies only: the issuer's published mark per token, and what the
   *  onchain price is paying over (+) or under (-) it. */
  markPriceUsd?: number | null;
  premiumToMarkPct?: number | null;
  /** The whole company's worth implied by the onchain price. */
  impliedValuationUsd?: number | null;
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
  /** Last US regular-session (4pm ET) close of the underlying, from Yahoo meta */
  lastCloseUsd?: number | null;
  /** When that close printed (ISO); null during the session when only the previous close is known */
  lastCloseAt?: string | null;
  /** tokenPriceUsd vs lastCloseUsd in % ("+0.74% vs 4pm close"); only set outside the regular session */
  gapVsClosePct?: number | null;
  /** xStocks trading.currentPeriod verbatim: "market" | "extended" | "overnight" | "closed" */
  xstocksPeriod?: string | null;
  /** xStocks issuer (xChange) trading available right now; Jupiter swaps on Solana don't depend on it */
  xstocksOpenNow?: boolean | null;
  /** Issuer halt flag for this xStock */
  halted?: boolean | null;
  /** Next US regular open (09:30 America/New_York), holiday-aware via the Pyth schedule (ISO) */
  nextRegularOpenAt?: string | null;
  sessionLabel?: SessionLabel;
};

/** Only these three strings: weeknights are "regular session closed" (xStocks trade 24/5), weekends are "closed for the weekend". */
export type SessionLabel = "US regular session" | "regular session closed" | "US market closed for the weekend";

/** GET /api/market/session — for the HUD pill */
export type MarketSessionInfo = {
  usRegularOpen: boolean;
  sessionLabel: SessionLabel;
  nextRegularOpenAt: string | null;
  /** Jupiter swaps on Solana never close */
  solanaOpen: true;
  /** xStocks trading.currentPeriod for the reference symbol (NVDAx), verbatim */
  xstocksPeriod?: string | null;
  asOf: string;
};

/** xStocks proof of reserves: shares held at the custodian vs tokens circulating (all chains) */
export type ProofOfReserves = {
  symbol: string;
  backedPct: number;         // 100.17
  custodian: string;         // "Alpaca"
  shares: number;
  circulating: number;
  asOf: string;
};

/* ---------------- Private (pre-IPO) markets ---------------- */

/** A T-Token's issuer mark, straight from Tessera's public API. */
export type TesseraMark = {
  id: string;
  name: string;              // "T-OpenAI"
  symbol: string;            // "T-OpenAI"
  code: string;              // onchain ticker as Jupiter shows it, "tOpenAI"
  sector: string;
  mint: string;
  /** Issuer's mark per token. The only figure comparable to the onchain price. */
  markPriceUsd: number | null;
  /** What the issuer marks the whole company at. */
  markValuationUsd: number | null;
  holders: number | null;
  fetchedAt: string;
};

/** Where a private-market token's backing is attested, and by whom. Distinct
 *  from ProofOfReserves: Chainlink's T-Token streams publish attested unit
 *  counts on a roughly monthly cadence, so there is no live backed-% to quote. */
export type ReserveAttestation = {
  symbol: string;
  issuer: string;
  custodian: string;
  verifier: string;
  attestationUrl: string;
  note: string;
};

/** A private company's live picture: what the issuer marks it at, what the
 *  onchain market actually pays, and what that implies the company is worth. */
export type PrivateMarketSnapshot = {
  companyId: string;
  companyName: string;
  mint: string;
  symbol: string;
  issuer: string;
  sector: string;
  /** Executable onchain price (Jupiter Price v3). */
  tokenPriceUsd: number | null;
  /** Issuer's mark per token (Tessera). */
  markPriceUsd: number | null;
  markValuationUsd: number | null;
  /** markValuation scaled by the premium the market is paying. */
  impliedValuationUsd: number | null;
  /** Onchain price vs the issuer mark, in %. Positive = paying above mark. */
  premiumToMarkPct: number | null;
  holders: number | null;
  liquidityUsd: number | null;
  change24hPct: number | null;
  tradable: boolean;
  markFetchedAt: string | null;
  attestation: ReserveAttestation | null;
  /** True when the issuer API was unreachable and only onchain data is shown. */
  markUnavailable: boolean;
};

export type PrivateMarketsOverview = {
  assets: PrivateMarketSnapshot[];
  issuer: string;
  disclosure: string;
  disclosureUrl: string;
  termsUrl: string;
  restrictedJurisdictions: string[];
  fetchedAt: string;
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
  type: "dividend" | "split" | "reverse_split" | "merger" | "ticker_change" | "delisting" | "rebase" | "other";
  effectiveAt: string;
  source: string;
  detail?: string;
  previousMultiplier?: number;
  newMultiplier?: number;
  /** xStocks caType verbatim (CashDividend, ForwardSplit, …); say this, not a paraphrase */
  caType?: string;
  /** USD per share-equivalent; net is after withholding and is what balances reflect */
  grossAmount?: number;
  netAmount?: number;
  currency?: string;
  withholdingPct?: number;
  /** The xStocks API only publishes effectiveTimeUtc (= effectiveAt); these stay unset unless the issuer states them */
  exDate?: string;
  payDate?: string;
  /** Scheduled, not yet applied */
  upcoming?: boolean;
};

export type BriefingHolding = {
  companyId: string;
  symbol: string;
  name: string;
  /** null for watchlist rows */
  amountUi: number | null;
  valueUsd: number | null;
  tokenPriceUsd: number | null;
  lastCloseUsd: number | null;
  /** tokenPriceUsd vs the last 4pm ET close, % */
  movePctSinceClose: number | null;
  change24hPct: number | null;
};

export type BriefingDistribution = {
  companyId: string;
  symbol: string;
  caType: string;
  netAmount: number | null;
  grossAmount: number | null;
  currency: string;
  /** effectiveAt (ISO) */
  date: string | null;
  upcoming: boolean;
  /** Speakable; never claims this wallet received a payout */
  heldNote: string;
};

/** GET /api/market/briefing/:wallet and /api/market/briefing?watch=… — stateless, anchored to the last close */
export type Briefing = {
  wallet: string | null;
  /** "watchlist" when signed out or the wallet holds no xStocks */
  mode: "wallet" | "watchlist";
  asOf: string;
  session: MarketSessionInfo;
  totalValueUsd: number | null;
  usdcBalance: number | null;
  holdings: BriefingHolding[];
  distributions: BriefingDistribution[];
  reserves: { symbol: string; backedPct: number; custodian: string; asOf: string }[];
  notes: string[];
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
  inAmountUi: number;        // UI units (xStock side includes the scaled-UI multiplier)
  outAmountUi: number;
  inSymbol: string;
  outSymbol: string;
  priceImpactPct: number;
  slippageBps: number;
  route: string;             // "Jupiter" + engine label
  /** Signature + priority fee lamports paid by the taker (0 on gasless routes) */
  feeLamports: number;
  transaction: string;       // base64 unsigned
  quotedAt: string;
  provider: "jupiter-swap-v2" | "jupiter-ultra";
  /** Total Jupiter fee rate on this swap (order `feeBps`: platform fee plus any gasless recoup; already in outAmount) */
  feeBps?: number;
  /** feeBps applied to the swap's USD value */
  platformFeeUsd?: number;
  /** feeLamports × SOL price */
  networkFeeUsd?: number;
  /** One-time token-account rent the taker pays when first receiving this token */
  rentFeeUsd?: number;
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
  /** Receipt: ms from sending the signed tx to /execute until Jupiter answered Success (excludes wallet approval time) */
  confirmMs?: number;
  /** Receipt: ISO time the app saw Success */
  confirmedAt?: string;
  /** Receipt: US session at confirmation ("US regular session" | "regular session closed" | "US market closed for the weekend") */
  sessionLabel?: string;
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
  txSignature?: string;      // deposit into the Jupiter order vault
  simulated?: boolean;       // true when JUPITER_API_KEY is absent
  /** Jupiter's display state from order history: pending | open | executing | filled | pending_withdraw | cancelled | expired | failed */
  jupiterState?: string;
  /** Fill tx from the order's history events */
  fillTxSignature?: string;
  /** Withdrawal tx: the refund after a cancel/expiry, or the output payout after a fill */
  withdrawTxSignature?: string;
  /** Jupiter still holds this order's funds (expired, or a cancel was started but not signed); the cancel flow withdraws them */
  needsWithdrawal?: boolean;
  /** ISO time this rule was last read from Jupiter order history */
  syncedAt?: string;
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
