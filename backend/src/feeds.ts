/* Price-feed abstraction (spec §6, §20 "price-feed abstraction").
 *
 *   underlying price : Pyth Pro (when PYTH_PRO_API_KEY) → Jupiter stockData → Yahoo
 *   token price      : Jupiter Price v3
 *   OHLC history     : Pyth Pro History API → Yahoo Finance chart API (labelled)
 *   market session   : Pyth symbol schedule (keyless) → Yahoo meta
 *   last close / gap : Yahoo range=1d meta (xStocks has no last-close field) vs Jupiter token price
 *   trading period   : xStocks public API (xstocks.ts), verbatim
 *
 * Every snapshot carries its source and timestamps so the UI can show data
 * age and flag staleness (trust principles §26.7–9).
 */
import { COMPANY_BY_ID } from "../shared/registry";
import type { Candle, ChartHistory, ChartRange, Company, MarketSessionInfo, PriceSnapshot, SessionLabel, TokenizedAsset } from "../shared/types";
import { getPrices } from "./jupiter";
import { xstocksAsset } from "./xstocks";

const PYTH_KEY = process.env.PYTH_PRO_API_KEY || "";
const PYTH = "https://pyth.dourolabs.app/v1";
const STALE_AFTER_MS = 5 * 60_000;

export const hasPythKey = () => Boolean(PYTH_KEY);

/* ---------------- Pyth symbol metadata (keyless) ---------------- */

type PythSymbol = {
  pyth_lazer_id: number; symbol: string; name: string; asset_type: string; exponent: number;
  schedule?: string; market_session_schedule?: { regular?: string; pre_market?: string; post_market?: string };
};
const pythSymbolCache = new Map<string, PythSymbol | null>();

export async function pythSymbolFor(company: Company): Promise<PythSymbol | null> {
  const key = company.pythSymbol ?? company.ticker;
  if (pythSymbolCache.has(key)) return pythSymbolCache.get(key) ?? null;
  try {
    const r = await fetch(`${PYTH}/symbols?query=${encodeURIComponent(company.ticker)}&asset_type=equity`, { signal: AbortSignal.timeout(5_000) });
    if (!r.ok) return null;
    const list = (await r.json()) as PythSymbol[];
    const hit = list.find((s) => s.symbol === company.pythSymbol) ??
      list.find((s) => s.symbol.toUpperCase().endsWith(`.${company.ticker.toUpperCase()}/USD`)) ??
      list.find((s) => s.name.toUpperCase() === company.ticker.toUpperCase()) ?? null;
    pythSymbolCache.set(key, hit);
    return hit;
  } catch {
    /* Not cached: a network blip must not disable session math until restart. */
    return null;
  }
}

/* Evaluate a Pyth schedule string ("America/New_York;0930-1600,...;holidays")
 * against now → is that session open? Weekday list is Mon..Sun. */
function sessionOpen(schedule: string | undefined, now = new Date()): boolean {
  if (!schedule) return false;
  const [tz, days, holidays] = schedule.split(";");
  const fmt = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour12: false, weekday: "short", hour: "2-digit", minute: "2-digit", month: "2-digit", day: "2-digit" });
  const parts = Object.fromEntries(fmt.formatToParts(now).map((p) => [p.type, p.value]));
  const dow = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(parts.weekday);
  const hhmm = `${parts.hour === "24" ? "00" : parts.hour}${parts.minute}`;
  const mmdd = `${parts.month}${parts.day}`;
  let windows = (days ?? "").split(",")[dow] ?? "C";
  for (const h of (holidays ?? "").split(",")) {
    const [d, w] = h.split("/");
    if (d === mmdd && w) windows = w;
  }
  if (!windows || windows === "C") return false;
  return windows.split("&").some((w) => {
    const [a, b] = w.split("-");
    return a && b && hhmm >= a && hhmm < b;
  });
}

export async function marketSession(company: Company): Promise<PriceSnapshot["marketSession"]> {
  const sym = await pythSymbolFor(company);
  const s = sym?.market_session_schedule;
  if (!s) return "unknown";
  if (sessionOpen(s.regular)) return "regular";
  if (sessionOpen(s.pre_market)) return "pre_market";
  if (sessionOpen(s.post_market)) return "post_market";
  return "closed";
}

/* ---------------- Session label + next regular open ---------------- */

/* Used when Pyth's symbol list is unreachable: NYSE/Nasdaq hours without holidays. */
const DEFAULT_REGULAR = "America/New_York;0930-1600,0930-1600,0930-1600,0930-1600,0930-1600,C,C;";

/* Wall-clock parts of instant `t` in `tz` (h23, so midnight is 00 not 24). */
function zonedParts(tz: string, t: number) {
  const fmt = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", weekday: "short", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const p = Object.fromEntries(fmt.formatToParts(new Date(t)).map((x) => [x.type, x.value]));
  return { y: +p.year, mo: +p.month, d: +p.day, h: +p.hour % 24, mi: +p.minute, s: +p.second, weekday: p.weekday };
}

/* Local wall time in `tz` → UTC ms. Two passes settle DST-transition days. */
function zonedToUtc(tz: string, y: number, mo: number, d: number, h: number, mi: number): number {
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  const offsetAt = (t: number) => { const p = zonedParts(tz, t); return Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s) - Math.floor(t / 1000) * 1000; };
  const off = offsetAt(guess);
  const t = guess - off;
  const off2 = offsetAt(t);
  return off2 === off ? t : guess - off2;
}

/** Next start of a regular window strictly after `now`, honouring the schedule's holiday overrides (MMDD/C or MMDD/0930-1300). */
export function nextRegularOpen(schedule: string | undefined, now = Date.now()): string | null {
  const [tz, days, holidays] = (schedule || DEFAULT_REGULAR).split(";");
  const today = zonedParts(tz, now);
  for (let i = 0; i < 15; i++) {
    const civil = new Date(Date.UTC(today.y, today.mo - 1, today.d + i));
    const y = civil.getUTCFullYear(), mo = civil.getUTCMonth() + 1, d = civil.getUTCDate();
    const dow = (civil.getUTCDay() + 6) % 7; // Mon=0 like the schedule
    const mmdd = `${String(mo).padStart(2, "0")}${String(d).padStart(2, "0")}`;
    let windows = (days ?? "").split(",")[dow] ?? "C";
    for (const hol of (holidays ?? "").split(",")) {
      const [hd, w] = hol.split("/");
      if (hd === mmdd && w) windows = w;
    }
    if (!windows || windows === "C") continue;
    for (const w of windows.split("&")) {
      const a = w.split("-")[0];
      if (!/^\d{4}$/.test(a)) continue;
      const at = zonedToUtc(tz, y, mo, d, +a.slice(0, 2), +a.slice(2));
      if (at > now) return new Date(at).toISOString();
    }
  }
  return null;
}

/* Weekend = Saturday, Sunday, or Friday after extended hours end (20:00 ET) — the
 * only time "closed for the weekend" is true. Weeknights xStocks trade overnight. */
function sessionLabelFor(regularOpen: boolean, now = Date.now()): SessionLabel {
  if (regularOpen) return "US regular session";
  const p = zonedParts("America/New_York", now);
  const weekend = p.weekday === "Sat" || p.weekday === "Sun" || (p.weekday === "Fri" && p.h >= 20);
  return weekend ? "US market closed for the weekend" : "regular session closed";
}

/** Session facts for one company's exchange (US names share the NYSE/Nasdaq calendar). */
export async function sessionInfo(company: Company): Promise<MarketSessionInfo> {
  const [sym, xs] = await Promise.all([pythSymbolFor(company), xstocksAsset(company.tokenSymbol)]);
  const regular = sym?.market_session_schedule?.regular || DEFAULT_REGULAR;
  const usRegularOpen = sessionOpen(regular);
  return {
    usRegularOpen,
    sessionLabel: sessionLabelFor(usRegularOpen),
    nextRegularOpenAt: nextRegularOpen(regular),
    solanaOpen: true,
    xstocksPeriod: xs?.currentPeriod ?? null,
    asOf: new Date().toISOString(),
  };
}

/* ---------------- Pyth Pro latest price ---------------- */

async function pythLatest(company: Company): Promise<{ price: number; at: string } | null> {
  if (!PYTH_KEY) return null;
  const sym = await pythSymbolFor(company);
  if (!sym) return null;
  try {
    const nowUs = Date.now() * 1000;
    const r = await fetch(`${PYTH}/real_time/price?ids=${sym.pyth_lazer_id}&timestamp=${nowUs}`, {
      headers: { Authorization: `Bearer ${PYTH_KEY}` },
    });
    if (!r.ok) return null;
    const data = (await r.json()) as { price?: string | number; exponent?: number; publish_time?: number }[] | { price?: string | number; exponent?: number; publish_time?: number };
    const row = Array.isArray(data) ? data[0] : data;
    if (!row || row.price == null) return null;
    const exp = row.exponent ?? sym.exponent ?? 0;
    const price = Number(row.price) * 10 ** exp;
    const at = row.publish_time ? new Date(Number(row.publish_time) / 1000).toISOString() : new Date().toISOString();
    return { price, at };
  } catch {
    return null;
  }
}

/* ---------------- Yahoo fallback (keyless) ---------------- */

type YahooQuote = { open: (number | null)[]; high: (number | null)[]; low: (number | null)[]; close: (number | null)[]; volume: (number | null)[] };
type YahooResult = {
  meta: {
    regularMarketPrice?: number; regularMarketTime?: number; chartPreviousClose?: number; previousClose?: number;
    currentTradingPeriod?: { regular?: { start: number; end: number } };
  };
  timestamp?: number[];
  indicators: { quote: YahooQuote[] };
};
type YahooChart = { chart: { result?: YahooResult[]; error?: unknown } };

async function yahooChart(symbol: string, range: string, interval: string): Promise<YahooResult | null> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}&includePrePost=false`;
  const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (Rhea market interface)" }, signal: AbortSignal.timeout(8_000) });
  if (!r.ok) throw new Error(`Yahoo ${r.status}`);
  const j = (await r.json()) as YahooChart;
  return j.chart.result?.[0] ?? null;
}

/* range=1d meta, shared by the underlying fallback and the last close. 60 s; failures 30 s. */
const metaCache = new Map<string, { at: number; ttl: number; data: Promise<YahooResult["meta"] | null> }>();
function yahooMeta(symbol: string): Promise<YahooResult["meta"] | null> {
  const hit = metaCache.get(symbol);
  if (hit && Date.now() - hit.at < hit.ttl) return hit.data;
  const slot = { at: Date.now(), ttl: 60_000, data: Promise.resolve<YahooResult["meta"] | null>(null) };
  slot.data = yahooChart(symbol, "1d", "1d").then((y) => y?.meta ?? null).catch(() => { slot.ttl = 30_000; return null; });
  metaCache.set(symbol, slot);
  return slot.data;
}

/** Last US regular-session close. Outside the session Yahoo's regularMarketPrice IS that
 *  close (regularMarketTime = 16:00 ET); inside it that field is live, so use the previous close. */
export async function lastCloseFor(company: Company): Promise<{ lastCloseUsd: number; lastCloseAt: string | null } | null> {
  const m = await yahooMeta(company.yahooSymbol ?? company.ticker);
  if (!m) return null;
  const now = Date.now() / 1000;
  const reg = m.currentTradingPeriod?.regular;
  const inSession = Boolean(reg && now >= reg.start && now < reg.end);
  if (inSession) {
    const prev = m.chartPreviousClose ?? m.previousClose;
    return prev ? { lastCloseUsd: prev, lastCloseAt: null } : null;
  }
  return m.regularMarketPrice
    ? { lastCloseUsd: m.regularMarketPrice, lastCloseAt: m.regularMarketTime ? new Date(m.regularMarketTime * 1000).toISOString() : null }
    : null;
}

/* ---------------- Snapshot ---------------- */

export async function priceSnapshot(company: Company, asset: TokenizedAsset | undefined): Promise<PriceSnapshot> {
  const mint = asset?.mint ?? "";
  const [jup, pyth, session, info, close, xs] = await Promise.all([
    mint ? getPrices([mint]).then((m) => m[mint]).catch(() => undefined) : Promise.resolve(undefined),
    pythLatest(company),
    marketSession(company),
    sessionInfo(company),
    lastCloseFor(company),
    xstocksAsset(company.tokenSymbol),
  ]);

  let underlying: number | null = null;
  let underlyingSource: PriceSnapshot["underlyingSource"] = "none";
  let underlyingAt: string | null = null;
  if (pyth) { underlying = pyth.price; underlyingSource = "pyth"; underlyingAt = pyth.at; }
  else if (jup?.stockData?.price) { underlying = jup.stockData.price; underlyingSource = "jupiter-stockdata"; underlyingAt = jup.stockData.updatedAt; }
  else {
    const m = await yahooMeta(company.yahooSymbol ?? company.ticker);
    if (m?.regularMarketPrice) {
      underlying = m.regularMarketPrice; underlyingSource = "yahoo";
      underlyingAt = m.regularMarketTime ? new Date(m.regularMarketTime * 1000).toISOString() : null;
    }
  }

  /* Jupiter usdPrice is already per UI token (multiplier included), so compare it to the close directly. */
  const tokenPrice = jup?.usdPrice ?? null;
  const gap = session !== "regular" && !info.usRegularOpen && tokenPrice && close
    ? Math.round((tokenPrice / close.lastCloseUsd - 1) * 10_000) / 100 : null;

  const tokenAt = jup ? new Date().toISOString() : null;
  const newest = [underlyingAt, tokenAt].filter(Boolean).map((s) => Date.parse(s as string));
  const stale = newest.length === 0 || (session === "regular" && Date.now() - Math.max(...newest) > STALE_AFTER_MS);

  return {
    companyId: company.id,
    mint,
    tokenPriceUsd: tokenPrice,
    underlyingPriceUsd: underlying,
    underlyingSource,
    change24hPct: jup?.priceChange24h ?? null,
    marketSession: session,
    tokenUpdatedAt: tokenAt,
    underlyingUpdatedAt: underlyingAt,
    stale,
    rebase: jup?.scaledUiConfig ? {
      multiplier: jup.scaledUiConfig.multiplier,
      newMultiplier: jup.scaledUiConfig.newMultiplier,
      newMultiplierEffectiveAt: jup.scaledUiConfig.newMultiplierEffectiveAt,
    } : undefined,
    lastCloseUsd: close?.lastCloseUsd ?? null,
    lastCloseAt: close?.lastCloseAt ?? null,
    gapVsClosePct: gap,
    xstocksPeriod: xs?.currentPeriod ?? null,
    xstocksOpenNow: xs?.openNow ?? null,
    halted: xs ? xs.isTradingHalted : null,
    nextRegularOpenAt: info.nextRegularOpenAt,
    sessionLabel: info.sessionLabel,
  };
}

/* ---------------- OHLC history ---------------- */

const RANGE_CFG: Record<ChartRange, { seconds: number; pythRes: string; yRange: string; yInterval: string }> = {
  "1D": { seconds: 86400 * 1.2, pythRes: "5", yRange: "1d", yInterval: "5m" },
  "5D": { seconds: 86400 * 7, pythRes: "30", yRange: "5d", yInterval: "30m" },
  "1M": { seconds: 86400 * 31, pythRes: "240", yRange: "1mo", yInterval: "1h" },
  "3M": { seconds: 86400 * 93, pythRes: "D", yRange: "3mo", yInterval: "1d" },
  "1Y": { seconds: 86400 * 366, pythRes: "D", yRange: "1y", yInterval: "1d" },
  "5Y": { seconds: 86400 * 366 * 5, pythRes: "W", yRange: "5y", yInterval: "1wk" },
  "MAX": { seconds: 86400 * 366 * 20, pythRes: "M", yRange: "max", yInterval: "1mo" },
};

const histCache = new Map<string, { at: number; data: ChartHistory }>();

export async function history(companyId: string, range: ChartRange): Promise<ChartHistory> {
  const company = COMPANY_BY_ID[companyId];
  if (!company) throw new Error(`Unknown company ${companyId}`);
  const key = `${companyId}:${range}`;
  const cached = histCache.get(key);
  const ttl = range === "1D" ? 60_000 : 10 * 60_000;
  if (cached && Date.now() - cached.at < ttl) return cached.data;

  const cfg = RANGE_CFG[range];
  let candles: Candle[] = [];
  let source: ChartHistory["source"] = "yahoo";
  let resolution = cfg.yInterval;

  if (PYTH_KEY) {
    const sym = await pythSymbolFor(company);
    if (sym) {
      try {
        const to = Math.floor(Date.now() / 1000);
        const from = to - Math.floor(cfg.seconds);
        const r = await fetch(`${PYTH}/real_time/history?symbol=${encodeURIComponent(sym.symbol)}&from=${from}&to=${to}&resolution=${cfg.pythRes}`, {
          headers: { Authorization: `Bearer ${PYTH_KEY}` },
        });
        if (r.ok) {
          const j = (await r.json()) as { s: string; t: number[]; o: number[]; h: number[]; l: number[]; c: number[]; v?: number[] };
          if (j.s === "ok" && j.t?.length) {
            candles = j.t.map((t, i) => ({ t, o: j.o[i], h: j.h[i], l: j.l[i], c: j.c[i], v: j.v?.[i] }));
            source = "pyth"; resolution = cfg.pythRes;
          }
        }
      } catch (e) {
        console.warn("[feeds] pyth history failed:", (e as Error).message);
      }
    }
  }

  if (candles.length === 0) {
    const y = await yahooChart(company.yahooSymbol ?? company.ticker, cfg.yRange, cfg.yInterval);
    const q = y?.indicators.quote[0];
    if (y?.timestamp && q) {
      for (let i = 0; i < y.timestamp.length; i++) {
        const o = q.open[i], h = q.high[i], l = q.low[i], c = q.close[i];
        if (o == null || h == null || l == null || c == null) continue;
        candles.push({ t: y.timestamp[i], o, h, l, c, v: q.volume[i] ?? undefined });
      }
    }
  }

  const data: ChartHistory = { companyId, range, resolution, source, candles, fetchedAt: new Date().toISOString() };
  histCache.set(key, { at: Date.now(), data });
  return data;
}
