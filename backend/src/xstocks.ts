/* xStocks public API client (keyless, undocumented-but-live: api.xstocks.fi/api/v2/public).
 *
 *   assets/{sym}                      trading period (market | extended | overnight | closed), halt flag   cache 5 min
 *   corporate-actions/history|upcoming caType verbatim, gross/net USD per share-equivalent, multiplier     cache 1 h
 *   proof-of-reserves/{sym}           shares held at the custodian vs circulating supply                  cache 1 h
 *
 * Every function resolves to null on failure (timeout, 4xx/5xx, bad JSON) so a
 * slow issuer API never breaks a price snapshot or the briefing. Failures are
 * cached for 60 s so a down API isn't hammered by every request.
 */
import type { ProofOfReserves } from "../shared/types";

const XS = "https://api.xstocks.fi/api/v2/public";
const TIMEOUT_MS = 4_000;
const FAIL_TTL = 60_000;

type Slot<T> = { at: number; ttl: number; data: T | null; pending?: Promise<T | null> };
const cache = new Map<string, Slot<unknown>>();

/* One in-flight request per key; stale-free (the TTLs are short enough). */
function cached<T>(key: string, ttl: number, load: () => Promise<T | null>): Promise<T | null> {
  const hit = cache.get(key) as Slot<T> | undefined;
  if (hit?.pending) return hit.pending;
  if (hit && Date.now() - hit.at < hit.ttl) return Promise.resolve(hit.data);
  const pending = load().catch((e) => {
    console.warn(`[xstocks] ${key} failed:`, (e as Error).message);
    return null;
  }).then((data) => {
    cache.set(key, { at: Date.now(), ttl: data == null ? FAIL_TTL : ttl, data });
    return data;
  });
  cache.set(key, { at: 0, ttl: 0, data: null, pending });
  return pending;
}

async function getJson<T>(path: string): Promise<T> {
  const r = await fetch(`${XS}${path}`, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!r.ok) throw new Error(`xStocks ${r.status} ${path}`);
  return (await r.json()) as T;
}

const num = (s: string | number | null | undefined) => {
  if (s == null || s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

/* ---------------- Asset / trading period ---------------- */

export type XStocksAsset = {
  symbol: string;
  name: string;
  underlyingSymbol: string | null;
  logo: string | null;
  /** trading.currentPeriod verbatim: "market" | "extended" | "overnight" | "closed" */
  currentPeriod: string | null;
  /** When currentPeriod next changes (e.g. overnight → pre-market at 08:00Z), NOT the next regular open */
  nextChangeAt: string | null;
  openNow: boolean | null;
  isTradingHalted: boolean;
  tradingHoursMode: string | null;
};

type RawAsset = {
  symbol: string; name: string; underlyingSymbol?: string | null; logo?: string | null; isTradingHalted?: boolean;
  trading?: { currentPeriod?: string; nextChangeAt?: string | null; openNow?: boolean; isTradingHalted?: boolean; tradingHoursMode?: string } | null;
};

export function xstocksAsset(sym: string): Promise<XStocksAsset | null> {
  return cached(`asset:${sym}`, 5 * 60_000, async () => {
    const a = await getJson<RawAsset>(`/assets/${encodeURIComponent(sym)}`);
    if (!a?.symbol) return null;
    const t = a.trading ?? {};
    return {
      symbol: a.symbol,
      name: a.name,
      underlyingSymbol: a.underlyingSymbol ?? null,
      logo: a.logo ?? null,
      currentPeriod: t.currentPeriod ?? null,
      nextChangeAt: t.nextChangeAt ?? null,
      openNow: t.openNow ?? null,
      isTradingHalted: Boolean(a.isTradingHalted || t.isTradingHalted),
      tradingHoursMode: t.tradingHoursMode ?? null,
    };
  });
}

/* ---------------- Corporate actions ---------------- */

export type XCorporateAction = {
  eventId: string;
  version: number;
  symbol: string;
  /** Verbatim from the API: CashDividend, ForwardSplit, ReverseSplit, StockDividend, SpinOff, NameChange, … */
  caType: string;
  /** Initial | Corrected | Scheduled (Cancelled versions are dropped) */
  status: string;
  /** effectiveTimeUtc: when the multiplier/units change is applied. The API has no separate ex/pay date. */
  effectiveAt: string | null;
  /** Parsed from the issuer's notes when they state it ("payable date (2026-04-01)") */
  payDate: string | null;
  /** USD per share-equivalent; net is after withholding and is what balances reflect */
  grossAmount: number | null;
  netAmount: number | null;
  currency: "USD";
  withholdingRate: number | null;
  multiplierOld: number | null;
  multiplierNew: number | null;
  fromUnits: number | null;
  toUnits: number | null;
  redemptionPriceUsd: number | null;
  notes: string | null;
  createdAt: string;
};

type RawCa = {
  eventId: string; version: number; xstockSymbol: string | null; spvSymbol: string; caType: string; effectiveTimeUtc: string | null;
  multiplierOld: string | null; multiplierNew: string | null; grossCashflowUsd: string | null; netCashflowUsd: string | null;
  withholdingTaxRate: string | null; fromUnits: string | null; toUnits: string | null; redemptionPriceUsd: string | null;
  notes: string | null; createdTimeUtc: string; status: string;
};
type CaPage = { nodes?: RawCa[] };

function normaliseCa(n: RawCa): XCorporateAction {
  const pay = n.notes?.match(/payable date \((\d{4}-\d{2}-\d{2})\)/i)?.[1] ?? null;
  return {
    eventId: n.eventId, version: n.version, symbol: n.xstockSymbol ?? `${n.spvSymbol}x`, caType: n.caType, status: n.status,
    effectiveAt: n.effectiveTimeUtc, payDate: pay,
    grossAmount: num(n.grossCashflowUsd), netAmount: num(n.netCashflowUsd), currency: "USD", withholdingRate: num(n.withholdingTaxRate),
    multiplierOld: num(n.multiplierOld), multiplierNew: num(n.multiplierNew),
    fromUnits: num(n.fromUnits), toUnits: num(n.toUnits), redemptionPriceUsd: num(n.redemptionPriceUsd),
    notes: n.notes, createdAt: n.createdTimeUtc,
  };
}

/* The API returns every version of an event (a cancelled typo, then the fix):
 * keep the highest version per eventId and drop it if that version is Cancelled. */
function latestVersions(nodes: RawCa[]): XCorporateAction[] {
  const best = new Map<string, RawCa>();
  for (const n of nodes) {
    const b = best.get(n.eventId);
    if (!b || n.version > b.version) best.set(n.eventId, n);
  }
  return [...best.values()].filter((n) => n.status !== "Cancelled").map(normaliseCa);
}

const byDateDesc = (a: XCorporateAction, b: XCorporateAction) => Date.parse(b.effectiveAt ?? b.createdAt) - Date.parse(a.effectiveAt ?? a.createdAt);

export type XCorporateActions = { history: XCorporateAction[]; upcoming: XCorporateAction[] };

export function corporateActions(sym: string): Promise<XCorporateActions | null> {
  return cached(`ca:${sym}`, 60 * 60_000, async () => {
    const qs = `symbol=${encodeURIComponent(sym)}&pageSize=100&sortBy=createdTimeUtc&sortOrder=desc`;
    const [h, u] = await Promise.all([
      getJson<CaPage>(`/corporate-actions/history?${qs}`),
      /* A failed upcoming call still leaves the history useful. */
      getJson<CaPage>(`/corporate-actions/upcoming?${qs}`).catch(() => ({ nodes: [] }) as CaPage),
    ]);
    const history = latestVersions(h.nodes ?? []).sort(byDateDesc);
    const executed = new Set(history.map((c) => c.eventId));
    /* "upcoming" also lists past Scheduled rows: keep only events not yet executed and not yet effective. */
    const now = Date.now();
    const upcoming = latestVersions(u.nodes ?? [])
      .filter((c) => !executed.has(c.eventId) && (c.effectiveAt == null || Date.parse(c.effectiveAt) > now))
      .sort((a, b) => -byDateDesc(a, b));
    return { history, upcoming };
  });
}

/* ---------------- Proof of reserves ---------------- */

type RawPor = { symbol: string; timestamp: string; sharesHeld: string; circulatingSupply: string; holdings?: { provider: string; quantity: string; symbol: string }[] } | null;

export function proofOfReserves(sym: string): Promise<ProofOfReserves | null> {
  return cached(`por:${sym}`, 60 * 60_000, async () => {
    const p = await getJson<RawPor>(`/proof-of-reserves/${encodeURIComponent(sym)}`);
    const shares = num(p?.sharesHeld), circulating = num(p?.circulatingSupply);
    if (!p || shares == null || !circulating) return null;
    const custodian = [...new Set((p.holdings ?? []).map((h) => h.provider).filter(Boolean))].join(" + ") || "undisclosed";
    return {
      symbol: p.symbol,
      /* Two decimals: 185,692.25 / 185,370.87 → 100.17 */
      backedPct: Math.round((shares / circulating) * 10_000) / 100,
      custodian,
      shares,
      circulating,
      asOf: p.timestamp,
    };
  });
}
