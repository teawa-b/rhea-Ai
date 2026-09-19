/* Executes Rhea's function tools in the browser (spec §8).
 *
 * Visual tools mutate the world store (the scene reacts). Market tools read
 * the API. Trade tools only *prepare* — they open a confirmation panel and
 * report back; execution happens when the user presses Confirm. Results are
 * compact JSON the backend model can turn into a spoken sentence.
 */
import { COMPANY_BY_ID, COUNTRIES, resolveCompany, resolveCountry } from "@shared/registry";
import type { AgentRule, ChartRange, CountryCode, NewsEvent } from "@shared/types";
import type { RheaAuth } from "@/auth/Auth";
import { api } from "@/market/api";
import { DEMO_READ_ONLY, assetForCompany, useMarket } from "@/state/market";
import { REGIONS, REGION_BY_ID } from "@/state/regions";
import { useWorld } from "@/state/world";
import { describeRule, hasTriggerToken, orderStatusLabel, prepareTrade, prepareTrigger, syncOrders, type TriggerKind } from "@/solana/trade";
import { fmtAge, fmtEt } from "@/theme";

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
      /* Session wording and the gap Rhea states before an off-hours trade (prompts.ts step 7). */
      sessionLabel: p.sessionLabel ?? null, lastCloseUsd: p.lastCloseUsd ?? null,
      tokenVsLast4pmClosePct: p.gapVsClosePct ?? null, halted: p.halted ?? null,
    },
    position: pos ? { tokens: pos.amountUi, valueUsd: pos.valueUsd } : null,
    activeOrders: orders.map((o) => ({ id: o.id, rule: describeRule(o), simulated: !!o.simulated })),
    corporateActions: d.corporateActions.map((c) => ({ caType: c.caType ?? c.type, effectiveAt: c.effectiveAt, upcoming: c.upcoming ?? false, netAmount: c.netAmount ?? null, grossAmount: c.grossAmount ?? null, detail: c.detail })),
    reserves: d.reserves ? `${d.reserves.symbol} ${d.reserves.backedPct}% backed (${d.reserves.custodian})` : null,
    /* A private company has no exchange behind it. The model must not describe
     * the mark as a stock price, quote a session, or call the token a share. */
    privateCompany: co.private
      ? {
          note: "Not listed on any exchange. The reference is the issuer's mark on the exposure behind the token, not a market price, and there is no trading session — the Solana market runs continuously.",
          markPriceUsd: p.markPriceUsd ?? null,
          premiumToMarkPct: p.premiumToMarkPct ?? null,
          impliedValuationUsd: p.impliedValuationUsd ?? null,
          instrument: d.asset?.issuerKey === "prestocks"
            ? "A PreStock: an issuer token backed 1:1 by SPV exposure tracking the private company's price. Economic exposure only — no ownership, voting, dividend or information rights — and not affiliated with or endorsed by the company. Not available in the US or to US persons."
            : null,
        }
      : null,
    /* More than one issuer wrapping the same company: different instruments
     * with different backing, so never present them as the same quote. */
    wrappers: (d.wrappers ?? []).length > 1
      ? (d.wrappers ?? []).map((w) => ({
          symbol: w.asset.symbol, issuer: w.asset.issuer, tokenPriceUsd: w.price.tokenPriceUsd,
          premiumToMarkPct: w.price.premiumToMarkPct ?? null, tradable: w.asset.tradable,
          liquidityUsd: w.asset.liquidityUsd ?? null,
        }))
      : null,
  };
}

function regionResult(id: string) {
  const region = REGION_BY_ID[id];
  const markets = (useMarket.getState().overview?.countries ?? []).filter((c) => region.countries.includes(c.code));
  return { ok: true, region: region.name, markets: markets.map((c) => ({ country: c.name, tradableStocks: c.tradableCount, companies: c.companies.map((cid) => COMPANY_BY_ID[cid]?.name) })) };
}

/* show_holdings and get_briefing share this: fly to the holdings planet and refresh the balances its moons show. */
function flyToHoldings() {
  useWorld.getState().showHoldings();
  return useMarket.getState().loadPortfolio();
}

/* Signed-out briefing: liquid names the server also defaults to (NVDAx, SPYx, TSLAx). */
const DEFAULT_WATCH = ["nvidia", "sp500", "tesla"];
const pct2 = (n: number) => Number(n.toFixed(2));

/** Limit-order lines for the briefing, from the store's synced orders (the backend can't read them: they need the wallet's JWT). */
async function briefingOrders(wallet: string, livePrice: Map<string, number>) {
  /* Fresh status only when a JWT is cached (never a prompt), and never more than 4 s of the opener. */
  const sync = hasTriggerToken(wallet) ? await Promise.race([syncOrders(null), new Promise<null>((r) => setTimeout(() => r(null), 4000))]) : null;
  const m = useMarket.getState();
  if (m.wallet !== wallet || !m.orders.length) return null;
  const active = m.orders.filter((o) => o.status === "active");
  const missing = [...new Set(active.map((o) => o.companyId))].filter((id) => !livePrice.has(id) && m.prices[id]?.tokenPriceUsd == null);
  if (missing.length) await m.loadPrices(missing);
  const prices = useMarket.getState().prices;
  const weekAgo = Date.now() - 7 * 86400_000;
  return {
    source: sync?.ok ? "Jupiter order history (live)" : `cached on this device${m.ordersSyncedAt ? `, last synced ${fmtAge(m.ordersSyncedAt)}` : ""}`,
    active: active.slice(0, 5).map((o) => {
      const px = livePrice.get(o.companyId) ?? prices[o.companyId]?.tokenPriceUsd ?? null;
      const below = o.condition.kind === "price_below";
      /* How far the live token price must still travel to reach the trigger; <= 0 means it is already there. */
      const away = px ? ((below ? px - o.condition.priceUsd : o.condition.priceUsd - px) / px) * 100 : null;
      return {
        symbol: COMPANY_BY_ID[o.companyId]?.tokenSymbol, rule: describeRule(o), status: orderStatusLabel(o), tokenPriceUsd: px == null ? null : pct2(px),
        distance: away == null ? null : away <= 0 ? "price is at or past the trigger; Jupiter fills it when it can" : `${pct2(away)}% ${below ? "fall" : "rise"} still needed`,
      };
    }),
    recentlyFilled: m.orders.filter((o) => o.status === "completed" && Date.parse(o.createdAt) >= weekAgo).slice(0, 3)
      .map((o) => ({ symbol: COMPANY_BY_ID[o.companyId]?.tokenSymbol, rule: describeRule(o), placedAt: fmtEt(o.createdAt), fillTx: o.fillTxSignature ?? null })),
    fundsStillInVault: m.orders.filter((o) => o.status !== "active" && o.needsWithdrawal).length || undefined,
    note: "Orders are held by Jupiter, not Rhea, in the user's Jupiter order vault.",
  };
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
        if (!p) { m.setLoginPrompt({ reason: "Sign in to see your portfolio on the globe", after: "show_portfolio_exposure" }); throw new Error("No wallet connected — a sign-in panel is now showing; ask the user to sign in there"); }
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
        /* The store's overview is already tradable-only. Liquidity lets the model keep thin names out of
         * trade suggestions; most-liquid first so a size-capped result still keeps the names worth naming.
         * $25k is the voice-suggestion floor; the $100 MIN_TRADABLE_LIQUIDITY_USD only decides globe visibility.
         * No ticker field (token is ≈ ticker + "x"): the live 67-name list stays ~10k chars, under the 12k output cap. */
        const TRADE_SIZE_MIN_LIQUIDITY_USD = 25_000;
        const liq = new Map(ov.assets.map((a) => [a.companyId, a.liquidityUsd ?? 0]));
        const companies = ov.companies
          .map((c) => ({ id: c.id, name: c.name, token: c.tokenSymbol, country: c.countryCode, sector: c.sector, liquidityUsd: Math.round((liq.get(c.id) ?? 0) / 100) * 100, tradeable_size_ok: (liq.get(c.id) ?? 0) >= TRADE_SIZE_MIN_LIQUIDITY_USD }))
          .sort((a, b) => b.liquidityUsd - a.liquidityUsd);
        return {
          fetchedAt: ov.fetchedAt,
          source: ov.source,
          note: `Only these companies are tradable now. Suggest trading only tradeable_size_ok names (>= $${TRADE_SIZE_MIN_LIQUIDITY_USD / 1000}k onchain liquidity).`,
          countries: ov.countries.map((c) => ({ code: c.code, name: c.name, tradable: c.tradableCount })),
          companies,
        };
      }
      case "get_company_profile":
        return companyProfile(str(args.company));
      case "show_private_markets": {
        useWorld.getState().showPrivateMarkets(true);
        const pm = await api.privateMarkets();
        return {
          ok: true,
          issuer: pm.issuer,
          instrument: "PreStocks are issuer tokens backed 1:1 by SPV exposure tracking a private company's price. Economic exposure only — no ownership, voting or dividends — and not endorsed by the company.",
          restrictedJurisdictions: pm.restrictedJurisdictions,
          companies: pm.assets.map((a) => ({
            company: a.companyName, symbol: a.symbol, sector: a.sector,
            onchainPriceUsd: a.tokenPriceUsd, issuerMarkUsd: a.markPriceUsd,
            premiumToMarkPct: a.premiumToMarkPct,
            impliedValuationUsd: a.impliedValuationUsd, issuerValuationUsd: a.markValuationUsd,
            holders: a.holders, liquidityUsd: a.liquidityUsd, tradable: a.tradable,
            markUnavailable: a.markUnavailable,
          })),
          note: "premiumToMarkPct is the onchain price against the issuer's own mark. A positive number means the market is paying above what PreStocks marks the exposure at; a negative one means below.",
        };
      }
      case "design_bonding_curve": {
        const co = needCompany(str(args.company));
        useWorld.getState().showDbcStudio(co.id);
        const supply = num(args.totalTokenSupply);
        const plan = await api.dbcPlan({
          companyId: co.id,
          ...(str(args.preset) ? { presetId: str(args.preset) } : {}),
          ...(Number.isFinite(supply) && supply > 0 ? { totalTokenSupply: supply } : {}),
        });
        return {
          ok: true,
          company: co.name,
          preset: plan.preset.name,
          referencePriceUsd: plan.referencePriceUsd,
          referenceSource: plan.referenceSource,
          startPriceUsd: plan.startPriceUsd,
          anchorBand: [plan.bandLowPriceUsd, plan.bandHighPriceUsd],
          migrationPriceUsd: plan.migrationPriceUsd,
          raiseToGraduate: plan.migrationQuoteThreshold,
          quoteSymbol: plan.quote.symbol,
          totalTokenSupply: plan.totalTokenSupply,
          segments: plan.segments.map((sg) => ({ name: sg.name, from: sg.lowerPriceUsd, to: sg.upperPriceUsd, shareOfRaisePct: sg.sharePct })),
          fee: `${plan.fee.startingFeeBps} bps decaying to ${plan.fee.endingFeeBps} bps over ${plan.fee.decayMinutes} minutes`,
          configValidates: plan.valid,
          warnings: plan.warnings,
          note: "This is a design, not a launch. Rhea cannot create, sign or fund a pool — the user takes the config to Meteora themselves.",
        };
      }
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
        if (!auth.authenticated) {
          m.setLoginPrompt({ reason: "Sign in to see your portfolio", after: "get_portfolio" });
          return { ok: false, error: "User is not signed in. A sign-in panel is now showing: ask them to sign in there (Google, email or a wallet); it creates an embedded Solana wallet for them." };
        }
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
      case "show_holdings": {
        const auth = getAuth();
        if (!auth.authenticated) {
          m.setLoginPrompt({ reason: "Sign in to see your holdings", after: "show_holdings" });
          return { ok: false, error: "User is not signed in. A sign-in panel is now showing: ask them to sign in there; their holdings planet opens once they're in." };
        }
        const p = await flyToHoldings();
        if (!p) throw new Error("Could not read the wallet");
        return {
          ok: true, shown: "holdings planet",
          usdcBalance: Number(p.usdcBalance.toFixed(2)), solBalance: Number(p.solBalance.toFixed(4)),
          stocks: p.positions.map((pos) => ({ company: COMPANY_BY_ID[pos.companyId].name, symbol: pos.symbol, tokens: Number(pos.amountUi.toFixed(4)), valueUsd: pos.valueUsd == null ? null : Number(pos.valueUsd.toFixed(2)) })),
          stocksValueUsd: Number(p.positions.reduce((s, x) => s + (x.valueUsd ?? 0), 0).toFixed(2)),
          totalValueUsd: Number(p.totalValueUsd.toFixed(2)),
          note: "totalValueUsd is USDC plus stocks; SOL is held for network fees and not priced here.",
        };
      }
      case "get_briefing": {
        /* The store's wallet covers a signed-in user and a read-only demo wallet alike. */
        const wallet = m.wallet;
        const [b, p] = await Promise.all([m.loadBriefing(wallet), wallet ? flyToHoldings() : Promise.resolve(null)]);
        let shown = wallet ? "holdings planet" : null;
        if (!wallet) {
          /* Signed out: fly to the first watchlist name so the globe moves while Rhea talks. */
          const first = (b?.holdings.map((h) => h.companyId) ?? DEFAULT_WATCH).find((id) => assetForCompany(id));
          if (first && w.focusCompany(first)) { void m.loadDetail(first, true); void m.loadHistory(first, w.chartRange); shown = COMPANY_BY_ID[first].name; }
        }
        if (!b) {
          if (!p) throw new Error("The briefing is unavailable right now");
          return { ok: false, shown, error: "The briefing service didn't answer, so there are no moves vs the 4pm close. Give the wallet value only and offer to try again.", totalValueUsd: Number(p.totalValueUsd.toFixed(2)), usdcBalance: Number(p.usdcBalance.toFixed(2)) };
        }
        const livePrice = new Map(b.holdings.filter((h) => h.tokenPriceUsd != null).map((h) => [h.companyId, h.tokenPriceUsd!]));
        const orders = wallet ? await briefingOrders(wallet, livePrice) : null;
        const biggest = b.holdings.filter((h) => h.movePctSinceClose != null).sort((x, y) => Math.abs(y.movePctSinceClose!) - Math.abs(x.movePctSinceClose!))[0];
        const s = b.session;
        return {
          ok: true, mode: b.mode, shown,
          session: { label: s.sessionLabel, nextRegularOpen: s.nextRegularOpenAt ? fmtEt(s.nextRegularOpenAt) : null, solana: "open" },
          totalValueUsd: b.totalValueUsd, usdcBalance: b.usdcBalance,
          biggestMoveVsClose: biggest ? { symbol: biggest.symbol, name: biggest.name, movePct: biggest.movePctSinceClose, tokenPriceUsd: biggest.tokenPriceUsd == null ? null : pct2(biggest.tokenPriceUsd), lastCloseUsd: biggest.lastCloseUsd, change24hPct: biggest.change24hPct } : null,
          holdings: b.holdings.slice(0, 8).map((h) => ({ symbol: h.symbol, valueUsd: h.valueUsd, movePctVsClose: h.movePctSinceClose, change24hPct: h.change24hPct })),
          ...(orders ? { orders } : {}),
          distributions: b.distributions.slice(0, 4).map((d) => ({ symbol: d.symbol, caType: d.caType, netAmount: d.netAmount, grossAmount: d.grossAmount, currency: d.currency, date: d.date?.slice(0, 10) ?? null, upcoming: d.upcoming, say: d.heldNote })),
          reserves: b.reserves.slice(0, 4).map((r) => `${r.symbol} ${r.backedPct}% backed (${r.custodian})`),
          notes: b.notes,
          next: `Speak chain facts only, in at most three short sentences and in this order: ${b.mode === "wallet" ? "the wallet value, " : "that this is a default watchlist (the user isn't signed in), "}the biggest move vs the 4pm close, ${orders ? "the order status, " : ""}any distribution (use its say wording and caType; never claim this wallet was paid), then reserves. Use the session label as given. No web_search for this. Then ask whether they want the news behind ${biggest?.name ?? "the biggest mover"}.`,
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
        return { company: co.name, actions: d?.corporateActions ?? [], rebase: d?.price.rebase ?? null, reserves: d?.reserves ?? null, note: "From the xStocks corporate actions API. Name each event by its caType exactly. Distributions are reflected in token balances through the multiplier; netAmount (after withholding) is what balances reflect. Don't claim this user was paid unless they held the token on that date." };
      }

      /* ---------------- Trading (prepare only) ----------------
       * In ?demo=1 prepareTrade / prepareTrigger refuse with the read-only message and open the sign-in panel. */
      case "prepare_buy": {
        const r = await prepareTrade(getAuth(), str(args.company), "buy", num(args.amount_usdc));
        if (!r.ok) return { ok: false, error: r.error, reasons: r.reasons };
        const q = r.intent.quote!;
        return { ok: true, status: "awaiting_user_confirmation", preview: { spend: `${q.inAmountUi} USDC`, receive: `≈ ${q.outAmountUi.toFixed(4)} ${q.outSymbol}`, priceImpactPct: q.priceImpactPct, route: q.route, network: "Solana" }, next: `Ask the user to press Confirm on the panel. Do not say the trade is complete.` };
      }
      case "prepare_sell": {
        const co = needCompany(str(args.company));
        const pos = m.portfolio?.positions.find((p) => p.companyId === co.id);
        let amount = num(args.amount_tokens);
        if (!Number.isFinite(amount) || amount <= 0) {
          const frac = num(args.fraction);
          /* The demo wallet's own positions may be missing: fall through so prepareTrade gives the read-only refusal. */
          if (!pos && !m.demoMode) return { ok: false, error: `No ${co.tokenSymbol} position to sell.` };
          amount = (pos?.amountUi ?? 1) * (Number.isFinite(frac) && frac > 0 ? Math.min(1, frac) : 1);
        }
        const r = await prepareTrade(getAuth(), co.id, "sell", amount);
        if (!r.ok) return { ok: false, error: r.error, reasons: r.reasons };
        const q = r.intent.quote!;
        return { ok: true, status: "awaiting_user_confirmation", preview: { sell: `${q.inAmountUi} ${q.inSymbol}`, receive: `≈ ${q.outAmountUi.toFixed(2)} USDC`, priceImpactPct: q.priceImpactPct, route: q.route }, next: `Ask the user to press Confirm on the panel.` };
      }
      case "create_price_trigger": {
        const kind = (str(args.kind) === "sell_above" ? "sell_above" : "buy_below") as TriggerKind;
        const r = await prepareTrigger(getAuth(), str(args.company), kind, num(args.trigger_price_usd), num(args.amount), Number.isFinite(num(args.expires_in_days)) ? num(args.expires_in_days) : 30);
        if (!r.ok) return { ok: false, error: r.error };
        return { ok: true, status: "awaiting_user_confirmation", rule: describeRule(r.rule), simulated: r.rule.simulated ? "dev build without JUPITER_API_KEY: the rule is recorded on this device only, not on Jupiter" : undefined, next: `Ask the user to confirm on the order panel.` };
      }
      case "get_active_orders": {
        const auth = getAuth();
        if (!auth.authenticated || !auth.address) return { ok: false, error: "User is not signed in, so there are no orders to show. Limit orders belong to a wallet; ask them to sign in first." };
        /* Live from Jupiter only when a JWT is cached: this tool must never spring a signature prompt. */
        const sync = hasTriggerToken(auth.address) ? await syncOrders(auth) : null;
        const cur = useMarket.getState();
        const view = (o: AgentRule) => ({
          id: o.id, jupiterOrderId: o.jupiterOrderId ?? null, rule: describeRule(o), status: orderStatusLabel(o), createdAt: o.createdAt, expiresAt: o.expiresAt ?? null,
          ...(o.simulated ? { simulated: "dev only, not on Jupiter" } : {}),
        });
        /* Orders still holding funds (expired, or a cancel not yet signed) need the user's withdrawal. */
        const withdrawable = cur.orders.filter((o) => o.status !== "active" && o.needsWithdrawal);
        return {
          source: sync?.ok ? "Jupiter order history (live)" : "cached on this device",
          syncedAt: sync?.ok ? sync.syncedAt : cur.ordersSyncedAt,
          orders: cur.orders.filter((o) => o.status === "active").map(view),
          ...(withdrawable.length ? { fundsStillInVault: withdrawable.map(view) } : {}),
          note: sync?.ok
            ? "Orders are held by Jupiter, not Rhea, in the user's Jupiter order vault. To cancel one (or withdraw an expired order's funds), call cancel_price_trigger with its id."
            : `Live status from Jupiter needs a quick wallet signature, so this is the list last cached on this device and may be out of date${sync && !sync.needsSignature ? ` (Jupiter didn't answer: ${sync.error})` : ""}. Say so plainly; it refreshes after the user's next order or cancel.`,
        };
      }
      case "cancel_price_trigger": {
        const auth = getAuth();
        if (!auth.authenticated || !auth.address) return { ok: false, error: "User is not signed in. Orders can only be cancelled by the wallet that placed them; ask them to sign in first." };
        if (hasTriggerToken(auth.address)) await syncOrders(auth); // fresh status first, never a prompt
        const q = str(args.order_id).trim();
        const orders = useMarket.getState().orders;
        /* Exact id, else a unique prefix of the Jupiter id (the card shows the first 8 characters). */
        const prefix = q.length >= 6 ? orders.filter((x) => x.jupiterOrderId?.startsWith(q)) : [];
        const o = orders.find((x) => x.id === q || x.jupiterOrderId === q) ?? (prefix.length === 1 ? prefix[0] : undefined);
        if (!o) return { ok: false, error: prefix.length > 1 ? "That id matches more than one order; use the full id from get_active_orders." : "Order not found. Call get_active_orders for the current ids." };
        if (o.status === "completed") return { ok: false, error: `That order already filled (${describeRule(o)}), so there is nothing to cancel.` };
        if (o.status === "cancelled" && !o.needsWithdrawal) return { ok: false, error: `That order is already ${orderStatusLabel(o).toLowerCase()}; nothing is left to cancel.`, refundTx: o.withdrawTxSignature ?? null };
        /* Opens the confirmation card only: cancelling needs the user's press and a wallet signature. */
        m.setPendingOrder(o, "cancel");
        return {
          ok: true, status: "awaiting_user_confirmation", rule: describeRule(o), orderStatus: orderStatusLabel(o),
          next: o.needsWithdrawal
            ? "Ask the user to press Withdraw funds on the card and approve the wallet signature; it returns the funds from their Jupiter order vault. Do not say it is done."
            : "Ask the user to press Cancel order on the card. Jupiter stops the order, then they approve one wallet signature for the refund from their Jupiter order vault. Do not say it is cancelled yet.",
        };
      }

      /* ---------------- Trade checks (liquidity floor, minimums) ---------------- */
      case "check_trade_eligibility": {
        const co = needCompany(str(args.company));
        const action = (["buy", "sell", "trigger"].includes(str(args.action)) ? str(args.action) : "buy") as "buy" | "sell" | "trigger";
        const auth = getAuth();
        const r = await api.eligibility(co.id, action);
        return {
          company: co.name,
          allowed: m.demoMode ? false : r.result.allowed,
          reasons: m.demoMode ? [DEMO_READ_ONLY, ...r.result.reasons] : r.result.reasons,
          disclosure: r.result.disclosure, disclosureUrl: r.result.disclosureUrl,
          asset: r.asset ? { symbol: r.asset.symbol, tradable: r.asset.tradable } : null,
          signedIn: auth.authenticated,
        };
      }

      default:
        throw new Error(`Unknown tool ${name}`);
    }
  };
}

export const hasAsset = (companyId: string) => Boolean(assetForCompany(companyId));
