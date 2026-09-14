/* Jupiter integration (spec §6.2): token discovery, onchain price, swap quotes,
 * execution, and the Trigger V2 proxy. Keyless requests go to lite-api.jup.ag;
 * with JUPITER_API_KEY we use api.jup.ag (Swap V2, stocks tag, Trigger). */
import { COMPANIES, COMPANY_BY_TOKEN, USDC_MINT } from "../shared/registry";
import type { TokenizedAsset, TradeQuote, TradeSide } from "../shared/types";

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

async function getJson<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, { ...init, headers: headers((init?.headers as Record<string, string>) ?? {}) });
  const text = await r.text();
  if (!r.ok) throw new Error(`Jupiter ${r.status} ${url.split("?")[0]}: ${text.slice(0, 300)}`);
  return JSON.parse(text) as T;
}

/* ---------------- Token discovery ---------------- */

type JupToken = {
  id: string; name: string; symbol: string; icon?: string; decimals: number;
  tokenProgram?: string; usdPrice?: number; liquidity?: number; holderCount?: number;
  tags?: string[];
};

let assetCache: { at: number; assets: TokenizedAsset[] } | null = null;
const ASSET_TTL_MS = 10 * 60_000;

/** All tokenized equities we can place on the globe.
 *  - Keyless: registry seed mints + ONE batched Price v3 call (liquidity → tradable).
 *  - With a key: the `stocks` tag refreshes metadata/discovers new listings. */
export async function listTokenizedAssets(force = false): Promise<TokenizedAsset[]> {
  if (!force && assetCache && Date.now() - assetCache.at < ASSET_TTL_MS) return assetCache.assets;

  const found = new Map<string, JupToken>();
  if (API_KEY) {
    try {
      const list = await getJson<JupToken[]>(`${KEYED}/tokens/v2/tag?query=stocks`);
      for (const t of list) found.set(t.symbol.toUpperCase(), t);
    } catch (e) {
      console.warn("[jupiter] stocks tag failed, using seeds:", (e as Error).message);
    }
  }
  for (const co of COMPANIES) {
    const sym = co.tokenSymbol.toUpperCase();
    if (co.seedMint && !found.has(sym)) {
      found.set(sym, { id: co.seedMint, name: `${co.name} xStock`, symbol: co.tokenSymbol, decimals: 8, tokenProgram: "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb", tags: ["xstocks", "stocks"] });
    }
  }

  /* One batched price call tells us which listings actually have liquidity. */
  const mints = [...found.values()].map((t) => t.id);
  let prices: Record<string, JupPrice> = {};
  try { prices = await getPrices(mints); }
  catch (e) { console.warn("[jupiter] price batch failed:", (e as Error).message); }

  const assets: TokenizedAsset[] = [];
  for (const [sym, t] of found) {
    const company = COMPANY_BY_TOKEN[sym];
    if (!company) continue; // only surface assets we can place on the globe
    const p = prices[t.id];
    const liquidity = p?.liquidity ?? t.liquidity ?? 0;
    const price = p?.usdPrice ?? t.usdPrice ?? 0;
    assets.push({
      id: `${company.id}:solana`,
      companyId: company.id,
      chain: "solana",
      mint: t.id,
      symbol: t.symbol,
      name: t.name,
      issuer: "xStocks (Backed)",
      decimals: p?.decimals ?? t.decimals,
      tradable: price > 0 && liquidity > 0,
      icon: t.icon,
      tokenProgram: t.tokenProgram,
      liquidityUsd: liquidity || undefined,
      holderCount: t.holderCount,
    });
  }
  assets.sort((a, b) => (b.liquidityUsd ?? 0) - (a.liquidityUsd ?? 0));
  assetCache = { at: Date.now(), assets };
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
  for (let i = 0; i < missing.length; i += 50) {
    const batch = missing.slice(i, i + 50);
    const data = await getJson<Record<string, JupPrice | null>>(`${BASE}/price/v3?ids=${batch.join(",")}`);
    for (const m of batch) {
      const p = data[m];
      if (p) { out[m] = p; priceCache.set(m, { at: Date.now(), data: { [m]: p } }); }
    }
  }
  return out;
}

/* ---------------- Swap quote + execute ---------------- */

type OrderResponse = {
  requestId: string; transaction?: string | null; inAmount: string; outAmount: string;
  priceImpactPct?: string | number; slippageBps?: number; routePlan?: { swapInfo?: { label?: string } }[];
  router?: string; swapType?: string; signatureFeeLamports?: number; prioritizationFeeLamports?: number; rentFeeLamports?: number;
  errorMessage?: string; error?: string;
};

export async function getSwapQuote(opts: {
  side: TradeSide; companyId: string; asset: TokenizedAsset; amountUi: number; taker: string;
}): Promise<TradeQuote> {
  const { side, asset, amountUi, taker } = opts;
  const inputMint = side === "buy" ? USDC_MINT : asset.mint;
  const outputMint = side === "buy" ? asset.mint : USDC_MINT;
  const inDecimals = side === "buy" ? 6 : asset.decimals;
  const outDecimals = side === "buy" ? asset.decimals : 6;
  const amount = BigInt(Math.round(amountUi * 10 ** inDecimals)).toString();

  const provider: TradeQuote["provider"] = API_KEY ? "jupiter-swap-v2" : "jupiter-ultra";
  const path = API_KEY ? "/swap/v2/order" : "/ultra/v1/order";
  const url = `${BASE}${path}?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amount}&taker=${taker}`;
  const o = await getJson<OrderResponse>(url);
  if (o.error || o.errorMessage) throw new Error(o.errorMessage || o.error || "Quote failed");
  if (!o.transaction) throw new Error("Jupiter returned no transaction (insufficient balance or unroutable)");

  const engine = o.router || o.swapType || o.routePlan?.[0]?.swapInfo?.label || "aggregator";
  return {
    requestId: o.requestId,
    side,
    companyId: opts.companyId,
    inputMint,
    outputMint,
    inAmount: o.inAmount,
    outAmount: o.outAmount,
    inAmountUi: Number(o.inAmount) / 10 ** inDecimals,
    outAmountUi: Number(o.outAmount) / 10 ** outDecimals,
    inSymbol: side === "buy" ? "USDC" : asset.symbol,
    outSymbol: side === "buy" ? asset.symbol : "USDC",
    /* Jupiter reports price impact as a percentage string (may be negative). */
    priceImpactPct: Math.abs(Number(o.priceImpactPct ?? 0)),
    slippageBps: o.slippageBps ?? 50,
    route: `Jupiter · ${engine}`,
    feeLamports: (o.signatureFeeLamports ?? 5000) + (o.prioritizationFeeLamports ?? 0),
    transaction: o.transaction,
    quotedAt: new Date().toISOString(),
    provider,
  };
}

export async function executeSwap(signedTransaction: string, requestId: string) {
  const path = API_KEY ? "/swap/v2/execute" : "/ultra/v1/execute";
  return getJson<{ status: string; signature?: string; code?: number; error?: string; totalOutputAmount?: string }>(
    `${BASE}${path}`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ signedTransaction, requestId }) },
  );
}

/* ---------------- Trigger V2 proxy ---------------- */

const TRIGGER = `${KEYED}/trigger/v2`;

export async function triggerProxy(path: string, init: { method?: string; body?: unknown; jwt?: string } = {}) {
  if (!API_KEY) throw new Error("JUPITER_API_KEY is required for Trigger V2");
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (init.jwt) h.Authorization = `Bearer ${init.jwt}`;
  return getJson<Record<string, unknown>>(`${TRIGGER}${path}`, {
    method: init.method ?? (init.body ? "POST" : "GET"),
    headers: h,
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
}
