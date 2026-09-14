/* Market, portfolio, compliance and trading routes. */
import type { Request, Response, Router } from "express";
import express from "express";
import { Connection, PublicKey } from "@solana/web3.js";
import {
  COMPANIES, COMPANY_BY_ID, COUNTRIES, MIN_TRADABLE_LIQUIDITY_USD, USDC_MINT,
  XSTOCKS_DISCLOSURE_URL, XSTOCKS_MIN_TRADE_USD, XSTOCKS_RESTRICTED_JURISDICTIONS, resolveCompany,
} from "../shared/registry";
import type {
  AssetCapability, ChartRange, CorporateAction, CountrySummary, EligibilityResult, MarketOverview, Portfolio, Position, TokenizedAsset,
} from "../shared/types";
import { hasPythKey, history, priceSnapshot } from "./feeds";
import { executeSwap, getPrices, getSwapQuote, hasJupiterKey, listTokenizedAssets, triggerProxy, type JupPrice } from "./jupiter";

const RPC_URL = process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";
const TOKEN_PROGRAM = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const TOKEN_2022_PROGRAM = new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");

const conn = new Connection(RPC_URL, "confirmed");
const logoCache = new Map<string, { type: string; body: Buffer }>();

function bad(res: Response, status: number, message: string) {
  res.status(status).json({ error: message });
}

async function assetFor(companyId: string): Promise<TokenizedAsset | undefined> {
  const assets = await listTokenizedAssets();
  return assets.find((a) => a.companyId === companyId);
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

/* ---------------- Compliance (spec §15) ---------------- */

export function capabilityFor(asset: TokenizedAsset): AssetCapability {
  return {
    assetId: asset.id,
    issuer: asset.issuer,
    supportedJurisdictions: "all",
    restrictedJurisdictions: XSTOCKS_RESTRICTED_JURISDICTIONS,
    requiresKyc: false,
    tradable: asset.tradable,
    transferable: true,
    minimumTradeUsd: XSTOCKS_MIN_TRADE_USD,
    disclosureUrl: XSTOCKS_DISCLOSURE_URL,
  };
}

export function checkEligibility(asset: TokenizedAsset | undefined, action: "buy" | "sell" | "trigger", amountUsd?: number): EligibilityResult {
  const reasons: string[] = [];
  const disclosure = "xStocks are tokenized tracker certificates issued by Backed Finance. They are not available to residents of restricted jurisdictions (including the United States, Canada and the United Kingdom) and carry issuer, market and smart-contract risk. This is not investment advice. Availability shown here is illustrative and must be confirmed against the issuer's terms.";
  if (!asset) return { allowed: false, reasons: ["This company has no tokenized asset on Solana yet."], disclosure, disclosureUrl: XSTOCKS_DISCLOSURE_URL };
  const cap = capabilityFor(asset);
  if (!cap.tradable && action !== "sell") reasons.push(`${asset.symbol} is listed but has too little onchain liquidity to trade (under $${MIN_TRADABLE_LIQUIDITY_USD}).`);
  if (action === "buy" && amountUsd != null && amountUsd < cap.minimumTradeUsd) reasons.push(`Minimum trade is $${cap.minimumTradeUsd}.`);
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

/* ---------------- Corporate actions from xStocks rebasing ---------------- */

function corporateActionsFrom(companyId: string, rebase: { multiplier: number; newMultiplier?: number; newMultiplierEffectiveAt?: string } | undefined): CorporateAction[] {
  if (!rebase) return [];
  const out: CorporateAction[] = [];
  if (rebase.newMultiplier && rebase.newMultiplier !== rebase.multiplier && rebase.newMultiplierEffectiveAt) {
    const up = rebase.newMultiplier > rebase.multiplier;
    out.push({
      id: `${companyId}:rebase:${rebase.newMultiplierEffectiveAt}`,
      companyId,
      type: "rebase",
      effectiveAt: rebase.newMultiplierEffectiveAt,
      source: "xStocks scaled-UI multiplier (onchain)",
      detail: up
        ? `Balance multiplier rises from ${rebase.multiplier.toFixed(6)} to ${rebase.newMultiplier.toFixed(6)} — the issuer reflects a distribution (e.g. dividend) by increasing displayed token balances.`
        : `Balance multiplier changes from ${rebase.multiplier.toFixed(6)} to ${rebase.newMultiplier.toFixed(6)}.`,
      previousMultiplier: rebase.multiplier,
      newMultiplier: rebase.newMultiplier,
    });
  }
  return out;
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

  r.get("/company/:id", async (req: Request, res: Response) => {
    const co = COMPANY_BY_ID[String(req.params.id)] ?? resolveCompany(String(req.params.id));
    if (!co) return bad(res, 404, "Unknown company");
    try {
      const asset = await assetFor(co.id);
      const price = await priceSnapshot(co, asset);
      res.json({ company: co, asset: asset ?? null, price, corporateActions: corporateActionsFrom(co.id, price.rebase), capability: asset ? capabilityFor(asset) : null });
    } catch (e) { bad(res, 502, (e as Error).message); }
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

  r.post("/eligibility", async (req, res) => {
    const { company, action, amountUsd } = req.body ?? {};
    const co = resolveCompany(String(company ?? ""));
    if (!co) return bad(res, 404, "Unknown company");
    const asset = await assetFor(co.id);
    res.json({ company: co, asset: asset ?? null, result: checkEligibility(asset, action ?? "buy", amountUsd) });
  });

  r.post("/quote", async (req, res) => {
    const { company, side, amount, taker } = req.body ?? {};
    const co = resolveCompany(String(company ?? ""));
    if (!co) return bad(res, 404, "Unknown company");
    if (!taker) return bad(res, 400, "Wallet (taker) required");
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) return bad(res, 400, "Amount must be positive");
    try {
      const asset = await assetFor(co.id);
      const elig = checkEligibility(asset, side === "sell" ? "sell" : "buy", side === "buy" ? amt : undefined);
      if (!asset || !elig.allowed) return res.status(403).json({ error: "Not eligible", eligibility: elig });
      const quote = await getSwapQuote({ side: side === "sell" ? "sell" : "buy", companyId: co.id, asset, amountUi: amt, taker });
      res.json({ quote, eligibility: elig, asset });
    } catch (e) { bad(res, 502, (e as Error).message); }
  });

  r.post("/execute", async (req, res) => {
    const { signedTransaction, requestId } = req.body ?? {};
    if (!signedTransaction || !requestId) return bad(res, 400, "signedTransaction and requestId required");
    try { res.json(await executeSwap(String(signedTransaction), String(requestId))); }
    catch (e) { bad(res, 502, (e as Error).message); }
  });

  /* Trigger V2 proxy — the browser never sees the Jupiter key. */
  r.post("/trigger/:step", async (req, res) => {
    const step = String(req.params.step);
    const jwt = typeof req.headers["x-trigger-jwt"] === "string" ? req.headers["x-trigger-jwt"] : undefined;
    if (!hasJupiterKey()) return res.status(501).json({ error: "JUPITER_API_KEY not configured", simulated: true });
    try {
      switch (step) {
        case "challenge": return res.json(await triggerProxy("/auth/challenge", { body: req.body }));
        case "verify": return res.json(await triggerProxy("/auth/verify", { body: req.body }));
        case "vault": {
          try { return res.json(await triggerProxy("/vault", { jwt })); }
          catch { return res.json(await triggerProxy("/vault/register", { jwt })); }
        }
        case "deposit": return res.json(await triggerProxy("/deposit/craft", { body: req.body, jwt }));
        case "order": return res.json(await triggerProxy("/orders/price", { body: req.body, jwt }));
        case "cancel": return res.json(await triggerProxy(`/orders/${encodeURIComponent(String(req.body?.orderId ?? ""))}/cancel`, { method: "POST", body: {}, jwt }));
        case "history": return res.json(await triggerProxy(`/orders?userPubkey=${encodeURIComponent(String(req.body?.userPubkey ?? ""))}`, { jwt }));
        default: return bad(res, 404, "Unknown trigger step");
      }
    } catch (e) { bad(res, 502, (e as Error).message); }
  });

  /* Street View Static (spec §4). Key stays server-side; the image is proxied. */
  /* Company logo, re-served with CORS so the globe can use it as a WebGL
   * texture (the issuer's CDN sends no Access-Control-Allow-Origin). Only
   * catalog icons are fetched, so this is not an open proxy. */
  r.get("/logo/:id", async (req, res) => {
    const co = COMPANY_BY_ID[String(req.params.id)];
    const url = co?.icon;
    if (!url || !url.startsWith("https://xstocks-metadata.backed.fi/")) return bad(res, 404, "No logo");
    try {
      let hit = logoCache.get(url);
      if (!hit) {
        const img = await fetch(url);
        if (!img.ok) return bad(res, 404, "Logo unavailable");
        hit = { type: img.headers.get("content-type") ?? "image/png", body: Buffer.from(await img.arrayBuffer()) };
        if (logoCache.size > 400) logoCache.clear();
        logoCache.set(url, hit);
      }
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
      res.setHeader("Content-Type", hit.type);
      res.setHeader("Cache-Control", "public, max-age=86400");
      res.send(hit.body);
    } catch (e) { bad(res, 502, (e as Error).message); }
  });

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
