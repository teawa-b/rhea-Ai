/* Executes Rhea's function tools in the browser (spec §8).
 *
 * Visual tools mutate the world store (the scene reacts). Market tools read
 * the API. Trade tools only *prepare* — they open a confirmation panel and
 * report back; execution happens when the user presses Confirm. Results are
 * compact JSON the backend model can turn into a spoken sentence.
 */
import { COMPANY_BY_ID, COUNTRIES, resolveCompany, resolveCountry } from "@shared/registry";
import type { ChartRange, CountryCode, NewsEvent } from "@shared/types";
import type { RheaAuth } from "@/auth/Auth";
import { api } from "@/market/api";
import { assetForCompany, useMarket } from "@/state/market";
import { REGIONS, REGION_BY_ID } from "@/state/regions";
import { useWorld } from "@/state/world";
import { describeRule, prepareTrade, prepareTrigger, type TriggerKind } from "@/solana/trade";
import { fmtAge } from "@/theme";

type Args = Record<string, unknown>;
const str = (v: unknown) => (v == null ? "" : String(v));
const num = (v: unknown) => (typeof v === "number" ? v : Number(v));
const arr = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : typeof v === "string" ? [v] : []);

function needCompany(q: string) {
  const co = resolveCompany(q);
  if (!co) throw new Error(`Unknown company "${q}". Use get_market_overview to list supported companies.`);
  return co;
}

async function companyProfile(q: string) {
  const co = needCompany(q);
  const m = useMarket.getState();
  const d = await m.loadDetail(co.id, true);
  if (!d) throw new Error("Market data unavailable right now");
  const pos = m.portfolio?.positions.find((p) => p.companyId === co.id) ?? null;
  const orders = m.orders.filter((o) => o.companyId === co.id && o.status === "active");
  const p = d.price;
  const divergence = p.tokenPriceUsd && p.underlyingPriceUsd ? ((p.tokenPriceUsd - p.underlyingPriceUsd) / p.underlyingPriceUsd) * 100 : null;
  return {
    company: { id: co.id, name: co.name, ticker: co.ticker, country: COUNTRIES[co.countryCode].name, sector: co.sector, headquarters: co.headquarters?.name ?? null },
    asset: d.asset ? { symbol: d.asset.symbol, mint: d.asset.mint, issuer: d.asset.issuer, tradable: d.asset.tradable, liquidityUsd: d.asset.liquidityUsd ?? null } : null,
    prices: {
      underlyingPriceUsd: p.underlyingPriceUsd, underlyingSource: p.underlyingSource, underlyingAge: fmtAge(p.underlyingUpdatedAt),
      tokenPriceUsd: p.tokenPriceUsd, tokenAge: fmtAge(p.tokenUpdatedAt),
      tokenVsUnderlyingPct: divergence == null ? null : Number(divergence.toFixed(2)),
      change24hPct: p.change24hPct == null ? null : Number(p.change24hPct.toFixed(2)),
      marketSession: p.marketSession, stale: p.stale,
    },
    position: pos ? { tokens: pos.amountUi, valueUsd: pos.valueUsd } : null,
    activeOrders: orders.map((o) => ({ id: o.id, rule: describeRule(o), simulated: !!o.simulated })),
    corporateActions: d.corporateActions.map((c) => ({ type: c.type, effectiveAt: c.effectiveAt, detail: c.detail })),
  };
}

function regionResult(id: string) {
  const region = REGION_BY_ID[id];
  const markets = (useMarket.getState().overview?.countries ?? []).filter((c) => region.countries.includes(c.code));
  return { ok: true, region: region.name, markets: markets.map((c) => ({ country: c.name, tradableStocks: c.tradableCount, companies: c.companies.map((cid) => COMPANY_BY_ID[cid]?.name) })) };
}

export function createToolRunner(getAuth: () => RheaAuth) {
  return async function run(name: string, args: Args): Promise<unknown> {
    const w = useWorld.getState();
    const m = useMarket.getState();

    switch (name) {
      /* ---------------- Visual ---------------- */
      case "focus_region": {
        const id = w.focusRegion(str(args.region));
        if (!id) throw new Error(`Unknown region "${str(args.region)}". Supported: ${REGIONS.map((r) => r.name).join(", ")}.`);
        return regionResult(id);
      }
      case "focus_country": {
        /* The model sometimes passes a continent here ("Europe"); fly there instead of failing. */
        if (!resolveCountry(str(args.country))) {
          const regionId = w.focusRegion(str(args.country));
          if (regionId) return regionResult(regionId);
        }
        const code = w.focusCountry(str(args.country));
        if (!code) throw new Error(`Unknown country "${str(args.country)}"`);
        const cs = m.overview?.countries.find((c) => c.code === code);
        return { ok: true, country: COUNTRIES[code].name, assets: cs?.assetCount ?? 0, tradable: cs?.tradableCount ?? 0, companies: (cs?.companies ?? []).map((id) => COMPANY_BY_ID[id]?.name) };
      }
      case "focus_company": {
        const co = needCompany(str(args.company));
        if (!assetForCompany(co.id)) return { ok: false, error: `${co.name} isn't tradable on Solana right now (no liquidity), so it isn't shown. Suggest a tradable stock from get_market_overview instead.` };
        const id = w.focusCompany(co.id);
        if (!id) throw new Error(`Unknown company "${str(args.company)}"`);
        void m.loadDetail(id, true);
        void m.loadHistory(id, w.chartRange);
        return { ok: true, company: COMPANY_BY_ID[id].name, view: "company" };
      }
      case "reset_globe":
        w.resetGlobe(Boolean(args.clear));
        return { ok: true };
      case "highlight_countries": {
        const codes = w.highlightCountries(arr(args.countries));
        return { ok: true, highlighted: codes.map((c) => COUNTRIES[c].name) };
      }
      case "highlight_companies": {
        const ids = w.highlightCompanies(arr(args.companies));
        return { ok: true, highlighted: ids.map((id) => COMPANY_BY_ID[id].name) };
      }
      case "draw_connection": {
        const sentiment = (["negative", "positive", "neutral"].includes(str(args.sentiment)) ? str(args.sentiment) : "neutral") as "negative" | "positive" | "neutral";
        const c = w.drawConnection(str(args.from), str(args.to), args.label ? str(args.label) : undefined, sentiment);
        if (!c) throw new Error("Could not resolve one of the places");
        return { ok: true, from: c.from.label, to: c.to.label };
      }
      case "clear_connections":
        w.clearConnections();
        return { ok: true };
      case "show_chart": {
        const range = (str(args.range).toUpperCase() || "1M") as ChartRange;
        const id = w.showChart(str(args.company), range, args.mode === "candles" ? "candles" : args.mode === "line" ? "line" : undefined);
        if (!id) throw new Error(`Unknown company "${str(args.company)}"`);
        const h = await m.loadHistory(id, range);
        return { ok: true, company: COMPANY_BY_ID[id].name, range, candles: h?.candles.length ?? 0, source: h?.source ?? null };
      }
      case "focus_chart_timestamp": {
        const co = needCompany(str(args.company));
        if (w.focusedCompany !== co.id) w.focusCompany(co.id);
        const ts = Date.parse(str(args.timestamp));
        if (!Number.isFinite(ts)) throw new Error("timestamp must be ISO 8601");
        const range = w.chartRange;
        /* Make sure the range actually contains the moment. */
        const ageDays = (Date.now() - ts) / 86400_000;
        const needed: ChartRange = ageDays <= 1 ? "1D" : ageDays <= 5 ? "5D" : ageDays <= 31 ? "1M" : ageDays <= 93 ? "3M" : ageDays <= 366 ? "1Y" : "5Y";
        if (["1D", "5D", "1M", "3M", "1Y", "5Y", "MAX"].indexOf(range) < ["1D", "5D", "1M", "3M", "1Y", "5Y", "MAX"].indexOf(needed)) w.setChartRange(needed);
        w.focusChartTimestamp(ts);
        const h = await m.loadHistory(co.id, useWorld.getState().chartRange);
        let around: { before: number; after: number; movePct: number } | null = null;
        if (h?.candles.length) {
          const s = ts / 1000;
          let iBefore = 0; for (let i = 0; i < h.candles.length; i++) if (h.candles[i].t <= s) iBefore = i;
          const iAfter = Math.min(h.candles.length - 1, iBefore + Math.max(1, Math.round(h.candles.length * 0.05)));
          const before = h.candles[iBefore].c, after = h.candles[iAfter].c;
          around = { before, after, movePct: Number((((after - before) / before) * 100).toFixed(2)) };
        }
        return { ok: true, company: co.name, focusedAt: new Date(ts).toISOString(), priceAround: around };
      }
      case "add_chart_event": {
        const co = needCompany(str(args.company));
        const ts = Date.parse(str(args.timestamp));
        if (!Number.isFinite(ts)) throw new Error("timestamp must be ISO 8601");
        const kind = (["news", "earnings", "corporate_action", "macro"].includes(str(args.kind)) ? str(args.kind) : "news") as "news" | "earnings" | "corporate_action" | "macro";
        w.addChartEvent({ companyId: co.id, timestamp: ts, title: str(args.title).slice(0, 60), kind, url: args.url ? str(args.url) : undefined });
        if (w.focusedCompany !== co.id) w.focusCompany(co.id);
        return { ok: true };
      }
      case "compare_companies": {
        const ids = w.compareCompanies(arr(args.companies));
        if (ids.length < 2) throw new Error("Need at least two known companies");
        await m.loadPrices(ids);
        const prices = useMarket.getState().prices;
        return { ok: true, companies: ids.map((id) => ({ name: COMPANY_BY_ID[id].name, ticker: COMPANY_BY_ID[id].ticker, tokenPriceUsd: prices[id]?.tokenPriceUsd ?? null, underlyingPriceUsd: prices[id]?.underlyingPriceUsd ?? null, change24hPct: prices[id]?.change24hPct ?? null })) };
      }
      case "show_portfolio_exposure": {
        const p = m.portfolio ?? (await m.loadPortfolio());
        if (!p) throw new Error("No wallet connected — ask the user to sign in");
        const dim = str(args.dimension) === "sector" ? "sector" : "country";
        const buckets = new Map<string, number>();
        let total = 0;
        for (const pos of p.positions) {
          const co = COMPANY_BY_ID[pos.companyId];
          const key = dim === "country" ? co.countryCode : co.sector;
          buckets.set(key, (buckets.get(key) ?? 0) + (pos.valueUsd ?? 0));
          total += pos.valueUsd ?? 0;
        }
        if (dim === "country") {
          const heat: Partial<Record<CountryCode, number>> = {};
          for (const [k, v] of buckets) heat[k as CountryCode] = total ? v / total : 0;
          w.setCountryHeat(heat);
          w.resetGlobe(false);
        }
        return { ok: true, dimension: dim, totalUsd: Number(total.toFixed(2)), exposure: [...buckets].map(([k, v]) => ({ [dim]: dim === "country" ? COUNTRIES[k as CountryCode]?.name ?? k : k, pct: total ? Number(((v / total) * 100).toFixed(1)) : 0, usd: Number(v.toFixed(2)) })).sort((a, b) => b.pct - a.pct) };
      }
      case "show_news": {
        const target = str(args.target);
        const co = resolveCompany(target);
        const cd = co ? null : resolveCountry(target);
        const items = (Array.isArray(args.items) ? args.items : []) as Record<string, unknown>[];
        const news: NewsEvent[] = items.slice(0, 6).map((it, i) => ({
          id: `news_${Date.now()}_${i}`,
          companyIds: co ? [co.id] : [],
          countryCodes: cd ? [cd.code] : co ? [co.countryCode] : [],
          title: str(it.title).slice(0, 160),
          source: str(it.source).slice(0, 60),
          url: str(it.url),
          publishedAt: str(it.publishedAt),
          summary: it.summary ? str(it.summary).slice(0, 280) : undefined,
        }));
        w.showNews(co?.name ?? cd?.name ?? target, news);
        if (co && w.focusedCompany !== co.id && w.view !== "country") w.focusCompany(co.id);
        else if (cd && !w.focusedCompany && w.focusedCountry !== cd.code) w.focusCountry(cd.code);
        return { ok: true, shown: news.length };
      }
      case "show_impact": {
        const co = needCompany(str(args.company));
        const impact = str(args.impact);
        w.showImpact({
          companyId: co.id,
          event: str(args.event).slice(0, 160),
          impact: (["potentially_positive", "potentially_negative", "mixed", "neutral"].includes(impact) ? impact : "mixed") as "potentially_positive" | "potentially_negative" | "mixed" | "neutral",
          confidence: Math.max(0, Math.min(1, num(args.confidence) || 0.5)),
          time_horizon: (["short_term", "medium_term", "long_term"].includes(str(args.time_horizon)) ? str(args.time_horizon) : "medium_term") as "short_term" | "medium_term" | "long_term",
          factors: arr(args.factors).slice(0, 6),
        });
        if (w.focusedCompany !== co.id) w.focusCompany(co.id);
        return { ok: true };
      }
      case "show_street_view": {
        const co = needCompany(str(args.company));
        if (!m.status?.streetView) { w.showStreetView(co.id); return { ok: true, imagery: "unavailable (no GOOGLE_MAPS_API_KEY) — showing map marker", headquarters: co.headquarters?.name ?? null }; }
        w.showStreetView(co.id);
        if (w.focusedCompany !== co.id) w.focusCompany(co.id);
        return { ok: true, headquarters: co.headquarters?.name ?? null };
      }

      /* ---------------- Market ---------------- */
      case "get_market_overview": {
        const ov = m.overview ?? (await m.loadOverview());
        if (!ov) throw new Error("Market overview unavailable");
        return {
          fetchedAt: ov.fetchedAt,
          source: ov.source,
          countries: ov.countries.map((c) => ({ code: c.code, name: c.name, assets: c.assetCount, tradable: c.tradableCount })),
          companies: ov.companies.map((c) => ({ id: c.id, name: c.name, ticker: c.ticker, token: c.tokenSymbol, country: c.countryCode, sector: c.sector, tradable: ov.assets.find((a) => a.companyId === c.id)?.tradable ?? false })),
        };
      }
      case "get_company_profile":
        return companyProfile(str(args.company));
      case "get_historical_prices": {
        const co = needCompany(str(args.company));
        const range = (str(args.range).toUpperCase() || "1M") as ChartRange;
        const h = await m.loadHistory(co.id, range);
        if (!h || !h.candles.length) throw new Error("No history available");
        const c = h.candles;
        const first = c[0], last = c[c.length - 1];
        let hi = -Infinity, lo = Infinity, hiT = 0, loT = 0;
        for (const k of c) { if (k.h > hi) { hi = k.h; hiT = k.t; } if (k.l < lo) { lo = k.l; loT = k.t; } }
        const step = Math.max(1, Math.floor(c.length / 12));
        return {
          company: co.name, range, source: h.source, resolution: h.resolution,
          from: new Date(first.t * 1000).toISOString(), to: new Date(last.t * 1000).toISOString(),
          open: first.o, close: last.c, changePct: Number((((last.c - first.o) / first.o) * 100).toFixed(2)),
          high: { price: hi, at: new Date(hiT * 1000).toISOString() }, low: { price: lo, at: new Date(loT * 1000).toISOString() },
          sample: c.filter((_, i) => i % step === 0 || i === c.length - 1).map((k) => ({ t: new Date(k.t * 1000).toISOString().slice(0, 16), c: Number(k.c.toFixed(2)) })),
        };
      }
      case "get_portfolio": {
        const auth = getAuth();
        if (!auth.authenticated) return { ok: false, error: "User is not signed in. Invite them to sign in with Google or email to get an embedded Solana wallet." };
        const p = await m.loadPortfolio();
        if (!p) throw new Error("Could not read the wallet");
        const byCountry = new Map<string, number>();
        for (const pos of p.positions) { const cc = COMPANY_BY_ID[pos.companyId].countryCode; byCountry.set(cc, (byCountry.get(cc) ?? 0) + (pos.valueUsd ?? 0)); }
        return {
          wallet: `${p.wallet.slice(0, 4)}…${p.wallet.slice(-4)}`, fetchedAt: p.fetchedAt,
          solBalance: p.solBalance, usdcBalance: p.usdcBalance, totalValueUsd: Number(p.totalValueUsd.toFixed(2)),
          positions: p.positions.map((pos) => ({ company: COMPANY_BY_ID[pos.companyId].name, symbol: pos.symbol, tokens: pos.amountUi, valueUsd: pos.valueUsd == null ? null : Number(pos.valueUsd.toFixed(2)) })),
          countryExposure: [...byCountry].map(([k, v]) => ({ country: COUNTRIES[k as CountryCode].name, usd: Number(v.toFixed(2)) })),
          activeOrders: m.orders.filter((o) => o.status === "active").map(describeRule),
        };
      }
      case "get_swap_quote": {
        const auth = getAuth();
        const co = needCompany(str(args.company));
        const taker = auth.address ?? "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM"; // read-only quote when logged out
        const side = str(args.side) === "sell" ? "sell" : "buy";
        const q = await api.quote(co.id, side, num(args.amount), taker);
        return { company: co.name, side, pay: `${q.quote.inAmountUi} ${q.quote.inSymbol}`, receive: `${q.quote.outAmountUi.toFixed(6)} ${q.quote.outSymbol}`, priceImpactPct: q.quote.priceImpactPct, route: q.quote.route, quotedAt: q.quote.quotedAt, note: auth.address ? undefined : "indicative only — user not signed in" };
      }
      case "get_corporate_actions": {
        const co = needCompany(str(args.company));
        const d = await m.loadDetail(co.id, true);
        return { company: co.name, actions: d?.corporateActions ?? [], rebase: d?.price.rebase ?? null, note: "xStocks reflect dividends/splits through a balance multiplier (rebasing); treatment comes from the issuer's onchain data." };
      }

      /* ---------------- Trading (prepare only) ---------------- */
      case "prepare_buy": {
        const r = await prepareTrade(getAuth(), str(args.company), "buy", num(args.amount_usdc));
        if (!r.ok) return { ok: false, error: r.error, reasons: r.reasons };
        const q = r.intent.quote!;
        return { ok: true, status: "awaiting_user_confirmation", preview: { spend: `${q.inAmountUi} USDC`, receive: `≈ ${q.outAmountUi.toFixed(4)} ${q.outSymbol}`, priceImpactPct: q.priceImpactPct, route: q.route, network: "Solana" }, next: "Ask the user to press Confirm on the panel. Do not say the trade is complete." };
      }
      case "prepare_sell": {
        const co = needCompany(str(args.company));
        const pos = m.portfolio?.positions.find((p) => p.companyId === co.id);
        let amount = num(args.amount_tokens);
        if (!Number.isFinite(amount) || amount <= 0) {
          const frac = num(args.fraction);
          if (!pos) return { ok: false, error: `No ${co.tokenSymbol} position to sell.` };
          amount = pos.amountUi * (Number.isFinite(frac) && frac > 0 ? Math.min(1, frac) : 1);
        }
        const r = await prepareTrade(getAuth(), co.id, "sell", amount);
        if (!r.ok) return { ok: false, error: r.error, reasons: r.reasons };
        const q = r.intent.quote!;
        return { ok: true, status: "awaiting_user_confirmation", preview: { sell: `${q.inAmountUi} ${q.inSymbol}`, receive: `≈ ${q.outAmountUi.toFixed(2)} USDC`, priceImpactPct: q.priceImpactPct, route: q.route }, next: "Ask the user to press Confirm on the panel." };
      }
      case "create_price_trigger": {
        const kind = (str(args.kind) === "sell_above" ? "sell_above" : "buy_below") as TriggerKind;
        const r = await prepareTrigger(getAuth(), str(args.company), kind, num(args.trigger_price_usd), num(args.amount), Number.isFinite(num(args.expires_in_days)) ? num(args.expires_in_days) : 30);
        if (!r.ok) return { ok: false, error: r.error };
        return { ok: true, status: "awaiting_user_confirmation", rule: describeRule(r.rule), simulated: r.rule.simulated ? "server has no JUPITER_API_KEY — the rule will be recorded locally, not onchain" : undefined, next: "Ask the user to confirm on the holographic order panel." };
      }
      case "get_active_orders":
        return { orders: m.orders.filter((o) => o.status === "active").map((o) => ({ id: o.id, rule: describeRule(o), createdAt: o.createdAt, simulated: !!o.simulated, jupiterOrderId: o.jupiterOrderId ?? null })) };
      case "cancel_price_trigger": {
        const o = m.orders.find((x) => x.id === str(args.order_id) || x.jupiterOrderId === str(args.order_id));
        if (!o) return { ok: false, error: "Order not found" };
        m.setPendingOrder({ ...o, status: "cancelled" });
        return { ok: true, status: "awaiting_user_confirmation", rule: describeRule(o) };
      }

      /* ---------------- Compliance ---------------- */
      case "check_trade_eligibility": {
        const co = needCompany(str(args.company));
        const action = (["buy", "sell", "trigger"].includes(str(args.action)) ? str(args.action) : "buy") as "buy" | "sell" | "trigger";
        const r = await api.eligibility(co.id, action);
        return { company: co.name, allowed: r.result.allowed, reasons: r.result.reasons, disclosure: r.result.disclosure, disclosureUrl: r.result.disclosureUrl, asset: r.asset ? { symbol: r.asset.symbol, tradable: r.asset.tradable } : null, signedIn: getAuth().authenticated };
      }

      default:
        throw new Error(`Unknown tool ${name}`);
    }
  };
}

export const hasAsset = (companyId: string) => Boolean(assetForCompany(companyId));
