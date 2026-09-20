/* Market store — live data the scene and panels read. Refreshed by pollers. */
import { create } from "zustand";
import type { AgentRule, Briefing, ChartHistory, ChartRange, MarketOverview, MarketSessionInfo, Portfolio, TradeIntent } from "@shared/types";
import { api, type CompanyDetail, type PriceLite, type ServerStatus } from "@/market/api";
import { fmtEt } from "@/theme";

/* ---------------- ?demo=1 guest mode ----------------
 * Judges without keys get a real portfolio to hear briefed: the PUBLIC address of the wallet that made the
 * filmed trades (VITE_DEMO_WALLET, never a key). It is read-only: every trade path refuses in demo mode. */
const BASE58_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const RAW_DEMO_WALLET = String(import.meta.env.VITE_DEMO_WALLET ?? "").trim();
/** Null when unset or not a Solana address; ?demo=1 then falls back to the signed-out watchlist briefing. */
export const DEMO_WALLET: string | null = BASE58_ADDRESS.test(RAW_DEMO_WALLET) ? RAW_DEMO_WALLET : null;
export const DEMO_READ_ONLY = "This is a read-only demo portfolio — sign in to trade your own wallet";
export const demoRequested = () => { try { return new URLSearchParams(window.location.search).get("demo") === "1"; } catch { return false; } };

/** A trade the user asked for that could not be prepared yet (no sign-in or
 * no USDC); resumed automatically once the blocker is cleared. */
export type PendingIntent =
  | { kind: "buy" | "sell"; companyId: string; amount: number }
  | { kind: "trigger"; companyId: string; triggerKind: "buy_below" | "sell_above"; priceUsd: number; amount: number; expiresInDays: number };
/** `after`: what Rhea should do once the user is in, for non-trade requests (e.g. "show_holdings"). */
export type LoginPrompt = { reason: string; resume?: PendingIntent; after?: string };
export type DepositPrompt = { neededUsd: number; haveUsd: number; resume?: PendingIntent };
/** "How much?" keypad, opened by the Buy $... button in the headset where there is no DOM input. */
export type AmountPrompt = { companyId: string; side: "buy" | "sell" };

type MarketState = {
  status: ServerStatus | null;
  overview: MarketOverview | null;
  prices: Record<string, PriceLite>;
  details: Record<string, CompanyDetail>;
  histories: Record<string, ChartHistory>;
  portfolio: Portfolio | null;
  wallet: string | null;
  /** The signed-in wallet's limit orders. Jupiter order history is the source of truth (syncOrders in
   * trade.ts); localStorage only caches the last sync per wallet so the globe has something at boot. */
  orders: AgentRule[];
  /** ISO time of the last successful Jupiter sync for `wallet`, null if the list is only cached/local. */
  ordersSyncedAt: string | null;
  trades: TradeIntent[];
  /** The trade / order currently awaiting the user's confirmation. */
  pendingTrade: TradeIntent | null;
  pendingOrder: AgentRule | null;
  /** What the order panel is for: placing `pendingOrder`, or cancelling / withdrawing it on Jupiter. */
  pendingOrderMode: "place" | "cancel";
  /** "Sign in to trade" panel, opened when a trade is asked for while signed out. */
  loginPrompt: LoginPrompt | null;
  /** "Fund your wallet" panel, opened when a buy needs more USDC than the wallet holds. */
  depositPrompt: DepositPrompt | null;
  /** In-headset amount keypad; null when no one is typing an amount. */
  amountPrompt: AmountPrompt | null;
  lastError: string | null;
  /** US session + "Solana: open" for the HUD pill (GET /api/market/session, polled by startSessionPolling). */
  session: MarketSessionInfo | null;
  /** Last "what changed while the market was closed" briefing: the wallet's, or the default watchlist's when signed out. */
  briefing: Briefing | null;
  /** ?demo=1 with no signed-in user: `wallet` is DEMO_WALLET, read-only. A real sign-in ends it (Auth.tsx). */
  demoMode: boolean;

  loadStatus: () => Promise<ServerStatus | null>;
  loadSession: () => Promise<MarketSessionInfo | null>;
  /** Briefing for `wallet` (store wallet by default); null wallet = the server's default watchlist. Reuses one under 60 s old. */
  loadBriefing: (wallet?: string | null, force?: boolean) => Promise<Briefing | null>;
  loadOverview: () => Promise<MarketOverview | null>;
  loadPrices: (ids?: string[]) => Promise<void>;
  loadDetail: (id: string, force?: boolean) => Promise<CompanyDetail | null>;
  loadHistory: (id: string, range: ChartRange, force?: boolean) => Promise<ChartHistory | null>;
  setWallet: (w: string | null) => void;
  loadPortfolio: () => Promise<Portfolio | null>;
  setPendingTrade: (t: TradeIntent | null) => void;
  setPendingOrder: (o: AgentRule | null, mode?: "place" | "cancel") => void;
  setLoginPrompt: (p: LoginPrompt | null) => void;
  setDepositPrompt: (p: DepositPrompt | null) => void;
  setAmountPrompt: (p: AmountPrompt | null) => void;
  recordTrade: (t: TradeIntent) => void;
  upsertOrder: (o: AgentRule) => void;
  /** Replace `wallet`'s list with a fresh Jupiter sync (ignored if the user has switched wallets meanwhile). */
  replaceOrders: (wallet: string, orders: AgentRule[], syncedAt: string) => void;
  removeOrder: (id: string) => void;
  setError: (e: string | null) => void;
  /** Loads the read-only demo wallet; false (nothing changes) when VITE_DEMO_WALLET is unset. */
  enterDemo: () => boolean;
  exitDemo: () => void;
};

/* Per-wallet order cache: { [wallet]: { orders, syncedAt } }. */
const LS_ORDERS = "rhea.orders.v2";
try { localStorage.removeItem("rhea.eligibility.v1"); } catch { /* ignore */ }
type OrderCache = Record<string, { orders: AgentRule[]; syncedAt: string | null }>;
/* Earlier builds stored a self-selected jurisdiction; the app no longer keeps one. */
try { localStorage.removeItem("rhea.jurisdiction.v1"); } catch { /* ignore */ }

function loadLS<T>(key: string, fallback: T): T {
  try { const v = localStorage.getItem(key); return v ? (JSON.parse(v) as T) : fallback; } catch { return fallback; }
}
function saveLS(key: string, value: unknown) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* ignore */ }
}

/* v1 was one flat list for every wallet and could hold simulated rules. Keep only real Jupiter orders,
 * filed under their wallet, until the next sync replaces them; then drop the old key. */
(function migrateOrdersV1() {
  try {
    const v1 = loadLS<AgentRule[] | null>("rhea.orders.v1", null);
    if (!Array.isArray(v1)) return;
    const cache = loadLS<OrderCache>(LS_ORDERS, {});
    for (const o of v1) {
      if (o?.simulated || !o?.jupiterOrderId || !o.userId || cache[o.userId]?.syncedAt) continue;
      const entry = (cache[o.userId] ??= { orders: [], syncedAt: null });
      if (!entry.orders.some((x) => x.jupiterOrderId === o.jupiterOrderId)) entry.orders.push(o);
    }
    saveLS(LS_ORDERS, cache);
    localStorage.removeItem("rhea.orders.v1");
  } catch { /* ignore */ }
})();

/** The cached list for a wallet. Production never shows simulated (local-only) rules. */
function cachedOrders(wallet: string | null): { orders: AgentRule[]; syncedAt: string | null } {
  if (!wallet) return { orders: [], syncedAt: null };
  const e = loadLS<OrderCache>(LS_ORDERS, {})[wallet];
  const orders = (Array.isArray(e?.orders) ? e.orders : []).filter((o) => o.userId === wallet && !(import.meta.env.PROD && o.simulated));
  return { orders, syncedAt: e?.syncedAt ?? null };
}
function saveOrders(wallet: string, orders: AgentRule[], syncedAt: string | null) {
  const cache = loadLS<OrderCache>(LS_ORDERS, {});
  cache[wallet] = { orders, syncedAt };
  saveLS(LS_ORDERS, cache);
}

/* In-flight dedupe: focus + visibilitychange fire together, and the greeting prewarm races get_briefing. */
let sessionReq: Promise<MarketSessionInfo | null> | null = null;
const briefingReq = new Map<string, Promise<Briefing | null>>();

/** Only stocks that can actually be traded (a price and liquidity on Solana)
 * appear on the globe, in lists and counts, and in what the AI is offered. */
function tradableOnly(o: MarketOverview): MarketOverview {
  const assets = o.assets.filter((a) => a.tradable);
  const ids = new Set(assets.map((a) => a.companyId));
  const countries = o.countries
    .map((c) => {
      const companies = c.companies.filter((id) => ids.has(id));
      return { ...c, companies, assetCount: companies.length, tradableCount: companies.length };
    })
    .filter((c) => c.companies.length > 0);
  return { ...o, assets, countries, companies: o.companies.filter((c) => ids.has(c.id)) };
}

export const useMarket = create<MarketState>((set, get) => ({
  status: null,
  overview: null,
  prices: {},
  details: {},
  histories: {},
  portfolio: null,
  wallet: null,
  orders: [],
  ordersSyncedAt: null,
  trades: [],
  pendingTrade: null,
  pendingOrder: null,
  pendingOrderMode: "place",
  loginPrompt: null,
  depositPrompt: null,
  amountPrompt: null,
  lastError: null,
  session: null,
  briefing: null,
  demoMode: false,

  loadStatus: async () => {
    try { const status = await api.status(); set({ status }); return status; }
    catch (e) { set({ lastError: (e as Error).message }); return null; }
  },
  /* Background poll: failures keep the last value and never toast. */
  loadSession: () => {
    sessionReq ??= api.session()
      .then((session) => { set({ session }); return session; })
      .catch((e) => { console.warn("[market] session", (e as Error).message); return get().session; })
      .finally(() => { sessionReq = null; });
    return sessionReq;
  },
  loadBriefing: (wallet, force) => {
    const w = wallet === undefined ? get().wallet : wallet;
    const cur = get().briefing;
    if (cur && !force && cur.wallet === w && Date.now() - Date.parse(cur.asOf) < 60_000) return Promise.resolve(cur);
    const key = w ?? "";
    const running = briefingReq.get(key);
    if (running) return running;
    const p = api.briefing(w)
      .then((b) => { set({ briefing: b }); return b; })
      .catch((e) => { console.warn("[market] briefing", (e as Error).message); return null; })
      .finally(() => briefingReq.delete(key));
    briefingReq.set(key, p);
    return p;
  },
  loadOverview: async () => {
    try { const overview = tradableOnly(await api.overview()); set({ overview }); return overview; }
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
  /* Switching wallets swaps in that wallet's cached orders; another wallet's orders never stay in view.
   * trade.ts listens for the change and syncs from Jupiter when it holds a JWT for the new wallet. */
  setWallet: (wallet) => {
    if (wallet === get().wallet) { if (wallet) void get().loadPortfolio(); return; }
    const c = cachedOrders(wallet);
    set({ wallet, orders: c.orders, ordersSyncedAt: c.syncedAt });
    if (wallet) void get().loadPortfolio(); else set({ portfolio: null });
  },
  loadPortfolio: async () => {
    const w = get().wallet;
    if (!w) return null;
    /* A demo wallet's answer landing after a real sign-in switched wallets must not overwrite the real one. */
    try { const p = await api.portfolio(w); if (get().wallet !== w) return null; set({ portfolio: p }); return p; }
    catch (e) { console.warn("[market] portfolio", (e as Error).message); return null; }
  },
  setPendingTrade: (pendingTrade) => set({ pendingTrade }),
  setPendingOrder: (pendingOrder, mode = "place") => set({ pendingOrder, pendingOrderMode: mode }),
  setLoginPrompt: (loginPrompt) => set({ loginPrompt }),
  setDepositPrompt: (depositPrompt) => set({ depositPrompt }),
  setAmountPrompt: (amountPrompt) => set({ amountPrompt }),
  recordTrade: (t) => set((s) => ({ trades: [t, ...s.trades.filter((x) => x.id !== t.id)].slice(0, 50) })),
  upsertOrder: (o) => set((s) => {
    /* Filed under the order's own wallet; only the signed-in wallet's orders are in view. */
    if (!o.userId) return {};
    const same = (x: AgentRule) => x.id === o.id || (o.jupiterOrderId != null && x.jupiterOrderId === o.jupiterOrderId);
    if (o.userId !== s.wallet) {
      const c = cachedOrders(o.userId);
      saveOrders(o.userId, [o, ...c.orders.filter((x) => !same(x))], c.syncedAt);
      return {};
    }
    const orders = [o, ...s.orders.filter((x) => !same(x))];
    saveOrders(o.userId, orders, s.ordersSyncedAt);
    return { orders };
  }),
  replaceOrders: (wallet, orders, syncedAt) => set((s) => {
    saveOrders(wallet, orders, syncedAt);
    return wallet === s.wallet ? { orders, ordersSyncedAt: syncedAt } : {};
  }),
  removeOrder: (id) => set((s) => {
    const orders = s.orders.filter((x) => x.id !== id);
    if (s.wallet) saveOrders(s.wallet, orders, s.ordersSyncedAt);
    return { orders };
  }),
  setError: (lastError) => set({ lastError }),
  enterDemo: () => {
    if (!DEMO_WALLET) return false;
    set({ demoMode: true });
    get().setWallet(DEMO_WALLET);
    return true;
  },
  exitDemo: () => {
    if (!get().demoMode) return;
    /* The caller (a real sign-in) sets its own wallet next; the demo wallet's briefing never carries over. */
    set((s) => ({ demoMode: false, briefing: s.briefing?.wallet === DEMO_WALLET ? null : s.briefing }));
  },
}));

/** Polls the session once a minute and again when the tab regains focus (phones freeze timers in the
 * background). Idempotent and app-lifetime: the desktop HUD and the headset idle card both call it. */
let sessionPolling = false;
export function startSessionPolling() {
  if (sessionPolling || typeof window === "undefined") return;
  sessionPolling = true;
  const load = () => { if (document.visibilityState !== "hidden") void useMarket.getState().loadSession(); };
  load();
  window.setInterval(load, 60_000);
  window.addEventListener("focus", load);
  document.addEventListener("visibilitychange", load);
}

/** HUD pill wording. Weeknights are only "regular session closed" (xStocks trade 24/5 with an overnight
 * period); the weekend wording comes from the server's label, never from the local clock. `short` fits a phone. */
export function sessionPill(s: MarketSessionInfo, now = Date.now()): { open: boolean; long: string; short: string } {
  if (s.usRegularOpen) return { open: true, long: "US regular session open · Solana: open", short: "US regular session open · Solana: open" };
  const weekend = s.sessionLabel === "US market closed for the weekend";
  const at = s.nextRegularOpenAt ? Date.parse(s.nextRegularOpenAt) : NaN;
  const ms = at - now;
  const mins = Math.max(0, Math.round(ms / 60_000));
  /* A countdown within a day; a holiday or weekend gap reads better as the ET day and time. */
  const when = !Number.isFinite(at) ? "" : ms <= 60_000 ? "opening now" : weekend || ms >= 86_400_000 ? `opens ${fmtEt(at)}` : `opens in ${mins >= 60 ? `${Math.floor(mins / 60)}h ` : ""}${mins % 60}m`;
  const tail = when ? ` · ${when}` : "";
  return weekend
    ? { open: false, long: `US market closed for the weekend${tail} · Solana: open`, short: `Closed for the weekend${tail.replace(" ET", "")}` }
    : { open: false, long: `Regular session closed${tail} · Solana: open`, short: `Regular session closed${tail}` };
}

/** Company ids that have an onchain asset (for markers). */
export function assetForCompany(id: string) {
  return useMarket.getState().overview?.assets.find((a) => a.companyId === id) ?? null;
}
