/* Client-side fetchers for the Rhea API. */
import type {
  Briefing, ChartHistory, ChartRange, Company, CorporateAction, DbcCurvePlan, DbcPlanInput, DbcPoolStatus, DbcPreset, EligibilityResult, MarketOverview, MarketSessionInfo, NewsEvent, Portfolio, PriceSnapshot, PrivateMarketsOverview, ProofOfReserves, TokenizedAsset, TradeQuote, AssetCapability,
} from "@shared/types";

/* Where the API lives. Empty in local dev (Vite proxies /api → the backend);
 * on Railway VITE_API_URL is the backend service URL. Forgiving of a missing https://,
 * a trailing slash, or a trailing /api so a pasted URL just works. */
const RAW_API_URL = ((import.meta.env.VITE_API_URL as string | undefined) ?? "").trim();
export const API_BASE = RAW_API_URL
  ? (/^https?:\/\//i.test(RAW_API_URL) ? RAW_API_URL : `https://${RAW_API_URL}`).replace(/\/+$/, "").replace(/\/api$/i, "")
  : "";
export const apiUrl = (path: string) => `${API_BASE}${path}`;

async function j<T>(path: string, init?: RequestInit): Promise<T> {
  const url = apiUrl(path);
  const r = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } });
  const text = await r.text();
  let data: unknown = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* non-json */ }
  if (!r.ok) {
    const err = (data as { error?: string; detail?: string; eligibility?: EligibilityResult }) ?? {};
    const e = new Error(err.detail || err.error || `${r.status} ${url}`) as Error & { status?: number; eligibility?: EligibilityResult };
    e.status = r.status;
    e.eligibility = err.eligibility;
    throw e;
  }
  return data as T;
}

export type ServerStatus = { openai: boolean; jupiterKey: boolean; pythKey: boolean; streetView: boolean; rpc: string; liveModel: string; backendModel: string };
/** One tokenized wrapper of a company, priced on its own terms. A company can
 *  have more than one if two issuers wrap the same exposure. */
export type CompanyWrapperDetail = {
  asset: TokenizedAsset;
  price: PriceSnapshot;
  capability: AssetCapability;
  disclosure: string;
  disclosureUrl: string;
};
export type CompanyDetail = {
  company: Company; asset: TokenizedAsset | null; price: PriceSnapshot; corporateActions: CorporateAction[];
  capability: AssetCapability | null;
  /** xStocks proof of reserves; null (or absent on an older backend) when the issuer API didn't answer. */
  reserves?: ProofOfReserves | null;
  disclosure?: string; disclosureUrl?: string;
  /** Absent on an older backend; treat as just the primary wrapper. */
  wrappers?: CompanyWrapperDetail[];
};
export type PriceLite = { tokenPriceUsd: number | null; underlyingPriceUsd: number | null; change24hPct: number | null; updatedAt: string };

export type TriggerStep = "challenge" | "verify" | "vault" | "deposit" | "order" | "cancel" | "confirm-cancel" | "history";
/** One order from Trigger V2 order history (developers.jup.ag/docs/trigger/order-history). Every field is
 * optional here on purpose: trade.ts parses it defensively and skips orders it can't map. */
export type JupiterOrderEvent = { type?: string; timestamp?: number | string; state?: string; txSignature?: string; mint?: string; amount?: string };
export type JupiterOrder = {
  id?: string; orderType?: string; orderState?: string; rawState?: string; userPubkey?: string;
  inputMint?: string; outputMint?: string; initialInputAmount?: string; remainingInputAmount?: string;
  triggerMint?: string; triggerCondition?: string; triggerPriceUsd?: number | string; slippageBps?: number;
  expiresAt?: number | string; createdAt?: number | string; updatedAt?: number | string;
  events?: JupiterOrderEvent[]; triggeredAt?: number | string; outputAmount?: string; fillPercent?: number;
};

export const api = {
  status: () => j<ServerStatus>("/api/market/status"),
  overview: () => j<MarketOverview>("/api/market/overview"),
  company: (id: string) => j<CompanyDetail>(`/api/market/company/${encodeURIComponent(id)}`),
  prices: (ids?: string[]) => j<Record<string, PriceLite>>(`/api/market/prices${ids?.length ? `?ids=${ids.join(",")}` : ""}`),
  history: (id: string, range: ChartRange) => j<ChartHistory>(`/api/market/history/${encodeURIComponent(id)}?range=${range}`),
  portfolio: (wallet: string) => j<Portfolio>(`/api/market/portfolio/${wallet}`),
  session: () => j<MarketSessionInfo>("/api/market/session"),
  /* A wallet's briefing, or (no wallet) one on company ids / tickers; the server falls back to NVDAx, SPYx, TSLAx. */
  briefing: (wallet: string | null, watch?: string[]) =>
    j<Briefing>(wallet ? `/api/market/briefing/${encodeURIComponent(wallet)}` : `/api/market/briefing${watch?.length ? `?watch=${watch.map(encodeURIComponent).join(",")}` : ""}`),
  eligibility: (company: string, action: "buy" | "sell" | "trigger", amountUsd?: number) =>
    j<{ company: Company; asset: TokenizedAsset | null; result: EligibilityResult }>("/api/market/eligibility", { method: "POST", body: JSON.stringify({ company, action, amountUsd }) }),
  quote: (company: string, side: "buy" | "sell", amount: number, taker: string) =>
    j<{ quote: TradeQuote; eligibility: EligibilityResult; asset: TokenizedAsset }>("/api/market/quote", { method: "POST", body: JSON.stringify({ company, side, amount, taker }) }),
  execute: (signedTransaction: string, requestId: string) =>
    j<{ status: string; signature?: string; error?: string; code?: number }>("/api/market/execute", { method: "POST", body: JSON.stringify({ signedTransaction, requestId }) }),
  /* Trigger V2 proxy; request/response shapes are in the block comment above the router in backend/src/market.ts.
   * A thrown error carries .status (401 = JWT expired or invalid: trade.ts drops its cached token). */
  trigger: (step: TriggerStep, body: unknown, jwt?: string) =>
    j<Record<string, unknown>>(`/api/market/trigger/${step}`, { method: "POST", body: JSON.stringify(body ?? {}), headers: jwt ? { "x-trigger-jwt": jwt } : {} }),
  /* Private (pre-IPO) markets: PreStocks, their issuer marks and what
   * the onchain market pays over them. */
  privateMarkets: () => j<PrivateMarketsOverview>("/api/market/private"),
  /* Meteora DBC studio — all read-only. */
  dbcPresets: () => j<{ presets: DbcPreset[]; default: string }>("/api/market/dbc/presets"),
  dbcPlan: (body: Partial<DbcPlanInput> & { companyId?: string }) =>
    j<DbcCurvePlan>("/api/market/dbc/plan", { method: "POST", body: JSON.stringify(body) }),
  dbcPool: (address: string) => j<DbcPoolStatus>(`/api/market/dbc/pool/${encodeURIComponent(address)}`),
  streetViewUrl: (id: string) => apiUrl(`/api/market/streetview/${encodeURIComponent(id)}`),
  /* Headline wire: recent stories for a query, up within a second of a focus (the voice model's picks replace them). */
  news: (q: string) => j<{ items: NewsEvent[] }>(`/api/market/news?q=${encodeURIComponent(q)}`),
  faviconUrl: (domain: string) => apiUrl(`/api/market/favicon?domain=${encodeURIComponent(domain)}`),
};
