/* Price-feed abstraction (spec §6, §20 "price-feed abstraction").
 *
 *   underlying price : Pyth Pro (when PYTH_PRO_API_KEY) → Jupiter stockData → Yahoo
 *   token price      : Jupiter Price v3
 *   OHLC history     : Pyth Pro History API → Yahoo Finance chart API (labelled)
 *   market session   : Pyth symbol schedule (keyless) → Yahoo meta
 *
 * Every snapshot carries its source and timestamps so the UI can show data
 * age and flag staleness (trust principles §26.7–9).
 */
import { COMPANY_BY_ID } from "../shared/registry";
import type { Candle, ChartHistory, ChartRange, Company, PriceSnapshot, TokenizedAsset } from "../shared/types";
import { getPrices } from "./jupiter";

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
    const list = (await (await fetch(`${PYTH}/symbols?query=${encodeURIComponent(company.ticker)}&asset_type=equity`)).json()) as PythSymbol[];
    const hit = list.find((s) => s.symbol === company.pythSymbol) ??
      list.find((s) => s.symbol.toUpperCase().endsWith(`.${company.ticker.toUpperCase()}/USD`)) ??
      list.find((s) => s.name.toUpperCase() === company.ticker.toUpperCase()) ?? null;
    pythSymbolCache.set(key, hit);
    return hit;
  } catch {
    pythSymbolCache.set(key, null);
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
  meta: { regularMarketPrice?: number; regularMarketTime?: number };
  timestamp?: number[];
  indicators: { quote: YahooQuote[] };
};
type YahooChart = { chart: { result?: YahooResult[]; error?: unknown } };

async function yahooChart(symbol: string, range: string, interval: string): Promise<YahooResult | null> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}&includePrePost=false`;
  const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (Rhea market interface)" } });
  if (!r.ok) throw new Error(`Yahoo ${r.status}`);
  const j = (await r.json()) as YahooChart;
  return j.chart.result?.[0] ?? null;
}

/* ---------------- Snapshot ---------------- */

export async function priceSnapshot(company: Company, asset: TokenizedAsset | undefined): Promise<PriceSnapshot> {
  const mint = asset?.mint ?? "";
  const [jup, pyth, session] = await Promise.all([
    mint ? getPrices([mint]).then((m) => m[mint]).catch(() => undefined) : Promise.resolve(undefined),
    pythLatest(company),
    marketSession(company),
  ]);

  let underlying: number | null = null;
  let underlyingSource: PriceSnapshot["underlyingSource"] = "none";
  let underlyingAt: string | null = null;
  if (pyth) { underlying = pyth.price; underlyingSource = "pyth"; underlyingAt = pyth.at; }
  else if (jup?.stockData?.price) { underlying = jup.stockData.price; underlyingSource = "jupiter-stockdata"; underlyingAt = jup.stockData.updatedAt; }
  else {
    try {
      const y = await yahooChart(company.yahooSymbol ?? company.ticker, "1d", "1d");
      if (y?.meta.regularMarketPrice) {
        underlying = y.meta.regularMarketPrice; underlyingSource = "yahoo";
        underlyingAt = y.meta.regularMarketTime ? new Date(y.meta.regularMarketTime * 1000).toISOString() : null;
      }
    } catch { /* leave null */ }
  }

  const tokenAt = jup ? new Date().toISOString() : null;
  const newest = [underlyingAt, tokenAt].filter(Boolean).map((s) => Date.parse(s as string));
  const stale = newest.length === 0 || (session === "regular" && Date.now() - Math.max(...newest) > STALE_AFTER_MS);

  return {
    companyId: company.id,
    mint,
    tokenPriceUsd: jup?.usdPrice ?? null,
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
