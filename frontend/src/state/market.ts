/* Market store — live data the scene and panels read. Refreshed by pollers. */
import { create } from "zustand";
import type { AgentRule, ChartHistory, ChartRange, MarketOverview, Portfolio, TradeIntent } from "@shared/types";
import { api, type CompanyDetail, type PriceLite, type ServerStatus } from "@/market/api";

type MarketState = {
  status: ServerStatus | null;
  overview: MarketOverview | null;
  prices: Record<string, PriceLite>;
  details: Record<string, CompanyDetail>;
  histories: Record<string, ChartHistory>;
  portfolio: Portfolio | null;
  wallet: string | null;
  jurisdiction: string | null;
  orders: AgentRule[];
  trades: TradeIntent[];
  /** The trade / order currently awaiting the user's confirmation. */
  pendingTrade: TradeIntent | null;
  pendingOrder: AgentRule | null;
  lastError: string | null;

  loadStatus: () => Promise<ServerStatus | null>;
  loadOverview: () => Promise<MarketOverview | null>;
  loadPrices: (ids?: string[]) => Promise<void>;
  loadDetail: (id: string, force?: boolean) => Promise<CompanyDetail | null>;
  loadHistory: (id: string, range: ChartRange, force?: boolean) => Promise<ChartHistory | null>;
  setWallet: (w: string | null) => void;
  setJurisdiction: (j: string | null) => void;
  loadPortfolio: () => Promise<Portfolio | null>;
  setPendingTrade: (t: TradeIntent | null) => void;
  setPendingOrder: (o: AgentRule | null) => void;
  recordTrade: (t: TradeIntent) => void;
  upsertOrder: (o: AgentRule) => void;
  removeOrder: (id: string) => void;
  setError: (e: string | null) => void;
};

const LS_ORDERS = "rhea.orders.v1";
const LS_JUR = "rhea.jurisdiction.v1";

function loadLS<T>(key: string, fallback: T): T {
  try { const v = localStorage.getItem(key); return v ? (JSON.parse(v) as T) : fallback; } catch { return fallback; }
}
function saveLS(key: string, value: unknown) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* ignore */ }
}

export const useMarket = create<MarketState>((set, get) => ({
  status: null,
  overview: null,
  prices: {},
  details: {},
  histories: {},
  portfolio: null,
  wallet: null,
  jurisdiction: loadLS<string | null>(LS_JUR, null),
  orders: loadLS<AgentRule[]>(LS_ORDERS, []),
  trades: [],
  pendingTrade: null,
  pendingOrder: null,
  lastError: null,

  loadStatus: async () => {
    try { const status = await api.status(); set({ status }); return status; }
    catch (e) { set({ lastError: (e as Error).message }); return null; }
  },
  loadOverview: async () => {
    try { const overview = await api.overview(); set({ overview }); return overview; }
    catch (e) { set({ lastError: (e as Error).message }); return null; }
  },
  loadPrices: async (ids) => {
    try { const prices = await api.prices(ids); set((s) => ({ prices: { ...s.prices, ...prices } })); }
    catch (e) { console.warn("[market] prices", (e as Error).message); }
  },
  loadDetail: async (id, force) => {
    const cur = get().details[id];
    if (cur && !force && Date.now() - Date.parse(cur.price.tokenUpdatedAt ?? cur.price.underlyingUpdatedAt ?? "0") < 15_000) return cur;
    try { const d = await api.company(id); set((s) => ({ details: { ...s.details, [id]: d } })); return d; }
    catch (e) { set({ lastError: (e as Error).message }); return null; }
  },
  loadHistory: async (id, range, force) => {
    const key = `${id}:${range}`;
    const cur = get().histories[key];
    if (cur && !force && Date.now() - Date.parse(cur.fetchedAt) < (range === "1D" ? 60_000 : 600_000)) return cur;
    try { const h = await api.history(id, range); set((s) => ({ histories: { ...s.histories, [key]: h } })); return h; }
    catch (e) { console.warn("[market] history", (e as Error).message); return null; }
  },
  setWallet: (wallet) => { set({ wallet }); if (wallet) void get().loadPortfolio(); else set({ portfolio: null }); },
  setJurisdiction: (jurisdiction) => { saveLS(LS_JUR, jurisdiction); set({ jurisdiction }); },
  loadPortfolio: async () => {
    const w = get().wallet;
    if (!w) return null;
    try { const p = await api.portfolio(w); set({ portfolio: p }); return p; }
    catch (e) { console.warn("[market] portfolio", (e as Error).message); return null; }
  },
  setPendingTrade: (pendingTrade) => set({ pendingTrade }),
  setPendingOrder: (pendingOrder) => set({ pendingOrder }),
  recordTrade: (t) => set((s) => ({ trades: [t, ...s.trades.filter((x) => x.id !== t.id)].slice(0, 50) })),
  upsertOrder: (o) => set((s) => {
    const orders = [o, ...s.orders.filter((x) => x.id !== o.id)];
    saveLS(LS_ORDERS, orders);
    return { orders };
  }),
  removeOrder: (id) => set((s) => {
    const orders = s.orders.filter((x) => x.id !== id);
    saveLS(LS_ORDERS, orders);
    return { orders };
  }),
  setError: (lastError) => set({ lastError }),
}));

/** Company ids that have an onchain asset (for markers). */
export function assetForCompany(id: string) {
  return useMarket.getState().overview?.assets.find((a) => a.companyId === id) ?? null;
}
