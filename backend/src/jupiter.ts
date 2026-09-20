/* Jupiter integration (spec §6.2): token discovery, onchain price, swap quotes,
 * execution, and the Trigger V2 proxy. Keyless requests go to lite-api.jup.ag;
 * with JUPITER_API_KEY we use api.jup.ag (Swap V2, stocks tag, Trigger). */
import {
  COMPANIES, COMPANY_BY_TOKEN, MIN_TRADABLE_LIQUIDITY_USD, PRESTOCKS_ISSUER, SOL_MINT, TRIGGER_MIN_ORDER_USD, USDC_MINT,
  assetIdFor, effectiveUiMultiplier, rawToUiAmount, uiToRawAmount,
} from "../shared/registry";
import type { Company, IssuerKey, TokenizedAsset, TradeQuote, TradeSide } from "../shared/types";
import { preStocksCatalog } from "./prestocks";

const API_KEY = process.env.JUPITER_API_KEY || "";
const KEYED = "https://api.jup.ag";
const LITE = "https://lite-api.jup.ag";
const BASE = API_KEY ? KEYED : LITE;

export const hasJupiterKey = () => Boolean(API_KEY);

function headers(extra: Record<string, string> = {}) {
  const h: Record<string, string> = { Accept: "application/json", ...extra };
  if (API_KEY) h["x-api-key"] = API_KEY;
  return h;
}

/* ---------------- Errors ----------------
 * Jupiter's raw error text ("Jupiter 400 /trigger/v2/deposit/craft: {...}") stays
 * in the server log and in `raw`; `message` is one plain sentence safe to show a
 * user or read aloud. market.ts sends `message` as `error` and `raw` only as
 * `debug` outside production. */
type ErrorContext = "swap" | "execute" | "trigger" | "read";

export class JupiterError extends Error {
  constructor(public status: number, message: string, public raw: string) { super(message); }
  /** HTTP status to relay: meaningful 4xx pass through (401 = re-auth Trigger), upstream faults become 502. */
  get httpStatus() { return [400, 401, 403, 404, 409, 429, 501].includes(this.status) ? this.status : 502; }
}

export function friendlyJupiterMessage(status: number, raw: string, ctx: ErrorContext, errorCode?: number, router?: string): string {
  const t = raw.toLowerCase();
  const rfq = router === "jupiterz";
  if (status === 429 || /rate.?limit|too many requests/.test(t)) return "Jupiter is rate-limiting requests right now, so please wait a few seconds and try again.";
  if (ctx === "trigger") {
    if (/challenge|invalid signature/.test(t)) return "The Jupiter sign-in request expired or wasn't signed correctly, so please sign again.";
    if (status === 401 || /unauthori[sz]ed|jwt|token expired/.test(t)) return "Your Jupiter order session has expired, so please sign the Jupiter message again to continue.";
    if (/at least 10 usd|must be at least/.test(t)) return `Jupiter limit orders need at least $${TRIGGER_MIN_ORDER_USD}, so raise the amount and try again.`;
    if (/transfer.?hook|transfer.?fee|whitelist/.test(t)) return "Jupiter limit orders don't accept this token as a deposit yet, so use a USDC buy order instead.";
    if (/ready to cancel|cancellable|not in .*state/.test(t)) return "This order can't be changed right now because it may be filling, so try again in a moment.";
    if (/different wallet|does not match/.test(t) || status === 403) return "This order belongs to a different wallet than the one signed in.";
    if (/vault already registered/.test(t) || status === 409) return "Your Jupiter order vault already exists, so just continue with the order.";
    if (status === 404) return "Jupiter couldn't find that order, so it may already be filled, cancelled or expired.";
    if (/tp.*greater|take.?profit/.test(t)) return "The take-profit price has to be above the stop-loss price.";
    if (/expiresat|expiry/.test(t)) return "The order needs an expiry date in the future.";
    if (/duplicate deposit/.test(t)) return "That deposit was already used, so start the order again for a fresh one.";
    if (/invalid.*(signed|transaction)|mismatched withdrawal/.test(t)) return "Jupiter couldn't accept the signed transaction, so please start this step again.";
  }
  if (/insufficient sol|not enough sol|for gas/.test(t) || (!rfq && errorCode === 2)) return "Your wallet needs a little SOL to pay the Solana network fee for this trade.";
  if (/below minimum for gasless/.test(t) || (!rfq && errorCode === 3)) return "This trade is too small to go through without SOL for fees, so add a little SOL or trade a larger amount.";
  if (rfq && errorCode === 2) return "Your wallet isn't set up to receive this token yet, so add a little SOL and try again.";
  if (/insufficient (funds|balance)|not enough balance/.test(t) || errorCode === 1) return "Your wallet doesn't hold enough of the token you're paying with for this trade.";
  if (/no route|could not find any route|route not found|unroutable|no liquidity|not tradable/.test(t) || (rfq && errorCode === 3)) return "Jupiter couldn't find a route for this trade right now, because the market is too thin at this size.";
  if (/too small|amount.*(below|minimum)|minimum amount/.test(t)) return "That amount is too small to trade, so try a larger amount.";
  if (ctx !== "trigger" && /slippage|price moved|expired|requestid|missing cached order|blockhash|block height/.test(t)) return "The quote expired or the price moved, so get a fresh quote and try again.";
  if (/same as outputmint|invalid (input|output)mint|invalid mint/.test(t)) return "That token pair can't be swapped on Jupiter.";
  if (/invalid (taker|wallet|public ?key|user)/.test(t)) return "That wallet address isn't a valid Solana address.";
  if (/decode signed|invalid signed|not fully signed|signature verification/.test(t)) return "Jupiter couldn't accept the signed transaction, so get a fresh quote and try again.";
  if (ctx === "trigger" && (status === 400 || /validation/.test(t))) return "Jupiter rejected the order details, so check the price, amount and expiry and try again.";
  if (status >= 500 || status === 0) return "Jupiter is having trouble right now, so please try again in a minute.";
  return ctx === "read" ? "Market data from Jupiter is unavailable right now, so please try again shortly." : "Jupiter couldn't complete this request, so please try again.";
}

const contextFor = (url: string): ErrorContext =>
  url.includes("/trigger/") ? "trigger" : url.includes("/execute") ? "execute" : /\/order(\?|$)/.test(url) ? "swap" : "read";

function jupiterError(status: number, url: string, text: string, errorCode?: number, router?: string): JupiterError {
  const raw = `Jupiter ${status} ${url.split("?")[0]}: ${text.slice(0, 300)}`;
  console.warn(`[jupiter] ${raw}`);
  const ctx = contextFor(url);
  /* /execute also fails with HTTP 400 + { code, error }: reuse the code table. */
  let code: number | undefined;
  try { const b = JSON.parse(text) as { code?: unknown }; if (typeof b.code === "number") code = b.code; } catch { /* not json */ }
  const message = ctx === "execute" && code != null && code < 0 ? executeFailureMessage(code, text) : friendlyJupiterMessage(status, text, ctx, errorCode, router);
  return new JupiterError(status, message, raw);
}

async function getJson<T>(url: string, init?: RequestInit): Promise<T> {
  let r: globalThis.Response;
  try {
    r = await fetch(url, { ...init, headers: headers((init?.headers as Record<string, string>) ?? {}) });
  } catch (e) {
    throw jupiterError(0, url, `network: ${(e as Error).message}`);
  }
  const text = await r.text();
  if (!r.ok) throw jupiterError(r.status, url, text);
  return JSON.parse(text) as T;
}

/** Keyless fallback for public read endpoints: if the keyed host rejects us
 *  (bad/expired key, plan rate limit) fall back to lite-api so a mis-set
 *  JUPITER_API_KEY degrades the app instead of emptying it. */
let keyRejected = false;
const usingLite = () => !API_KEY || keyRejected;

async function getPublicJson<T>(path: string): Promise<T> {
  if (usingLite()) return getLiteJson<T>(path);
  try {
    return await getJson<T>(`${BASE}${path}`);
  } catch (e) {
    const s = (e as JupiterError).status;
    if (s === 401 || s === 403) {
      keyRejected = true;
      console.warn(`[jupiter] API key rejected (${s}) — public reads fall back to lite-api; check JUPITER_API_KEY`);
      return getLiteJson<T>(path);
    }
    if (s === 429) return getLiteJson<T>(path);
    throw e;
  }
}

/* lite-api allows ~60 req/min per IP; back off on 429 rather than give up. */
async function getLiteJson<T>(path: string, attempt = 0): Promise<T> {
  const r = await fetch(`${LITE}${path}`, { headers: { Accept: "application/json" } });
  const text = await r.text();
  if (r.status === 429 && attempt < 3) {
    const wait = Number(r.headers.get("retry-after")) * 1000 || 4_000 * (attempt + 1);
    console.warn(`[jupiter] lite 429 on ${path.split("?")[0]} — waiting ${wait}ms`);
    await new Promise((res) => setTimeout(res, wait));
    return getLiteJson<T>(path, attempt + 1);
  }
  if (!r.ok) throw jupiterError(r.status, `${LITE}${path}`, text);
  return JSON.parse(text) as T;
}

/* ---------------- Token discovery ---------------- */

type JupToken = {
  id: string; name: string; symbol: string; icon?: string; decimals: number;
  tokenProgram?: string; usdPrice?: number; liquidity?: number; holderCount?: number;
  tags?: string[];
};

const TOKEN_2022 = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
/* xStocks mint at 8 decimals, PreStocks at 9. Overridden by whatever
 * Jupiter Price v3 reports for the mint. */
const DEFAULT_DECIMALS: Record<IssuerKey, number> = { xstocks: 8, prestocks: 9 };
const issuerName = (k: IssuerKey) => (k === "prestocks" ? PRESTOCKS_ISSUER : "xStocks (Backed)");
const issuerLabel = (k: IssuerKey) => (k === "prestocks" ? "PreStock" : "xStock");

/** One tokenized wrapper of one company, before it is priced. */
type WrapperRef = {
  company: Company; issuerKey: IssuerKey; primary: boolean; mint: string;
  symbol: string; name: string; icon?: string; decimals?: number;
  tokenProgram?: string; holderCount?: number; liquidity?: number;
};

let assetCache: { at: number; assets: TokenizedAsset[] } | null = null;
const ASSET_TTL_MS = 10 * 60_000;

/** All tokenized equities we can place on the globe — the full xStocks catalog
 *  (~830 mints), each checked against Jupiter Price v3 for onchain liquidity.
 *  - Keyless: catalog mints + batched Price v3 calls (liquidity → tradable).
 *  - With a key: the `stocks` tag refreshes metadata/discovers new listings. */
export async function listTokenizedAssets(force = false): Promise<TokenizedAsset[]> {
  if (!force && assetCache && Date.now() - assetCache.at < ASSET_TTL_MS) return assetCache.assets;

  /* Every wrapper we might place on the globe, keyed by mint so two issuers of
   * the same company never collide. */
  const refs = new Map<string, WrapperRef>();
  const addRef = (r: WrapperRef) => { if (r.mint) refs.set(r.mint, { ...refs.get(r.mint), ...r }); };

  for (const co of COMPANIES) {
    if (co.seedMint) {
      addRef({
        company: co, issuerKey: co.issuerKey ?? "xstocks", primary: true, mint: co.seedMint,
        symbol: co.tokenSymbol, name: `${co.name} ${issuerLabel(co.issuerKey ?? "xstocks")}`,
        icon: co.icon, decimals: DEFAULT_DECIMALS[co.issuerKey ?? "xstocks"], tokenProgram: TOKEN_2022,
      });
    }
    for (const w of co.wrappers ?? []) {
      addRef({
        company: co, issuerKey: w.issuerKey, primary: false, mint: w.mint,
        symbol: w.tokenSymbol, name: `${co.name} ${issuerLabel(w.issuerKey)}`,
        decimals: DEFAULT_DECIMALS[w.issuerKey], tokenProgram: TOKEN_2022,
      });
    }
  }

  /* Live issuer catalogs refresh the seeds: mints, symbols and which markets
   * exist all come from the issuer, never from a constant in this repo. */
  const preStocks = await preStocksCatalog().catch(() => null);
  if (preStocks) {
    for (const t of preStocks) {
      const co = COMPANY_BY_TOKEN[t.symbol.toUpperCase()];
      if (!co) continue;
      const primary = (co.issuerKey ?? "xstocks") === "prestocks";
      /* A refreshed mint supersedes the seed for the same company+issuer. */
      for (const [mint, r] of refs) if (r.company.id === co.id && r.issuerKey === "prestocks" && mint !== t.mint) refs.delete(mint);
      addRef({
        company: co, issuerKey: "prestocks", primary, mint: t.mint,
        symbol: t.symbol, name: t.name, icon: t.image, decimals: 9, tokenProgram: TOKEN_2022,
      });
    }
  }

  /* With a key, the `stocks` tag refreshes xStocks metadata and finds listings
   * that are not yet in the bundled catalog. */
  if (API_KEY) {
    try {
      const list = await getPublicJson<JupToken[]>(`/tokens/v2/tag?query=stocks`);
      if (Array.isArray(list)) {
        for (const t of list) {
          const co = COMPANY_BY_TOKEN[t.symbol.toUpperCase()];
          if (!co) continue;
          const existing = refs.get(t.id);
          addRef({
            company: co,
            issuerKey: existing?.issuerKey ?? co.issuerKey ?? "xstocks",
            primary: existing?.primary ?? co.tokenSymbol.toUpperCase() === t.symbol.toUpperCase(),
            mint: t.id, symbol: t.symbol, name: t.name, icon: t.icon,
            decimals: t.decimals, tokenProgram: t.tokenProgram, holderCount: t.holderCount,
            liquidity: t.liquidity,
          });
        }
      }
    } catch (e) {
      console.warn("[jupiter] stocks tag failed, using seeds:", (e as Error).message);
    }
  }

  /* Batched price calls tell us which listings actually have liquidity. */
  const mints = [...refs.keys()];
  let prices: Record<string, JupPrice> = {};
  try { prices = await getPrices(mints); }
  catch (e) { console.warn("[jupiter] price batch failed:", (e as Error).message); }
  if (Object.keys(prices).length === 0) {
    /* Total pricing failure (key rejected, outage): keep serving the last good
     * snapshot rather than publishing "nothing is tradable" for ASSET_TTL_MS. */
    console.warn("[jupiter] no prices returned — keeping previous asset snapshot");
    if (assetCache) return assetCache.assets;
  }

  const assets: TokenizedAsset[] = [];
  for (const [mint, r] of refs) {
    const p = prices[mint];
    const liquidity = p?.liquidity ?? r.liquidity ?? 0;
    const price = p?.usdPrice ?? 0;
    assets.push({
      id: assetIdFor(r.company.id, r.issuerKey, r.primary),
      companyId: r.company.id,
      issuerKey: r.issuerKey,
      primary: r.primary,
      chain: "solana",
      mint,
      symbol: r.symbol,
      name: r.name,
      issuer: issuerName(r.issuerKey),
      decimals: p?.decimals ?? r.decimals ?? 8,
      /* Dust pools (a few dollars) route nowhere — only real liquidity counts. */
      tradable: price > 0 && liquidity >= MIN_TRADABLE_LIQUIDITY_USD,
      icon: r.icon || r.company.icon,
      tokenProgram: r.tokenProgram,
      liquidityUsd: liquidity || undefined,
      holderCount: r.holderCount,
      /* Clients need this to turn a UI amount (what the wallet shows) into raw units for Jupiter. */
      scaledUi: p?.scaledUiConfig
        ? { multiplier: p.scaledUiConfig.multiplier, newMultiplier: p.scaledUiConfig.newMultiplier, newMultiplierEffectiveAt: p.scaledUiConfig.newMultiplierEffectiveAt }
        : undefined,
    });
  }
  assets.sort((a, b) => (b.liquidityUsd ?? 0) - (a.liquidityUsd ?? 0));
  /* A snapshot with no prices at all is retried soon instead of held for the full TTL. */
  const priced = Object.keys(prices).length > 0;
  assetCache = { at: priced ? Date.now() : Date.now() - ASSET_TTL_MS + 30_000, assets };
  return assets;
}

/* ---------------- Price v3 ---------------- */

export type JupPrice = {
  usdPrice: number; blockId?: number; decimals: number; priceChange24h?: number; liquidity?: number;
  stockData?: { id: string; price: number; mcap?: number; updatedAt: string };
  scaledUiConfig?: { multiplier: number; newMultiplier?: number; newMultiplierEffectiveAt?: string };
};

const priceCache = new Map<string, { at: number; data: Record<string, JupPrice> }>();

export async function getPrices(mints: string[]): Promise<Record<string, JupPrice>> {
  const uniq = [...new Set(mints)].filter(Boolean);
  const out: Record<string, JupPrice> = {};
  const missing: string[] = [];
  for (const m of uniq) {
    const c = priceCache.get(m);
    if (c && Date.now() - c.at < 8_000) out[m] = c.data[m];
    else missing.push(m);
  }
  let failed = 0;
  let lastErr: Error | undefined;
  for (let i = 0; i < missing.length; i += 50) {
    const batch = missing.slice(i, i + 50);
    /* The catalog refresh is ~17 batches; pace them under lite-api's ~60 req/min. */
    if (i > 0) await new Promise((r) => setTimeout(r, usingLite() ? 1_100 : 250));
    let data: Record<string, JupPrice | null>;
    try {
      data = await getPublicJson<Record<string, JupPrice | null>>(`/price/v3?ids=${batch.join(",")}`);
    } catch (e) {
      /* One bad batch must not blank the other 800 tokens. */
      failed += 1; lastErr = e as Error;
      console.warn(`[jupiter] price batch ${i / 50 + 1} failed:`, lastErr.message);
      continue;
    }
    for (const m of batch) {
      const p = data[m];
      if (p) { out[m] = p; priceCache.set(m, { at: Date.now(), data: { [m]: p } }); }
    }
  }
  if (failed && Object.keys(out).length === 0 && lastErr) throw lastErr;
  return out;
}

/* ---------------- Swap quote + execute ---------------- */

type FeePayer = string | null | undefined;
type OrderResponse = {
  requestId: string; transaction?: string | null; inAmount: string; outAmount: string;
  priceImpactPct?: string | number; slippageBps?: number; routePlan?: { swapInfo?: { label?: string } }[];
  router?: string; swapType?: string; gasless?: boolean;
  signatureFeeLamports?: number; signatureFeePayer?: FeePayer;
  prioritizationFeeLamports?: number; prioritizationFeePayer?: FeePayer;
  rentFeeLamports?: number; rentFeePayer?: FeePayer;
  /* feeBps = total rate (platform + e.g. gasless recoup); platformFee.feeBps = Jupiter's part. Both already netted out of outAmount. */
  feeBps?: number; feeMint?: string; platformFee?: { feeBps?: number; feeMint?: string; amount?: string };
  swapUsdValue?: number; inUsdValue?: number;
  errorCode?: number; errorMessage?: string; error?: string;
};

export async function getSwapQuote(opts: {
  side: TradeSide; companyId: string; asset: TokenizedAsset; amountUi: number; taker: string;
}): Promise<TradeQuote> {
  const { side, asset, amountUi, taker } = opts;
  const inputMint = side === "buy" ? USDC_MINT : asset.mint;
  const outputMint = side === "buy" ? asset.mint : USDC_MINT;

  /* Fresh multiplier + SOL price (8 s cache). A price outage must not block a
   * quote, so fall back to the catalog's scaled-UI config. */
  const prices = await getPrices([asset.mint, SOL_MINT]).catch(() => ({} as Record<string, JupPrice>));
  const xMultiplier = effectiveUiMultiplier(prices[asset.mint]?.scaledUiConfig ?? asset.scaledUi);
  const inDecimals = side === "buy" ? 6 : asset.decimals;
  const outDecimals = side === "buy" ? asset.decimals : 6;
  const inMultiplier = side === "buy" ? 1 : xMultiplier;
  const outMultiplier = side === "buy" ? xMultiplier : 1;
  /* A sell amount is what the wallet displays (UI); Jupiter wants raw units. */
  const amount = uiToRawAmount(amountUi, inDecimals, inMultiplier);
  if (amount === "0") throw new JupiterError(400, "That amount is too small to trade, so try a larger amount.", `amount ${amountUi} rounds to 0 raw units`);

  const provider: TradeQuote["provider"] = API_KEY ? "jupiter-swap-v2" : "jupiter-ultra";
  const path = API_KEY ? "/swap/v2/order" : "/ultra/v1/order";
  const url = `${BASE}${path}?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amount}&taker=${taker}`;
  const o = await getJson<OrderResponse>(url);
  /* 200 with transaction "" + errorCode means priced but unbuildable (e.g. balance). */
  if (o.error || o.errorMessage || !o.transaction) {
    const text = o.errorMessage || o.error || "no transaction returned";
    const e = jupiterError(400, url, `${text} (router ${o.router ?? "?"}, errorCode ${o.errorCode ?? "-"})`, o.errorCode, o.router);
    if ((o.router !== "jupiterz" && o.errorCode === 1) || /insufficient (funds|balance)/i.test(text)) {
      e.message = side === "buy"
        ? "Your wallet doesn't have enough USDC for this trade."
        : `Your wallet doesn't hold that many ${asset.symbol} tokens.`;
    }
    throw e;
  }

  const engine = o.router || o.swapType || o.routePlan?.[0]?.swapInfo?.label || "aggregator";
  const inAmountUi = rawToUiAmount(o.inAmount, inDecimals, inMultiplier);
  const outAmountUi = rawToUiAmount(o.outAmount, outDecimals, outMultiplier);

  /* Only count fees the taker actually pays: gasless routes name a Jupiter or
   * market-maker key in the *FeePayer fields. A missing payer means the taker. */
  const paidByTaker = (payer: FeePayer) => payer == null || payer === taker;
  const feeLamports =
    (paidByTaker(o.signatureFeePayer) ? (o.signatureFeeLamports ?? 5000) : 0) +
    (paidByTaker(o.prioritizationFeePayer) ? (o.prioritizationFeeLamports ?? 0) : 0);
  const rentLamports = paidByTaker(o.rentFeePayer) ? (o.rentFeeLamports ?? 0) : 0;
  const solUsd = prices[SOL_MINT]?.usdPrice;
  const feeBps = o.feeBps ?? o.platformFee?.feeBps;
  const swapUsd = o.swapUsdValue ?? o.inUsdValue ?? (side === "buy" ? inAmountUi : outAmountUi);
  const usd = (n: number) => Math.round(n * 1e4) / 1e4;

  return {
    requestId: o.requestId,
    side,
    companyId: opts.companyId,
    inputMint,
    outputMint,
    inAmount: o.inAmount,
    outAmount: o.outAmount,
    inAmountUi,
    outAmountUi,
    inSymbol: side === "buy" ? "USDC" : asset.symbol,
    outSymbol: side === "buy" ? asset.symbol : "USDC",
    /* Jupiter reports price impact as a percentage string (may be negative). */
    priceImpactPct: Math.abs(Number(o.priceImpactPct ?? 0)),
    slippageBps: o.slippageBps ?? 50,
    route: `Jupiter · ${engine}`,
    feeLamports,
    transaction: o.transaction,
    quotedAt: new Date().toISOString(),
    provider,
    feeBps,
    platformFeeUsd: feeBps != null && swapUsd > 0 ? usd((swapUsd * feeBps) / 10_000) : undefined,
    networkFeeUsd: solUsd ? usd((feeLamports / 1e9) * solUsd) : undefined,
    rentFeeUsd: solUsd && rentLamports ? usd((rentLamports / 1e9) * solUsd) : undefined,
  };
}

/* /execute answers 200 with status "Failed" + a negative code; map those codes
 * (docs: swap/order-and-execute#execute-error-codes) to one sentence. */
function executeFailureMessage(code: number | undefined, raw: string): string {
  switch (code) {
    case -1: case -2003: return "The quote expired before the swap was sent, so get a fresh quote and try again.";
    case -2: case -3: case -1002: case -1003: case -2002: return "Jupiter couldn't accept the signed transaction, so get a fresh quote and try again.";
    case -1004: return "The transaction expired before it landed, so get a fresh quote and try again.";
    case -1000: case -2000: return "The swap didn't land on Solana in time, so check your balance and try again with a fresh quote.";
    case -2004: return "The market maker declined this swap, so get a fresh quote and try again.";
    default: return friendlyJupiterMessage(400, raw, "execute", code);
  }
}

export async function executeSwap(signedTransaction: string, requestId: string) {
  const path = API_KEY ? "/swap/v2/execute" : "/ultra/v1/execute";
  const res = await getJson<{ status: string; signature?: string; code?: number; error?: string; totalOutputAmount?: string }>(
    `${BASE}${path}`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ signedTransaction, requestId }) },
  );
  if (res.status === "Success") return { ...res, raw: undefined as string | undefined };
  const raw = `status ${res.status} code ${res.code ?? "-"}: ${res.error ?? ""}`;
  console.warn(`[jupiter] execute ${requestId} ${raw}${res.signature ? ` sig ${res.signature}` : ""}`);
  return { ...res, error: executeFailureMessage(res.code, res.error ?? ""), raw };
}

/* ---------------- Trigger V2 proxy ---------------- */

const TRIGGER = `${KEYED}/trigger/v2`;

export async function triggerProxy(path: string, init: { method?: string; body?: unknown; jwt?: string } = {}) {
  if (!API_KEY) throw new JupiterError(501, "Limit orders aren't switched on for this server yet.", "JUPITER_API_KEY is required for Trigger V2");
  const h: Record<string, string> = {};
  if (init.body !== undefined) h["Content-Type"] = "application/json";
  if (init.jwt) h.Authorization = `Bearer ${init.jwt}`;
  return getJson<Record<string, unknown>>(`${TRIGGER}${path}`, {
    method: init.method ?? (init.body !== undefined ? "POST" : "GET"),
    headers: h,
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
}
