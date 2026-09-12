/* Client-side fetchers for the Rhea API. */
import type {
  ChartHistory, ChartRange, Company, CorporateAction, EligibilityResult, MarketOverview, Portfolio, PriceSnapshot, TokenizedAsset, TradeQuote, AssetCapability,
} from "@shared/types";

async function j<T>(url: string, init?: RequestInit): Promise<T> {
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
export type CompanyDetail = { company: Company; asset: TokenizedAsset | null; price: PriceSnapshot; corporateActions: CorporateAction[]; capability: AssetCapability | null };
export type PriceLite = { tokenPriceUsd: number | null; underlyingPriceUsd: number | null; change24hPct: number | null; updatedAt: string };

export const api = {
  status: () => j<ServerStatus>("/api/market/status"),
  overview: () => j<MarketOverview>("/api/market/overview"),
  company: (id: string) => j<CompanyDetail>(`/api/market/company/${encodeURIComponent(id)}`),
  prices: (ids?: string[]) => j<Record<string, PriceLite>>(`/api/market/prices${ids?.length ? `?ids=${ids.join(",")}` : ""}`),
  history: (id: string, range: ChartRange) => j<ChartHistory>(`/api/market/history/${encodeURIComponent(id)}?range=${range}`),
  portfolio: (wallet: string) => j<Portfolio>(`/api/market/portfolio/${wallet}`),
  eligibility: (company: string, jurisdiction: string | null, action: "buy" | "sell" | "trigger", amountUsd?: number) =>
    j<{ company: Company; asset: TokenizedAsset | null; result: EligibilityResult }>("/api/market/eligibility", { method: "POST", body: JSON.stringify({ company, jurisdiction, action, amountUsd }) }),
  quote: (company: string, side: "buy" | "sell", amount: number, taker: string, jurisdiction: string | null) =>
    j<{ quote: TradeQuote; eligibility: EligibilityResult; asset: TokenizedAsset }>("/api/market/quote", { method: "POST", body: JSON.stringify({ company, side, amount, taker, jurisdiction }) }),
  execute: (signedTransaction: string, requestId: string) =>
    j<{ status: string; signature?: string; error?: string; code?: number }>("/api/market/execute", { method: "POST", body: JSON.stringify({ signedTransaction, requestId }) }),
  trigger: (step: "challenge" | "verify" | "vault" | "deposit" | "order" | "cancel" | "history", body: unknown, jwt?: string) =>
    j<Record<string, unknown>>(`/api/market/trigger/${step}`, { method: "POST", body: JSON.stringify(body ?? {}), headers: jwt ? { "x-trigger-jwt": jwt } : {} }),
  streetViewUrl: (id: string) => `/api/market/streetview/${encodeURIComponent(id)}`,
};
