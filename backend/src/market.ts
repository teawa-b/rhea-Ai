/* Market, portfolio, compliance and trading routes. */
import type { Request, Response, Router } from "express";
import express from "express";
import { Connection, PublicKey } from "@solana/web3.js";
import {
  COMPANIES, COMPANY_BY_ID, COMPANY_BY_TOKEN, COUNTRIES, MIN_TRADE_LIQUIDITY_USD,
  TESSERA_DISCLOSURE_URL, TESSERA_ISSUER, TESSERA_MIN_TRADE_USD, TESSERA_RESTRICTED_JURISDICTIONS, TESSERA_TERMS_URL,
  TRIGGER_MIN_ORDER_USD, USDC_MINT,
  XSTOCKS_DISCLOSURE_URL, XSTOCKS_MIN_TRADE_USD, XSTOCKS_RESTRICTED_JURISDICTIONS, resolveCompany,
} from "../shared/registry";
import type {
  AssetCapability, Briefing, BriefingDistribution, BriefingHolding, ChartRange, Company, CorporateAction, CountrySummary, EligibilityResult,
  MarketOverview, Portfolio, Position, PrivateMarketSnapshot, PrivateMarketsOverview, TokenizedAsset,
} from "../shared/types";
import { hasPythKey, history, lastCloseFor, priceSnapshot, sessionInfo } from "./feeds";
import { JupiterError, executeSwap, getPrices, getSwapQuote, hasJupiterKey, listTokenizedAssets, triggerProxy, type JupPrice } from "./jupiter";
import {
  TESSERA_DISCLOSURE, impliedValuation, premiumToMark, tesseraProofOfReserve, tesseraTokens,
} from "./tessera";
import { corporateActions, proofOfReserves, type XCorporateAction } from "./xstocks";

const RPC_URL = process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";
const TOKEN_PROGRAM = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const TOKEN_2022_PROGRAM = new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
const IS_PROD = process.env.NODE_ENV === "production";

const conn = new Connection(RPC_URL, "confirmed");

function bad(res: Response, status: number, message: string) {
  res.status(status).json({ error: message });
}

/* Trading routes: the client shows `error` verbatim (market/api.ts reads
 * detail || error), so it is always one plain sentence. Raw upstream text is
 * logged and, outside production only, echoed as `debug`. Never set `detail`. */
function fail(res: Response, e: unknown, fallback = "Couldn't reach Jupiter right now, so please try again.") {
  if (e instanceof JupiterError) {
    res.status(e.httpStatus).json({ error: e.message, ...(IS_PROD ? {} : { debug: e.raw }) });
    return;
  }
  const raw = (e as Error)?.message ?? String(e);
  console.warn("[market] trade route error:", raw);
  res.status(502).json({ error: fallback, ...(IS_PROD ? {} : { debug: raw }) });
}

/** The company's primary wrapper — what a bare "buy SpaceX" resolves to. */
async function assetFor(companyId: string): Promise<TokenizedAsset | undefined> {
  const assets = await listTokenizedAssets();
  const mine = assets.filter((a) => a.companyId === companyId);
  return mine.find((a) => a.primary) ?? mine[0];
}

/** Every tokenized wrapper of a company, primary first, then by liquidity. */
async function assetsFor(companyId: string): Promise<TokenizedAsset[]> {
  const assets = await listTokenizedAssets();
  return assets
    .filter((a) => a.companyId === companyId)
    .sort((a, b) => Number(b.primary) - Number(a.primary) || (b.liquidityUsd ?? 0) - (a.liquidityUsd ?? 0));
}

/** One wrapper by asset id, so the client can price a specific issuer's token. */
async function assetById(assetId: string): Promise<TokenizedAsset | undefined> {
  return (await listTokenizedAssets()).find((a) => a.id === assetId);
}

/* ---------------- Overview ---------------- */

export async function buildOverview(): Promise<MarketOverview> {
  const assets = await listTokenizedAssets();
  const byCountry = new Map<string, CountrySummary>();
  for (const cd of Object.values(COUNTRIES)) {
    byCountry.set(cd.code, { code: cd.code, name: cd.name, lat: cd.lat, lng: cd.lng, assetCount: 0, tradableCount: 0, companies: [] });
  }
  for (const a of assets) {
    const co = COMPANY_BY_ID[a.companyId];
    const cs = byCountry.get(co.countryCode);
    if (!cs) continue;
    cs.assetCount += 1;
    if (a.tradable) cs.tradableCount += 1;
    cs.companies.push(co.id);
  }
  const countries = [...byCountry.values()].filter((cs) => cs.assetCount > 0).sort((a, b) => b.assetCount - a.assetCount);
  const companyIds = new Set(assets.map((a) => a.companyId));
  return {
    countries,
    companies: COMPANIES.filter((c) => companyIds.has(c.id)),
    assets,
    fetchedAt: new Date().toISOString(),
    source: hasJupiterKey() ? "Jupiter Tokens API v2 (stocks tag)" : "Jupiter Tokens API v2 (search)",
  };
}

/* ---------------- Private (pre-IPO) markets ----------------
 *
 * The companies here are not listed anywhere, so none of the equity machinery
 * applies: no session, no close, no Pyth feed. What a viewer needs instead is
 * the issuer's mark, the price the onchain market is actually paying, and the
 * gap between the two — plus where the backing is attested.
 */

/** Tessera's display symbol for a wrapper ("tSpaceX" -> "T-SpaceX"). */
function tesseraSymbolFor(asset: TokenizedAsset): string {
  const code = asset.symbol;
  return /^t[A-Z]/.test(code) ? `T-${code.slice(1)}` : code;
}

export async function buildPrivateMarkets(): Promise<PrivateMarketsOverview> {
  const [assets, marks] = await Promise.all([listTokenizedAssets(), tesseraTokens()]);
  const tTokens = assets.filter((a) => a.issuerKey === "tessera");

  const out: PrivateMarketSnapshot[] = [];
  for (const a of tTokens) {
    const co = COMPANY_BY_ID[a.companyId];
    if (!co) continue;
    const mark = marks?.find((m) => m.mint === a.mint) ?? null;
    const prices = await getPrices([a.mint]).catch(() => ({} as Record<string, JupPrice>));
    const p = prices[a.mint];
    const tokenPrice = p?.usdPrice ?? null;
    const premium = premiumToMark(tokenPrice, mark?.markPriceUsd);
    const display = mark?.symbol ?? tesseraSymbolFor(a);
    out.push({
      companyId: co.id,
      companyName: co.name,
      mint: a.mint,
      symbol: display,
      issuer: TESSERA_ISSUER,
      sector: mark?.sector ?? co.sector,
      tokenPriceUsd: tokenPrice,
      markPriceUsd: mark?.markPriceUsd ?? null,
      markValuationUsd: mark?.markValuationUsd ?? null,
      impliedValuationUsd: impliedValuation(tokenPrice, mark),
      premiumToMarkPct: premium == null ? null : Math.round(premium * 100) / 100,
      /* Holder counts: the issuer's own figure first, Jupiter's as a fallback. */
      holders: mark?.holders ?? a.holderCount ?? null,
      liquidityUsd: a.liquidityUsd ?? null,
      change24hPct: p?.priceChange24h ?? null,
      tradable: a.tradable,
      markFetchedAt: mark?.fetchedAt ?? null,
      attestation: tesseraProofOfReserve(display),
      markUnavailable: mark == null,
    });
  }
  /* Biggest implied valuation first — that is the order people scan them in. */
  out.sort((x, y) => (y.impliedValuationUsd ?? 0) - (x.impliedValuationUsd ?? 0));

  return {
    assets: out,
    issuer: TESSERA_ISSUER,
    disclosure: TESSERA_DISCLOSURE,
    disclosureUrl: TESSERA_DISCLOSURE_URL,
    termsUrl: TESSERA_TERMS_URL,
    restrictedJurisdictions: TESSERA_RESTRICTED_JURISDICTIONS,
    fetchedAt: new Date().toISOString(),
  };
}

/* ---------------- Trade checks: liquidity floor + minimums ---------------- */

export function capabilityFor(asset: TokenizedAsset): AssetCapability {
  const tessera = asset.issuerKey === "tessera";
  return {
    assetId: asset.id,
    issuer: asset.issuer,
    supportedJurisdictions: "all",
    restrictedJurisdictions: tessera ? TESSERA_RESTRICTED_JURISDICTIONS : XSTOCKS_RESTRICTED_JURISDICTIONS,
    requiresKyc: false,
    tradable: asset.tradable,
    transferable: true,
    minimumTradeUsd: tessera ? TESSERA_MIN_TRADE_USD : XSTOCKS_MIN_TRADE_USD,
    disclosureUrl: tessera ? TESSERA_DISCLOSURE_URL : XSTOCKS_DISCLOSURE_URL,
  };
}

export const XSTOCKS_DISCLOSURE =
  `xStocks are tracker certificates issued by Backed Finance that track the price of a listed share, not the share itself. ` +
  `They carry issuer, market, liquidity and smart-contract risk, and their price can move outside regular US trading hours. ` +
  `This is not investment advice.`;

/** The disclosure that belongs to whoever issued this token. */
export function disclosureFor(asset: TokenizedAsset | undefined): { disclosure: string; disclosureUrl: string } {
  return asset?.issuerKey === "tessera"
    ? { disclosure: TESSERA_DISCLOSURE, disclosureUrl: TESSERA_DISCLOSURE_URL }
    : { disclosure: XSTOCKS_DISCLOSURE, disclosureUrl: XSTOCKS_DISCLOSURE_URL };
}

export function checkEligibility(asset: TokenizedAsset | undefined, action: "buy" | "sell" | "trigger", amountUsd?: number): EligibilityResult {
  const reasons: string[] = [];
  const { disclosure, disclosureUrl } = disclosureFor(asset);
  if (!asset) return { allowed: false, reasons: ["This company has no tokenized asset on Solana yet."], disclosure, disclosureUrl };
  const cap = capabilityFor(asset);
  const liquidity = asset.liquidityUsd ?? 0;
  /* Sells stay open at any liquidity so a holder is never locked in. */
  if (action !== "sell" && (!cap.tradable || liquidity < MIN_TRADE_LIQUIDITY_USD)) {
    reasons.push(`${asset.symbol} has only $${Math.round(liquidity).toLocaleString("en-US")} of onchain liquidity — too thin to trade safely right now.`);
  }
  if (action === "buy" && amountUsd != null && amountUsd < cap.minimumTradeUsd) reasons.push(`Minimum trade is $${cap.minimumTradeUsd}.`);
  if (action === "trigger" && amountUsd != null && amountUsd < TRIGGER_MIN_ORDER_USD) reasons.push(`Jupiter limit orders need at least $${TRIGGER_MIN_ORDER_USD}.`);
  return { allowed: reasons.length === 0, reasons, disclosure, disclosureUrl: cap.disclosureUrl };
}

/* ---------------- Portfolio ---------------- */

export async function readPortfolio(wallet: string): Promise<Portfolio> {
  const owner = new PublicKey(wallet);
  const assets = await listTokenizedAssets();
  const byMint = new Map(assets.map((a) => [a.mint, a]));

  const [lamports, spl, t22] = await Promise.all([
    conn.getBalance(owner),
    conn.getParsedTokenAccountsByOwner(owner, { programId: TOKEN_PROGRAM }),
    conn.getParsedTokenAccountsByOwner(owner, { programId: TOKEN_2022_PROGRAM }),
  ]);

  let usdc = 0;
  const holdings: { mint: string; amountUi: number }[] = [];
  for (const acc of [...spl.value, ...t22.value]) {
    const info = (acc.account.data as { parsed?: { info?: { mint?: string; tokenAmount?: { uiAmount?: number | null } } } }).parsed?.info;
    const mint = info?.mint; const ui = info?.tokenAmount?.uiAmount ?? 0;
    if (!mint || !ui) continue;
    if (mint === USDC_MINT) usdc += ui;
    else if (byMint.has(mint)) holdings.push({ mint, amountUi: ui });
  }

  const prices: Record<string, JupPrice> = holdings.length ? await getPrices(holdings.map((h) => h.mint)).catch(() => ({})) : {};
  const positions: Position[] = holdings.map((h) => {
    const a = byMint.get(h.mint)!;
    const p = prices[h.mint]?.usdPrice ?? null;
    return { companyId: a.companyId, mint: h.mint, symbol: a.symbol, amountUi: h.amountUi, tokenPriceUsd: p, valueUsd: p == null ? null : p * h.amountUi };
  }).sort((a, b) => (b.valueUsd ?? 0) - (a.valueUsd ?? 0));

  return {
    wallet,
    solBalance: lamports / 1e9,
    usdcBalance: usdc,
    positions,
    totalValueUsd: usdc + positions.reduce((s, p) => s + (p.valueUsd ?? 0), 0),
    fetchedAt: new Date().toISOString(),
  };
}

/* ---------------- Corporate actions (xStocks issuer API, classified) ---------------- */

const CA_TYPE: Record<string, CorporateAction["type"]> = {
  CashDividend: "dividend", StockDividend: "dividend", CashAndStockDividend: "dividend",
  ForwardSplit: "split", UnitSplit: "split", ReverseSplit: "reverse_split",
  CashMerger: "merger", StockMerger: "merger", StockAndCashMerger: "merger",
  NameChange: "ticker_change", Redemption: "delisting", WorthlessRemoval: "delisting",
};
/* Types the issuer reflects through the Token-2022 balance multiplier. */
const VIA_MULTIPLIER = new Set<CorporateAction["type"]>(["dividend", "split", "reverse_split"]);

/* $0.175, $0.25, $2.00, $3,140.64, $0.00 */
const usd = (n: number) => `$${n >= 1 || n === 0 ? n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : String(Number(n.toFixed(4)))}`;
const r2 = (n: number) => Math.round(n * 100) / 100;
/* Built by hand: ICU's en-GB short month is "Sept", and speech wants "10 Sep". */
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function dayParts(iso: string, timeZone: string) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short", day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  return { wd: p.weekday, date: `${p.day} ${MONTHS[+p.month - 1]}`, hm: `${p.hour}:${p.minute}` };
}
const utcDay = (iso: string) => dayParts(iso, "UTC").date;                                                      // "10 Sep"
const etDay = (iso: string) => { const p = dayParts(iso, "America/New_York"); return `${p.wd} ${p.date}`; };        // "Mon 14 Sep"
const etStamp = (iso: string) => { const p = dayParts(iso, "America/New_York"); return `${p.wd} ${p.date} ${p.hm} ET`; }; // "Tue 15 Sep 09:30 ET"
const multChanged = (c: XCorporateAction) => c.multiplierOld != null && c.multiplierNew != null && c.multiplierOld !== c.multiplierNew;

function caDetail(c: XCorporateAction, upcoming: boolean): string {
  const parts: string[] = [];
  const wht = c.withholdingRate ? ` after ${Math.round(c.withholdingRate * 100)}% withholding` : "";
  if (c.grossAmount != null && c.netAmount != null && c.grossAmount !== c.netAmount) parts.push(`${c.caType}: gross ${usd(c.grossAmount)}, net ${usd(c.netAmount)} per share-equivalent${wht}.`);
  else if ((c.netAmount ?? c.grossAmount) != null) parts.push(`${c.caType}: ${usd((c.netAmount ?? c.grossAmount)!)} per share-equivalent${wht}.`);
  else if (c.fromUnits != null && c.toUnits != null) parts.push(`${c.caType}: ${c.fromUnits} → ${c.toUnits} units.`);
  else parts.push(`${c.caType}.`);
  if (multChanged(c)) parts.push(`Balance multiplier ${c.multiplierOld!.toFixed(6)} → ${c.multiplierNew!.toFixed(6)}, so token balances reflect it.`);
  else if (upcoming && VIA_MULTIPLIER.has(CA_TYPE[c.caType] ?? "other")) parts.push("Scheduled; the issuer reflects it in token balances through the multiplier.");
  if (c.redemptionPriceUsd != null) parts.push(`Redemption price ${usd(c.redemptionPriceUsd)}.`);
  if (c.notes) parts.push(c.notes);
  return parts.join(" ");
}

/** xStocks events (upcoming + last 90 days) for the company panel. Jupiter's scaled-UI config can
 *  announce a multiplier change before the issuer API lists it, so that stays as a "rebase" row. */
function classifyCorporateActions(
  companyId: string,
  xs: { history: XCorporateAction[]; upcoming: XCorporateAction[] } | null,
  rebase: { multiplier: number; newMultiplier?: number; newMultiplierEffectiveAt?: string } | undefined,
): CorporateAction[] {
  const since = Date.now() - 90 * 86_400_000;
  const rows: [XCorporateAction, boolean][] = [
    ...(xs?.upcoming ?? []).map((c) => [c, true] as [XCorporateAction, boolean]),
    ...(xs?.history ?? []).filter((c) => Date.parse(c.effectiveAt ?? c.createdAt) >= since).map((c) => [c, false] as [XCorporateAction, boolean]),
  ];
  const out: CorporateAction[] = rows.map(([c, upcoming]) => ({
    id: `${companyId}:xstocks:${c.eventId}`,
    companyId,
    type: CA_TYPE[c.caType] ?? "other",
    caType: c.caType,
    effectiveAt: c.effectiveAt ?? c.createdAt,
    source: "xStocks corporate actions API (Backed)",
    detail: caDetail(c, upcoming),
    previousMultiplier: c.multiplierOld ?? undefined,
    newMultiplier: c.multiplierNew ?? undefined,
    grossAmount: c.grossAmount ?? undefined,
    netAmount: c.netAmount ?? undefined,
    currency: c.currency,
    withholdingPct: c.withholdingRate == null ? undefined : Math.round(c.withholdingRate * 100),
    payDate: c.payDate ?? undefined,
    upcoming,
  }));
  const known = (m: number) => [...(xs?.history ?? []), ...(xs?.upcoming ?? [])].some((c) => c.multiplierNew != null && Math.abs(c.multiplierNew - m) < 1e-9);
  if (rebase?.newMultiplier && rebase.newMultiplierEffectiveAt && rebase.newMultiplier !== rebase.multiplier && !known(rebase.newMultiplier)) {
    out.unshift({
      id: `${companyId}:rebase:${rebase.newMultiplierEffectiveAt}`,
      companyId,
      type: "rebase",
      effectiveAt: rebase.newMultiplierEffectiveAt,
      source: "xStocks scaled-UI multiplier (onchain)",
      detail: `Balance multiplier changes from ${rebase.multiplier.toFixed(6)} to ${rebase.newMultiplier.toFixed(6)}; the issuer reflects corporate actions by changing displayed token balances.`,
      previousMultiplier: rebase.multiplier,
      newMultiplier: rebase.newMultiplier,
      upcoming: Date.parse(rebase.newMultiplierEffectiveAt) > Date.now(),
    });
  }
  return out;
}

/* ---------------- Briefing (stateless, anchored to the last 4pm close) ---------------- */

const DEFAULT_WATCH = ["NVDAX", "SPYX", "TSLAX"].map((t) => COMPANY_BY_TOKEN[t]?.id).filter(Boolean) as string[];
const SESSION_REF = COMPANY_BY_TOKEN.NVDAX ?? COMPANY_BY_ID.nvidia;
const BRIEF_ROWS = 20;
/* Distributions + reserves cost 3 xStocks calls per symbol: only for the largest rows. */
const BRIEF_DETAIL = 8;
const MONTH_MS = 30 * 86_400_000;

function heldNote(sym: string, c: XCorporateAction, upcoming: boolean): string {
  const when = c.effectiveAt ? utcDay(c.effectiveAt) : "a date the issuer hasn't set";
  const cash = c.netAmount != null ? `a net ${usd(c.netAmount)}` : c.grossAmount != null ? `a gross ${usd(c.grossAmount)}` : null;
  const viaMult = VIA_MULTIPLIER.has(CA_TYPE[c.caType] ?? "other");
  if (upcoming) {
    return `${sym} has a ${c.caType} scheduled for ${when}${cash ? `: ${cash} per share-equivalent` : ""}${viaMult ? ", to be reflected in balances via the multiplier" : ""}`;
  }
  const reflected = multChanged(c) ? ", reflected in balances via the multiplier" : "";
  return cash
    ? `${sym} holders received ${cash} per share-equivalent on ${when}${reflected}`
    : `${sym} ${c.caType} took effect on ${when}${reflected}`;
}

export async function buildBriefing(wallet: string | null, watchIds: string[]): Promise<Briefing> {
  let walletNote: string | null = null;
  const [session, assets, portfolio] = await Promise.all([
    sessionInfo(SESSION_REF),
    listTokenizedAssets(),
    wallet
      ? readPortfolio(wallet).catch((e) => {
        console.warn("[market] briefing portfolio read failed:", (e as Error).message);
        walletNote = "Couldn't read this wallet from Solana right now, so this covers the default watchlist.";
        return null;
      })
      : Promise.resolve(null),
  ]);

  type Row = { co: Company; mint: string; symbol: string; amountUi: number | null; valueUsd: number | null };
  const positions = (portfolio?.positions ?? []).filter((p) => COMPANY_BY_ID[p.companyId]);
  const mode: Briefing["mode"] = positions.length ? "wallet" : "watchlist";
  if (portfolio && !positions.length) walletNote = "This wallet holds no xStocks yet, so this covers the default watchlist.";
  const rows: Row[] = (mode === "wallet"
    ? positions.map((p) => ({ co: COMPANY_BY_ID[p.companyId], mint: p.mint, symbol: p.symbol, amountUi: p.amountUi, valueUsd: p.valueUsd }))
    : watchIds.flatMap((id) => {
      const a = assets.find((x) => x.companyId === id);
      return a && COMPANY_BY_ID[id] ? [{ co: COMPANY_BY_ID[id], mint: a.mint, symbol: a.symbol, amountUi: null, valueUsd: null }] : [];
    })).slice(0, BRIEF_ROWS);
  const detail = rows.slice(0, BRIEF_DETAIL);

  const [prices, closes, cas, pors] = await Promise.all([
    rows.length ? getPrices(rows.map((r) => r.mint)).catch(() => ({}) as Record<string, JupPrice>) : Promise.resolve({} as Record<string, JupPrice>),
    Promise.all(rows.map((r) => lastCloseFor(r.co))),
    Promise.all(detail.map((r) => corporateActions(r.co.tokenSymbol))),
    Promise.all(detail.map((r) => proofOfReserves(r.co.tokenSymbol))),
  ]);

  const holdings: BriefingHolding[] = rows.map((r, i) => {
    const p = prices[r.mint];
    const tp = p?.usdPrice ?? null;
    const close = closes[i]?.lastCloseUsd ?? null;
    return {
      companyId: r.co.id, symbol: r.symbol, name: r.co.name,
      amountUi: r.amountUi, valueUsd: r.valueUsd == null ? null : r2(r.valueUsd),
      tokenPriceUsd: tp, lastCloseUsd: close,
      movePctSinceClose: tp && close ? r2((tp / close - 1) * 100) : null,
      change24hPct: p?.priceChange24h == null ? null : r2(p.priceChange24h),
    };
  });

  const now = Date.now();
  const distributions: BriefingDistribution[] = [];
  detail.forEach((r, i) => {
    const x = cas[i];
    if (!x) return;
    const sym = r.co.tokenSymbol;
    const recent = x.history.filter((c) => c.effectiveAt && Date.parse(c.effectiveAt) <= now && now - Date.parse(c.effectiveAt) <= MONTH_MS);
    const soon = x.upcoming.filter((c) => c.effectiveAt && Date.parse(c.effectiveAt) - now <= MONTH_MS);
    for (const [c, upcoming] of [...recent.map((c) => [c, false] as const), ...soon.map((c) => [c, true] as const)]) {
      distributions.push({
        companyId: r.co.id, symbol: sym, caType: c.caType, netAmount: c.netAmount, grossAmount: c.grossAmount, currency: c.currency,
        date: c.effectiveAt, upcoming, heldNote: heldNote(sym, c, upcoming),
      });
    }
  });

  const reserves = pors.flatMap((p) => (p ? [{ symbol: p.symbol, backedPct: p.backedPct, custodian: p.custodian, asOf: p.asOf }] : []));

  /* Speakable facts, chain facts first: session, value, biggest move vs close, distributions, reserves. */
  const notes: string[] = [];
  if (walletNote) notes.push(walletNote);
  const openAt = session.nextRegularOpenAt ? etStamp(session.nextRegularOpenAt) : null;
  notes.push(session.usRegularOpen
    ? "US regular session is open, so moves are vs the previous 4pm close."
    : `${session.sessionLabel[0].toUpperCase()}${session.sessionLabel.slice(1)}${openAt ? `; next US regular open ${openAt}` : ""}. Jupiter swaps on Solana stay open${session.xstocksPeriod ? ` (xStocks period: ${session.xstocksPeriod})` : ""}.`);
  const closeAt = closes.find((c) => c?.lastCloseAt)?.lastCloseAt;
  if (!session.usRegularOpen && closeAt) notes.push(`Moves compare the live Solana token price with the underlying's 4pm ET close on ${etDay(closeAt)}.`);
  if (portfolio && mode === "wallet") notes.push(`Wallet value ${usd(portfolio.totalValueUsd)} (xStocks plus ${usd(portfolio.usdcBalance)} USDC).`);
  const mover = holdings.filter((h) => h.movePctSinceClose != null).sort((a, b) => Math.abs(b.movePctSinceClose!) - Math.abs(a.movePctSinceClose!))[0];
  if (mover) {
    const m = mover.movePctSinceClose!;
    notes.push(`${mover.symbol} is ${m >= 0 ? "up" : "down"} ${Math.abs(m).toFixed(2)}% vs 4pm close (${usd(mover.tokenPriceUsd!)} vs ${usd(mover.lastCloseUsd!)}).`);
  }
  if (distributions.length) notes.push(...distributions.slice(0, 3).map((d) => `${d.heldNote}.`));
  else if (detail.length) notes.push("No distributions in the last 30 days and none scheduled in the next 30 days for these xStocks.");
  if (reserves.length) notes.push(`Proof of reserves: ${reserves.map((p) => `${p.symbol} ${p.backedPct.toFixed(2)}% backed (${p.custodian})`).join(", ")}.`);
  notes.push("xStocks are tracker certificates that follow the share price; they are not the shares themselves.");
  if (mode === "wallet") notes.push("Limit orders aren't in this briefing: they are held by Jupiter, not Rhea, in your Jupiter order vault, and the signed-in app reads them.");

  return {
    wallet,
    mode,
    asOf: new Date().toISOString(),
    session,
    totalValueUsd: portfolio ? r2(portfolio.totalValueUsd) : null,
    usdcBalance: portfolio ? r2(portfolio.usdcBalance) : null,
    holdings,
    distributions,
    reserves,
    notes,
  };
}

/* 60 s per wallet + watchlist; the promise is cached so concurrent calls share one build. */
const briefCache = new Map<string, { at: number; data: Promise<Briefing> }>();
function briefingCached(wallet: string | null, watch: string[]): Promise<Briefing> {
  const key = `${wallet ?? "-"}|${watch.join(",")}`;
  const hit = briefCache.get(key);
  if (hit && Date.now() - hit.at < 60_000) return hit.data;
  for (const [k, v] of briefCache) if (Date.now() - v.at >= 60_000) briefCache.delete(k);
  const data = buildBriefing(wallet, watch);
  briefCache.set(key, { at: Date.now(), data });
  data.catch(() => briefCache.delete(key));
  return data;
}

/* ?watch=nvidia,sp500,tesla (names, tickers or token symbols) → company ids, max 6. */
function watchFrom(q: unknown): string[] {
  const ids = String(q ?? "").split(",").map((s) => resolveCompany(s)?.id).filter((x): x is string => Boolean(x));
  return ids.length ? [...new Set(ids)].slice(0, 6) : DEFAULT_WATCH;
}

/* ---------------- Router ---------------- */

export function marketRouter(): Router {
  const r = express.Router();

  r.get("/status", (_req, res) => {
    res.json({
      openai: Boolean(process.env.OPENAI_API_KEY),
      jupiterKey: hasJupiterKey(),
      pythKey: hasPythKey(),
      streetView: Boolean(process.env.GOOGLE_MAPS_API_KEY),
      /* Host only: providers like Alchemy/Helius put the API key in the path or query. */
      rpc: (() => { try { return new URL(RPC_URL).host; } catch { return "custom"; } })(),
      liveModel: process.env.OPENAI_LIVE_MODEL || "gpt-live-1",
      backendModel: process.env.OPENAI_BACKEND_MODEL || "gpt-5.6-terra",
    });
  });

  r.get("/overview", async (_req, res) => {
    try { res.json(await buildOverview()); }
    catch (e) { bad(res, 502, (e as Error).message); }
  });

  r.get("/private", async (_req, res) => {
    try { res.json(await buildPrivateMarkets()); }
    catch (e) { bad(res, 502, (e as Error).message); }
  });

  r.get("/company/:id", async (req: Request, res: Response) => {
    const co = COMPANY_BY_ID[String(req.params.id)] ?? resolveCompany(String(req.params.id));
    if (!co) return bad(res, 404, "Unknown company");
    try {
      const all = await assetsFor(co.id);
      const asset = all.find((a) => a.primary) ?? all[0];
      /* Issuer calls resolve to null on failure, so they never fail the panel. */
      const [price, xca, reserves] = await Promise.all([priceSnapshot(co, asset), corporateActions(co.tokenSymbol), proofOfReserves(co.tokenSymbol)]);
      /* A company can be wrapped by more than one issuer (SpaceX: Backed and
       * Tessera). Price each separately — they are different instruments with
       * different backing, and their prices routinely diverge. */
      const wrappers = await Promise.all(all.map(async (a) => ({
        asset: a,
        price: a.id === asset?.id ? price : await priceSnapshot(co, a),
        capability: capabilityFor(a),
        ...disclosureFor(a),
        attestation: a.issuerKey === "tessera" ? tesseraProofOfReserve(tesseraSymbolFor(a)) : null,
      })));
      res.json({
        company: co, asset: asset ?? null, price,
        corporateActions: classifyCorporateActions(co.id, xca, price.rebase),
        reserves,
        capability: asset ? capabilityFor(asset) : null,
        ...disclosureFor(asset),
        wrappers,
      });
    } catch (e) { bad(res, 502, (e as Error).message); }
  });

  /* GET /session → MarketSessionInfo { usRegularOpen, sessionLabel, nextRegularOpenAt, solanaOpen: true, xstocksPeriod, asOf }.
   * Reference symbol NVDA: every US xStock shares the NYSE/Nasdaq calendar. */
  r.get("/session", async (_req, res) => {
    try { res.json(await sessionInfo(SESSION_REF)); }
    catch (e) { bad(res, 502, (e as Error).message); }
  });

  /* GET /briefing?watch=nvidia,sp500,tesla → Briefing (mode "watchlist"; default NVDAx, SPYx, TSLAx)
   * GET /briefing/:wallet[?watch=…]      → Briefing (mode "wallet", or "watchlist" when it holds no xStocks)
   * Stateless: anchored to the last 4pm close, no orders (those need the wallet's Jupiter JWT), cached 60 s. */
  r.get("/briefing", async (req, res) => {
    try { res.json(await briefingCached(null, watchFrom(req.query.watch))); }
    catch (e) { bad(res, 502, (e as Error).message); }
  });

  r.get("/briefing/:wallet", async (req, res) => {
    const wallet = String(req.params.wallet);
    try { new PublicKey(wallet); } catch { return bad(res, 400, "That doesn't look like a Solana wallet address."); }
    try { res.json(await briefingCached(wallet, watchFrom(req.query.watch))); }
    catch (e) { bad(res, 502, (e as Error).message); }
  });

  r.get("/prices", async (req, res) => {
    /* Batch snapshot for markers: ?ids=nvidia,apple */
    const ids = String(req.query.ids ?? "").split(",").filter(Boolean);
    try {
      const assets = await listTokenizedAssets();
      const wanted = ids.length ? ids : assets.map((a) => a.companyId);
      const mints = wanted.map((id) => assets.find((a) => a.companyId === id)?.mint).filter(Boolean) as string[];
      const prices = await getPrices(mints);
      const out: Record<string, { tokenPriceUsd: number | null; underlyingPriceUsd: number | null; change24hPct: number | null; updatedAt: string }> = {};
      for (const id of wanted) {
        const a = assets.find((x) => x.companyId === id);
        const p = a ? prices[a.mint] : undefined;
        out[id] = { tokenPriceUsd: p?.usdPrice ?? null, underlyingPriceUsd: p?.stockData?.price ?? null, change24hPct: p?.priceChange24h ?? null, updatedAt: new Date().toISOString() };
      }
      res.json(out);
    } catch (e) { bad(res, 502, (e as Error).message); }
  });

  r.get("/history/:id", async (req, res) => {
    const co = COMPANY_BY_ID[String(req.params.id)] ?? resolveCompany(String(req.params.id));
    if (!co) return bad(res, 404, "Unknown company");
    const range = (String(req.query.range ?? "1M").toUpperCase() as ChartRange);
    try { res.json(await history(co.id, range)); }
    catch (e) { bad(res, 502, (e as Error).message); }
  });

  r.get("/portfolio/:wallet", async (req, res) => {
    try { res.json(await readPortfolio(String(req.params.wallet))); }
    catch (e) { bad(res, 400, (e as Error).message); }
  });

  /* POST /eligibility { company, action?: "buy"|"sell"|"trigger", amountUsd? }
   *   → { company, asset|null, result: EligibilityResult } */
  r.post("/eligibility", async (req, res) => {
    const { company, action, amountUsd } = req.body ?? {};
    const co = resolveCompany(String(company ?? ""));
    if (!co) return bad(res, 404, "Unknown company");
    const act = action === "sell" || action === "trigger" ? action : "buy";
    const usd = amountUsd == null || amountUsd === "" ? undefined : Number(amountUsd);
    const asset = await assetFor(co.id);
    res.json({ company: co, asset: asset ?? null, result: checkEligibility(asset, act, Number.isFinite(usd) ? usd : undefined) });
  });

  /* POST /quote { company, side: "buy"|"sell", amount (USDC for buys, UI tokens for sells), taker }
   *   → 200 { quote: TradeQuote, eligibility, asset } | 403 { error: reasons, eligibility } | 4xx/502 { error: one sentence } */
  r.post("/quote", async (req, res) => {
    const { company, side, amount, taker } = req.body ?? {};
    const co = resolveCompany(String(company ?? ""));
    if (!co) return bad(res, 404, "Unknown company");
    if (!taker) return bad(res, 400, "Sign in first so Rhea knows which wallet is trading.");
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) return bad(res, 400, "Amount must be positive.");
    const s = side === "sell" ? "sell" : "buy";
    try {
      const asset = await assetFor(co.id);
      const elig = checkEligibility(asset, s, s === "buy" ? amt : undefined);
      if (!asset || !elig.allowed) return res.status(403).json({ error: elig.reasons.join(" ") || "Not eligible", eligibility: elig });
      const quote = await getSwapQuote({ side: s, companyId: co.id, asset, amountUi: amt, taker: String(taker) });
      res.json({ quote, eligibility: elig, asset });
    } catch (e) { fail(res, e); }
  });

  /* POST /execute { signedTransaction, requestId } → Jupiter's result; on status "Failed", `error` is one sentence. */
  r.post("/execute", async (req, res) => {
    const { signedTransaction, requestId } = req.body ?? {};
    if (!signedTransaction || !requestId) return bad(res, 400, "The signed transaction is missing, so get a fresh quote and try again.");
    try {
      const { raw, ...out } = await executeSwap(String(signedTransaction), String(requestId));
      res.json(IS_PROD || !raw ? out : { ...out, debug: raw });
    } catch (e) { fail(res, e); }
  });

  /* ---------------- Trigger V2 proxy (limit orders) ----------------
   * The browser never sees the Jupiter key. Every call is POST /api/market/trigger/:step
   * with a JSON body; steps after verify send the 24 h JWT as header `x-trigger-jwt`.
   * Orders are held by Jupiter, not Rhea: deposits sit in the user's Jupiter order
   * vault (Privy-managed, one per wallet). Shapes per developers.jup.ag/docs/trigger/*.
   * Amounts are RAW base units (xStocks: uiToRawAmount(ui, decimals, effectiveUiMultiplier(asset.scaledUi))).
   *
   *  challenge       body { walletPubkey, type: "message" | "transaction" }
   *                  → { type: "message", challenge } | { type: "transaction", transaction }   (expires in 5 min)
   *  verify          body { type: "message", walletPubkey, signature: bs58(signMessage(challenge)) }
   *                     | { type: "transaction", walletPubkey, signedTransaction: base64 }
   *                  → { token }   (JWT, 24 h, no refresh: cache it per wallet in memory)
   *  vault           body {} → { userPubkey, vaultPubkey, privyVaultId }   (GET /vault, registers on 404)
   *  deposit         body { inputMint, outputMint, userAddress, amount: raw string, orderType: "price", orderSubType: "single" }
   *                  → { transaction: base64 unsigned, requestId, receiverAddress, mint, amount, tokenDecimals, inputTokenAccount }
   *                  Worth >= $10 or Jupiter answers 400. Transfer-hook input mints are rejected unless
   *                  Jupiter whitelists them (NVDAx has a hook, so sell-side deposits may fail).
   *                  Rhea also runs checkEligibility("trigger") here (liquidity floor).
   *  order           body { orderType: "single", depositRequestId, depositSignedTx: base64, userPubkey, inputMint, outputMint,
   *                         inputAmount: raw string, triggerMint, triggerCondition: "above" | "below", triggerPriceUsd: number,
   *                         slippageBps?: number, expiresAt: ms epoch (required, future) }
   *                  → { id, txSignature (deposit), depositConfirmed }
   *  cancel          body { orderId } → POST /orders/price/cancel/{orderId}
   *                  → { id, transaction: base64 unsigned withdrawal, requestId }   (order stops filling immediately)
   *  confirm-cancel  body { orderId, signedTransaction: base64 signed withdrawal, cancelRequestId: cancel's requestId }
   *                  → { id, txSignature }   (retry with the same cancelRequestId if it doesn't land;
   *                  the same two steps withdraw an expired order's funds)
   *  history         body { state?: "active" | "past", mint?, limit?: 1-100 (20), offset? (0), sort?: "updated_at" | "created_at" | "expires_at", dir?: "asc" | "desc" }
   *                  → { orders: [{ id, orderType, orderState, rawState, userPubkey, privyWalletPubkey, inputMint, initialInputAmount,
   *                      remainingInputAmount, outputMint, triggerMint, triggerCondition, triggerPriceUsd, slippageBps, expiresAt,
   *                      createdAt, updatedAt, events: [{ type, timestamp, state, txSignature?, mint?, amount? }],
   *                      triggeredAt?, outputAmount?, inputUsed?, fillPercent? }], pagination: { total, limit, offset } }
   *                  orderState: pending | open | executing | filled | pending_withdraw | cancelled | expired | failed
   *
   * Errors: { error: one sentence } with Jupiter's status for 400/401/403/404/409/429 (401 = JWT expired, re-run challenge),
   * 502 otherwise, 501 { error, simulated: true } without JUPITER_API_KEY. */
  const ORDER_ID = /^[A-Za-z0-9_-]{1,128}$/;
  const HISTORY_PARAMS: Record<string, RegExp> = {
    state: /^(active|past)$/, mint: /^[1-9A-HJ-NP-Za-km-z]{32,44}$/, limit: /^\d{1,3}$/, offset: /^\d{1,7}$/,
    sort: /^(updated_at|created_at|expires_at)$/, dir: /^(asc|desc)$/,
  };

  r.post("/trigger/:step", async (req, res) => {
    const step = String(req.params.step);
    const jwt = typeof req.headers["x-trigger-jwt"] === "string" ? req.headers["x-trigger-jwt"] : undefined;
    const body = (req.body ?? {}) as Record<string, unknown>;
    if (!hasJupiterKey()) return res.status(501).json({ error: "Limit orders aren't switched on for this server yet.", simulated: true });
    if (!["challenge", "verify"].includes(step) && !jwt) return bad(res, 401, "Sign the Jupiter message first so your limit orders can be managed.");
    const orderId = String(body.orderId ?? "");
    try {
      switch (step) {
        case "challenge": return res.json(await triggerProxy("/auth/challenge", { body: { walletPubkey: body.walletPubkey, type: body.type ?? "message" } }));
        case "verify": return res.json(await triggerProxy("/auth/verify", { body }));
        case "vault": {
          /* Register only when Jupiter says there is no vault (404); a 401 must surface as re-auth. */
          try { return res.json(await triggerProxy("/vault", { jwt })); }
          catch (e) {
            if (!(e instanceof JupiterError) || e.status !== 404) throw e;
            return res.json(await triggerProxy("/vault/register", { jwt }));
          }
        }
        case "deposit": {
          const craft = body;
          const mint = [craft.inputMint, craft.outputMint].find((m) => typeof m === "string" && m !== USDC_MINT);
          const asset = (await listTokenizedAssets()).find((a) => a.mint === mint);
          if (asset) {
            const elig = checkEligibility(asset, "trigger");
            if (!elig.allowed) return res.status(403).json({ error: elig.reasons.join(" "), eligibility: elig });
          }
          return res.json(await triggerProxy("/deposit/craft", { body: craft, jwt }));
        }
        case "order": return res.json(await triggerProxy("/orders/price", { body, jwt }));
        case "cancel":
          if (!ORDER_ID.test(orderId)) return bad(res, 400, "That order id doesn't look right.");
          return res.json(await triggerProxy(`/orders/price/cancel/${orderId}`, { method: "POST", jwt }));
        case "confirm-cancel":
          if (!ORDER_ID.test(orderId)) return bad(res, 400, "That order id doesn't look right.");
          if (!body.signedTransaction || !body.cancelRequestId) return bad(res, 400, "Sign the withdrawal transaction first, then confirm the cancel.");
          return res.json(await triggerProxy(`/orders/price/confirm-cancel/${orderId}`, {
            body: { signedTransaction: body.signedTransaction, cancelRequestId: body.cancelRequestId }, jwt,
          }));
        case "history": {
          const qs = new URLSearchParams();
          for (const [k, re] of Object.entries(HISTORY_PARAMS)) {
            const v = body[k];
            if (v != null && re.test(String(v))) qs.set(k, String(v));
          }
          const q = qs.toString();
          return res.json(await triggerProxy(`/orders/history${q ? `?${q}` : ""}`, { jwt }));
        }
        default: return bad(res, 404, "Unknown trigger step");
      }
    } catch (e) { fail(res, e); }
  });

  /* Street View Static (spec §4). Key stays server-side; the image is proxied. */
  r.get("/streetview/:id", async (req, res) => {
    const co = COMPANY_BY_ID[String(req.params.id)];
    if (!co?.headquarters) return bad(res, 404, "No headquarters location");
    const key = process.env.GOOGLE_MAPS_API_KEY;
    if (!key) return res.status(501).json({ error: "GOOGLE_MAPS_API_KEY not configured" });
    const { lat, lng } = co.headquarters;
    try {
      const meta = await (await fetch(`https://maps.googleapis.com/maps/api/streetview/metadata?location=${lat},${lng}&radius=250&key=${key}`)).json() as { status: string };
      if (meta.status !== "OK") return res.status(404).json({ error: "No Street View imagery here", status: meta.status });
      const img = await fetch(`https://maps.googleapis.com/maps/api/streetview?size=640x400&location=${lat},${lng}&radius=250&fov=90&key=${key}`);
      res.setHeader("Content-Type", img.headers.get("content-type") ?? "image/jpeg");
      res.setHeader("Cache-Control", "no-store");
      res.send(Buffer.from(await img.arrayBuffer()));
    } catch (e) { bad(res, 502, (e as Error).message); }
  });

  return r;
}
