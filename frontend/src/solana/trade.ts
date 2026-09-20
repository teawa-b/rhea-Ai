/* Trade preparation + execution (spec §11) and conditional orders (§12).
 *
 * prepare*: compliance → live Jupiter quote → TradeIntent awaiting confirmation
 * confirm*: Privy signs the unsigned transaction → Jupiter executes/lands it
 *
 * Trigger orders use Jupiter Trigger V2 (auth challenge → vault → deposit →
 * order) when the server has a Jupiter key. Without one, dev builds keep the
 * rule locally (marked simulated) so the flow can be exercised; production
 * builds refuse instead, so a user never mistakes a local rule for a live order.
 * Orders are held by Jupiter, not Rhea: the order list is read back from Jupiter's
 * history (syncOrders) and cancels are Jupiter's two-step signed withdrawal.
 */
import { COMPANIES, COMPANY_BY_ID, USDC_MINT, effectiveUiMultiplier, rawToUiAmount, resolveCompany, uiToRawAmount } from "@shared/registry";
import type { AgentRule, TradeIntent, TradeQuote, TradeSide } from "@shared/types";
import type { RheaAuth } from "@/auth/Auth";
import { api, type JupiterOrder } from "@/market/api";
import { DEMO_READ_ONLY, assetForCompany, useMarket, type PendingIntent } from "@/state/market";
import { fmtFeeUsd, fmtSeconds, sessionLabel, shortSig } from "@/theme";

const b64ToBytes = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
const bytesToB64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const uid = (p: string) => `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;

export type PrepareResult = { ok: true; intent: TradeIntent } | { ok: false; error: string; reasons?: string[] };

/** True when a prepare* call stopped at a sign-in / funding gate: the matching
 * panel is already showing, so the UI should not also toast the error text. */
export const isGated = (r: { ok: boolean; reasons?: string[] }) => !r.ok && Boolean(r.reasons?.some((x) => x === "not_authenticated" || x === "insufficient_usdc"));

/* Sign-in / funding gates. Instead of failing quietly they open the matching
 * panel (login or deposit) and remember what the user wanted, so the trade
 * resumes by itself once they've signed in or topped up (see resumeIntent). */
const SIGN_IN_MSG = "The user is not signed in. A sign-in panel is now showing: ask them to sign in there (Google, email or a wallet — it creates a Solana wallet for them); the trade will continue automatically afterwards.";

type Gate = { ok: false; error: string; reasons?: string[] };
/* ?demo=1 is read-only: a trade request opens the sign-in panel instead of quoting. Signing in ends demo mode
 * and IntentResumer re-runs the request on the user's own wallet. Checked before the sign-in gate so the
 * reason names the demo. */
function refuseDemo(resume: PendingIntent): Gate | null {
  const m = useMarket.getState();
  if (!m.demoMode) return null;
  m.setLoginPrompt({ reason: DEMO_READ_ONLY, resume });
  return { ok: false, error: `${DEMO_READ_ONLY}. A sign-in panel is now showing: if they want to trade, ask them to sign in there; the request continues on their own wallet afterwards.`, reasons: ["demo_read_only", "not_authenticated"] };
}

function requireSignIn(auth: RheaAuth, reason: string, resume: PendingIntent): Gate | null {
  if (auth.authenticated && auth.address) return null;
  useMarket.getState().setLoginPrompt({ reason, resume });
  return { ok: false, error: SIGN_IN_MSG, reasons: ["not_authenticated"] };
}

async function requireUsdc(neededUsd: number, resume: PendingIntent): Promise<Gate | null> {
  const m = useMarket.getState();
  const p = m.portfolio ?? (await m.loadPortfolio());
  if (!p) return null; // can't tell — let the quote decide
  if (p.usdcBalance >= neededUsd) return null;
  m.setDepositPrompt({ neededUsd, haveUsd: p.usdcBalance, resume });
  return { ok: false, error: `The wallet holds $${p.usdcBalance.toFixed(2)} USDC but this needs $${neededUsd.toFixed(2)}. A deposit panel showing the wallet address is now open: ask the user to send USDC on Solana to it; the trade will continue automatically once it arrives.`, reasons: ["insufficient_usdc"] };
}

export async function prepareTrade(auth: RheaAuth, companyQuery: string, side: TradeSide, amount: number): Promise<PrepareResult> {
  const co = resolveCompany(companyQuery);
  if (!co) return { ok: false, error: `Unknown company "${companyQuery}"` };
  const m = useMarket.getState();
  if (!Number.isFinite(amount) || amount <= 0) return { ok: false, error: "Amount must be positive." };
  /* "Sell it all" is asked for in round numbers — the panel's own button, or a
   * figure the model read off a rounded balance — and the swap floors to whole
   * base units. Anything within half a percent of the position is snapped back
   * to the exact chain balance, so the sale doesn't leave a speck of dust
   * behind that still counts as a holding (and still builds a shop on the
   * holdings planet). */
  const held = side === "sell" ? m.portfolio?.positions.find((p) => p.companyId === co.id)?.amountUi : undefined;
  if (held != null && amount >= held * 0.995) amount = held;
  const resume: PendingIntent = { kind: side, companyId: co.id, amount };
  const gate = refuseDemo(resume) ?? requireSignIn(auth, side === "buy" ? `Sign in to buy $${amount} of ${co.name}` : `Sign in to sell ${co.name}`, resume);
  if (gate) return gate;
  if (side === "buy") { const funds = await requireUsdc(amount, resume); if (funds) return funds; }
  const address = auth.address!;

  try {
    const { quote, asset } = await api.quote(co.id, side, amount, address);
    const intent: TradeIntent = {
      id: uid("trade"),
      userId: address,
      assetId: asset.id,
      companyId: co.id,
      side,
      amount,
      currency: side === "buy" ? "USDC" : asset.symbol,
      status: "awaiting_confirmation",
      quote,
      createdAt: new Date().toISOString(),
    };
    m.setPendingTrade(intent);
    m.recordTrade(intent);
    return { ok: true, intent };
  } catch (e) {
    const err = e as Error & { eligibility?: { reasons: string[] } };
    return { ok: false, error: err.eligibility?.reasons.join(" ") || err.message, reasons: err.eligibility?.reasons };
  }
}

export async function confirmTrade(auth: RheaAuth, intent: TradeIntent): Promise<TradeIntent> {
  const m = useMarket.getState();
  const q = intent.quote;
  if (!q) throw new Error("No quote on this trade");
  if (m.demoMode) throw new Error(DEMO_READ_ONLY);
  if (!auth.address) throw new Error("Sign in to trade.");
  /* Quotes go stale quickly; refresh if older than 45 s. */
  let quote = q;
  if (Date.now() - Date.parse(q.quotedAt) > 45_000) {
    const fresh = await api.quote(intent.companyId, intent.side, intent.amount, auth.address);
    quote = fresh.quote;
  }
  const submitted: TradeIntent = { ...intent, quote, status: "submitted" };
  m.setPendingTrade(submitted); m.recordTrade(submitted);
  /* The receipt's session label wants a fresh session flag (loadDetail reuses one under 15 s old);
   * fetch it alongside signing so it never delays the confirmed state. */
  const detail = m.loadDetail(intent.companyId);
  try {
    const signed = await auth.signTransaction(b64ToBytes(quote.transaction));
    /* Receipt time runs from handing Jupiter the signed tx to its Success answer. The Privy approval
     * before this is human time, so it is deliberately left out of "Confirmed in 1.2s". */
    const t0 = performance.now();
    const res = await api.execute(bytesToB64(signed), quote.requestId);
    const confirmMs = Math.round(performance.now() - t0);
    if (res.status !== "Success" || !res.signature) throw new Error(res.error || `Swap ${res.status ?? "failed"}${res.code ? ` (code ${res.code})` : ""}`);
    const confirmedAt = new Date().toISOString();
    const session = (await detail.catch(() => null))?.price.marketSession;
    const done: TradeIntent = { ...submitted, status: "confirmed", signature: res.signature, confirmMs, confirmedAt, sessionLabel: sessionLabel(session, confirmedAt) };
    m.setPendingTrade(done); m.recordTrade(done);
    void m.loadPortfolio();
    return done;
  } catch (e) {
    const failed: TradeIntent = { ...submitted, status: "failed", error: (e as Error).message };
    m.setPendingTrade(failed); m.recordTrade(failed);
    throw e;
  }
}

/* ---------------- Conditional orders ---------------- */

export type TriggerKind = "buy_below" | "sell_above";

/** Jupiter Trigger V2 rejects orders worth less than this (USD). */
export const TRIGGER_MIN_USD = 10;
const TRIGGER_UNAVAILABLE = "Limit orders aren't available right now.";

/* xStocks are Token-2022 scaled-UI tokens: UI amount = raw × multiplier / 10^decimals.
 * The multiplier moves with dividends, so read it from the live company detail.
 * As in the ScaledUiAmount extension, newMultiplier replaces multiplier once its
 * effective time has passed; the stored field isn't rewritten (NVDAx mint on 15 Sep:
 * multiplier 1.00092, newMultiplier 1.00170 effective 10 Sep, so 1.00170 applies). */
async function uiMultiplier(companyId: string): Promise<number> {
  const m = useMarket.getState();
  const r = (m.details[companyId] ?? (await m.loadDetail(companyId)))?.price.rebase;
  /* The catalog's scaledUi is the fallback when the detail can't load; 1 only if neither is known. */
  return effectiveUiMultiplier(r ?? assetForCompany(companyId)?.scaledUi);
}

export async function prepareTrigger(auth: RheaAuth, companyQuery: string, kind: TriggerKind, triggerPriceUsd: number, amount: number, expiresInDays = 30): Promise<{ ok: true; rule: AgentRule } | { ok: false; error: string }> {
  const co = resolveCompany(companyQuery);
  if (!co) return { ok: false, error: `Unknown company "${companyQuery}"` };
  const asset = assetForCompany(co.id);
  if (!asset) return { ok: false, error: `${co.name} has no tokenized asset yet.` };
  const m = useMarket.getState();
  if (!(triggerPriceUsd > 0) || !(amount > 0)) return { ok: false, error: "Price and amount must be positive." };
  /* Check Jupiter's minimum before any sign-in/deposit gate so the user isn't
   * walked through funding an order that would be rejected anyway. Sells are
   * valued at the live token price (per UI token), else at the trigger price. */
  let orderUsd = amount;
  if (kind === "buy_below" && amount < TRIGGER_MIN_USD) return { ok: false, error: `Jupiter limit orders need at least $${TRIGGER_MIN_USD}.` };
  if (kind === "sell_above") {
    const px = m.details[co.id]?.price.tokenPriceUsd ?? m.prices[co.id]?.tokenPriceUsd ?? (await m.loadDetail(co.id))?.price.tokenPriceUsd ?? triggerPriceUsd;
    orderUsd = amount * px;
    if (orderUsd < TRIGGER_MIN_USD) return { ok: false, error: `Jupiter limit orders need at least $${TRIGGER_MIN_USD}; ${amount} ${asset.symbol} is worth about $${orderUsd.toFixed(2)}.` };
  }
  const resume: PendingIntent = { kind: "trigger", companyId: co.id, triggerKind: kind, priceUsd: triggerPriceUsd, amount, expiresInDays };
  const gate = refuseDemo(resume) ?? requireSignIn(auth, `Sign in to set a ${kind === "buy_below" ? "buy" : "sell"} order on ${co.name}`, resume);
  if (gate) return { ok: false, error: gate.error };
  if (kind === "buy_below" && amount > 0) { const funds = await requireUsdc(amount, resume); if (funds) return { ok: false, error: funds.error }; }
  const address = auth.address!;
  /* amountUsd lets the server apply the same $10 Jupiter minimum and the liquidity floor. */
  const elig = await api.eligibility(co.id, "trigger", orderUsd);
  if (!elig.result.allowed) return { ok: false, error: elig.result.reasons.join(" ") };
  /* Status loads asynchronously at boot; deciding from a null status would
   * silently turn a real order into a local one. */
  const status = useMarket.getState().status ?? (await m.loadStatus());
  const simulated = !status?.jupiterKey;
  if (simulated && import.meta.env.PROD) return { ok: false, error: TRIGGER_UNAVAILABLE };

  const rule: AgentRule = {
    id: uid("rule"),
    userId: address,
    assetId: asset.id,
    companyId: co.id,
    type: "price_trigger",
    condition: { kind: kind === "buy_below" ? "price_below" : "price_above", priceUsd: triggerPriceUsd, triggerMint: asset.mint },
    action: { side: kind === "buy_below" ? "buy" : "sell", amount, currency: kind === "buy_below" ? "USDC" : asset.symbol },
    status: "pending",
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + expiresInDays * 86400_000).toISOString(),
    simulated,
  };
  m.setPendingOrder(rule);
  return { ok: true, rule };
}

/* ---------------- Trigger JWT (24 h, cached per wallet) ----------------
 * Jupiter scopes order history, cancel and create to a JWT issued for one wallet after it signs a
 * challenge. Caching it means one signature a day instead of one per sync or cancel. It is a bearer
 * token for managing (not moving) that wallet's orders: withdrawals still need a wallet signature. */
const LS_JWT = "rhea.triggerJwt.v1";
const JWT_TTL_MS = 24 * 3600_000;
/* Renewed 15 min early so a token never lapses between reading it and Jupiter checking it. */
const JWT_MARGIN_MS = 15 * 60_000;
type CachedJwt = { wallet: string; token: string; expiresAt: number };

/** `exp` from the JWT payload, if it has one (the docs only promise 24 h). */
function jwtExpiryMs(token: string): number | null {
  try {
    const part = token.split(".")[1];
    if (!part) return null;
    const b64 = part.replace(/-/g, "+").replace(/_/g, "/");
    const exp = (JSON.parse(atob(b64.padEnd(Math.ceil(b64.length / 4) * 4, "="))) as { exp?: unknown }).exp;
    return typeof exp === "number" && Number.isFinite(exp) ? exp * 1000 : null;
  } catch { return null; }
}
function readJwt(wallet: string | null | undefined): string | null {
  if (!wallet) return null;
  try {
    const c = JSON.parse(localStorage.getItem(LS_JWT) ?? "null") as CachedJwt | null;
    return c && c.wallet === wallet && typeof c.token === "string" && c.expiresAt - JWT_MARGIN_MS > Date.now() ? c.token : null;
  } catch { return null; }
}
function clearJwt() { try { localStorage.removeItem(LS_JWT); } catch { /* ignore */ } }
/** True when live order status can be read for this wallet without a signature prompt. */
export const hasTriggerToken = (wallet: string | null | undefined) => readJwt(wallet) != null;

const jwtInFlight = new Map<string, Promise<string>>();
/** A valid Trigger JWT for the signed-in wallet: the cached one, else challenge → signMessage → verify. */
export function getTriggerToken(auth: RheaAuth): Promise<string> {
  const wallet = auth.address;
  if (!wallet) return Promise.reject(new Error("Sign in first so Rhea knows which wallet's orders to manage."));
  const cached = readJwt(wallet);
  if (cached) return Promise.resolve(cached);
  /* A sync and a cancel racing each other share one signature prompt. */
  const running = jwtInFlight.get(wallet);
  if (running) return running;
  const p = (async () => {
    const ch = await api.trigger("challenge", { walletPubkey: wallet, type: "message" });
    if (typeof ch.challenge !== "string" || !ch.challenge) throw new Error("Jupiter didn't send a sign-in message for limit orders, so nothing was signed. Try again in a moment.");
    const sig = await auth.signMessage(new TextEncoder().encode(ch.challenge));
    const { default: bs58 } = await import("bs58");
    const v = await api.trigger("verify", { type: "message", walletPubkey: wallet, signature: bs58.encode(sig) });
    if (typeof v.token !== "string" || !v.token) throw new Error("Jupiter didn't accept the signature for limit orders. Try again.");
    const now = Date.now();
    const exp = jwtExpiryMs(v.token);
    const cache: CachedJwt = { wallet, token: v.token, expiresAt: Math.min(now + JWT_TTL_MS, exp != null && exp > now ? exp : Infinity) };
    try { localStorage.setItem(LS_JWT, JSON.stringify(cache)); } catch { /* ignore */ }
    return v.token;
  })().finally(() => jwtInFlight.delete(wallet));
  jwtInFlight.set(wallet, p);
  return p;
}

class NeedsSignature extends Error {
  constructor() { super("Live order status from Jupiter needs a quick wallet signature."); }
}
/** Runs one JWT call. A 401 means the token expired or was revoked: drop it and, if a prompt is
 * acceptable, sign again and retry once. Non-interactive callers get NeedsSignature instead. */
async function withTriggerJwt<T>(auth: RheaAuth | null, interactive: boolean, wallet: string, fn: (jwt: string) => Promise<T>): Promise<T> {
  const token = readJwt(wallet) ?? (interactive && auth?.address === wallet ? await getTriggerToken(auth) : null);
  if (!token) throw new NeedsSignature();
  try { return await fn(token); }
  catch (e) {
    if ((e as { status?: number }).status !== 401) throw e;
    clearJwt();
    if (!interactive || !auth || auth.address !== wallet) throw new NeedsSignature();
    return fn(await getTriggerToken(auth));
  }
}

const isB64Tx = (v: unknown): v is string => typeof v === "string" && v.length > 64 && /^[A-Za-z0-9+/]+={0,2}$/.test(v);

/** Walks Jupiter Trigger V2: JWT (cached, else challenge → sign → verify) → vault → deposit craft → sign → order. */
export async function confirmTrigger(auth: RheaAuth, rule: AgentRule): Promise<AgentRule> {
  const m = useMarket.getState();
  if (m.demoMode) throw new Error(DEMO_READ_ONLY);
  const owner = auth.address;
  if (!owner) throw new Error("Not signed in");
  const asset = assetForCompany(rule.companyId);
  if (!asset) throw new Error("Asset not found");

  if (rule.simulated) {
    /* A pending rule prepared before a deploy (or restored from storage) must
     * not slip through as a local-only order in production. */
    if (import.meta.env.PROD) throw new Error(TRIGGER_UNAVAILABLE);
    /* Dev without a Jupiter key: keep the rule locally (clearly labelled). */
    const active: AgentRule = { ...rule, userId: owner, status: "active" };
    m.upsertOrder(active); m.setPendingOrder(active);
    return active;
  }

  const isBuy = rule.action.side === "buy";
  const inputMint = isBuy ? USDC_MINT : asset.mint;
  const outputMint = isBuy ? asset.mint : USDC_MINT;
  /* USDC input is a plain SPL amount. xStock input is scaled-UI: raw = UI / multiplier;
   * floor so "sell all" never asks for one raw unit more than the wallet holds.
   * Worked out before the first signature so a bad amount never costs a prompt. */
  const inputAmount = isBuy ? uiToRawAmount(rule.action.amount, USDC_DECIMALS) : uiToRawAmount(rule.action.amount, asset.decimals, await uiMultiplier(rule.companyId));
  if (inputAmount === "0") throw new Error("Order amount is too small.");
  const call = <T,>(fn: (jwt: string) => Promise<T>) => withTriggerJwt(auth, true, owner, fn);

  await call((jwt) => api.trigger("vault", {}, jwt));
  const deposit = await call((jwt) => api.trigger("deposit", { inputMint, outputMint, userAddress: owner, amount: inputAmount, orderType: "price", orderSubType: "single" }, jwt));
  if (typeof deposit.requestId !== "string" || !isB64Tx(deposit.transaction)) throw new Error("Jupiter didn't return a deposit transaction, so nothing was signed. Try again in a moment.");
  const signedDeposit = await auth.signTransaction(b64ToBytes(deposit.transaction));

  const order = await call((jwt) => api.trigger("order", {
    orderType: "single",
    depositRequestId: deposit.requestId,
    depositSignedTx: bytesToB64(signedDeposit),
    userPubkey: owner,
    inputMint,
    outputMint,
    inputAmount,
    triggerMint: asset.mint,
    triggerCondition: rule.condition.kind === "price_below" ? "below" : "above",
    triggerPriceUsd: rule.condition.priceUsd,
    slippageBps: 100,
    expiresAt: Date.parse(rule.expiresAt ?? "") || Date.now() + 30 * 86400_000,
  }, jwt));
  /* Without an id the deposit may still have landed; a sync shows the order if Jupiter recorded it. */
  if (typeof order.id !== "string" || !order.id) {
    void syncOrders(auth);
    throw new Error("Jupiter didn't confirm the order. Check your orders before trying again, so you don't place it twice.");
  }

  const active: AgentRule = {
    ...rule, userId: owner, status: "active", jupiterOrderId: order.id, jupiterState: order.depositConfirmed === false ? "pending" : "open",
    txSignature: typeof order.txSignature === "string" ? order.txSignature : undefined,
  };
  m.upsertOrder(active); m.setPendingOrder(active);
  void syncOrders(auth);
  return active;
}

/* ---------------- Orders synced from Jupiter ----------------
 * Jupiter's order history is the source of truth; the store's per-wallet localStorage copy is only a cache. */

const USDC_DECIMALS = 6;
/** xStocks mints use 8 decimals; only needed for catalog names missing from the tradable overview. */
const XSTOCK_DECIMALS_FALLBACK = 8;

function tokenByMint(mint: string): { companyId: string; symbol: string; decimals: number; multiplier: number } | null {
  const m = useMarket.getState();
  const a = m.overview?.assets.find((x) => x.mint === mint);
  if (a) return { companyId: a.companyId, symbol: a.symbol, decimals: a.decimals, multiplier: effectiveUiMultiplier(m.details[a.companyId]?.price.rebase ?? a.scaledUi) };
  const co = COMPANIES.find((c) => c.seedMint === mint);
  return co ? { companyId: co.id, symbol: co.tokenSymbol, decimals: XSTOCK_DECIMALS_FALLBACK, multiplier: effectiveUiMultiplier(m.details[co.id]?.price.rebase) } : null;
}

/** Jupiter timestamps are ms epochs per the docs; seconds and ISO strings are accepted too. */
function toIso(v: unknown): string | undefined {
  const n = typeof v === "number" ? v : typeof v === "string" && /^\d+$/.test(v) ? Number(v) : NaN;
  if (Number.isFinite(n) && n > 0) return new Date(n < 1e12 ? n * 1000 : n).toISOString();
  const t = typeof v === "string" ? Date.parse(v) : NaN;
  return Number.isFinite(t) ? new Date(t).toISOString() : undefined;
}

const LIVE_STATES = new Set(["pending", "open", "executing"]);

/** One Jupiter history order → AgentRule, or null when it isn't a USDC ↔ xStock single order Rhea can show. */
function mapJupiterOrder(o: JupiterOrder, wallet: string, bucket: "active" | "past", syncedAt: string): AgentRule | null {
  if (!o || typeof o.id !== "string" || !o.id) return null;
  if (o.userPubkey && o.userPubkey !== wallet) return null;
  if (o.orderType && o.orderType !== "single") return null;
  const buy = o.inputMint === USDC_MINT;
  if (!buy && o.outputMint !== USDC_MINT) return null;
  const tokenMint = buy ? o.outputMint : o.inputMint;
  const token = typeof tokenMint === "string" ? tokenByMint(tokenMint) : null;
  const priceUsd = Number(o.triggerPriceUsd);
  const kind = o.triggerCondition === "below" ? "price_below" : o.triggerCondition === "above" ? "price_above" : null;
  const raw = String(o.initialInputAmount ?? "");
  if (!token || !kind || !(priceUsd > 0) || !/^\d+$/.test(raw)) return null;
  const amount = buy ? rawToUiAmount(raw, USDC_DECIMALS) : rawToUiAmount(raw, token.decimals, token.multiplier);

  const state = typeof o.orderState === "string" ? o.orderState : "";
  const events = Array.isArray(o.events) ? o.events : [];
  /* Latest tx of a type; an event explicitly marked failed doesn't count as a receipt. */
  const txOf = (type: string) => [...events].reverse().find((e) => e?.type === type && typeof e.txSignature === "string" && e.txSignature && !/fail/i.test(String(e.state ?? "")))?.txSignature;
  const withdrawTx = txOf("withdrawal");
  const status: AgentRule["status"] = LIVE_STATES.has(state) ? "active" : state === "filled" ? "completed" : state ? "cancelled" : bucket === "active" ? "active" : "cancelled";
  /* Expired orders keep their funds in the vault until the same cancel flow withdraws them (docs: manage-orders). */
  const nothingLeft = /^0+$/.test(String(o.remainingInputAmount ?? ""));
  const needsWithdrawal = state === "pending_withdraw" || (state === "expired" && !withdrawTx && !nothingLeft);

  return {
    id: `jup_${o.id}`,
    userId: wallet,
    assetId: `${token.companyId}:solana`,
    companyId: token.companyId,
    type: "price_trigger",
    condition: { kind, priceUsd, triggerMint: typeof o.triggerMint === "string" ? o.triggerMint : String(tokenMint) },
    action: { side: buy ? "buy" : "sell", amount: Number(amount.toFixed(buy ? 2 : 6)), currency: buy ? "USDC" : token.symbol },
    status,
    createdAt: toIso(o.createdAt) ?? syncedAt,
    expiresAt: toIso(o.expiresAt),
    jupiterOrderId: o.id,
    txSignature: txOf("deposit"),
    jupiterState: state || undefined,
    fillTxSignature: txOf("fill"),
    withdrawTxSignature: withdrawTx,
    needsWithdrawal: needsWithdrawal || undefined,
    syncedAt,
  };
}

export type OrderSync = { ok: true; orders: AgentRule[]; syncedAt: string } | { ok: false; needsSignature: boolean; error: string };
const syncInFlight = new Map<string, Promise<OrderSync>>();
/* An order placed seconds ago may not be in history yet; keep the local copy this long. */
const NEW_ORDER_GRACE_MS = 3 * 60_000;

/** Reads the wallet's active and past orders from Jupiter and replaces the store's list for that wallet.
 * `interactive: false` (default) never prompts: without a cached JWT it returns needsSignature. */
export function syncOrders(auth: RheaAuth | null, opts: { interactive?: boolean } = {}): Promise<OrderSync> {
  const wallet = auth?.address ?? useMarket.getState().wallet;
  if (!wallet) return Promise.resolve({ ok: false, needsSignature: false, error: "Sign in to see your limit orders." });
  const interactive = Boolean(opts.interactive);
  const key = `${wallet}:${interactive}`;
  const running = syncInFlight.get(key);
  if (running) return running;
  const p = (async (): Promise<OrderSync> => {
    const m = useMarket.getState();
    const status = m.status ?? (await m.loadStatus());
    if (!status?.jupiterKey) return { ok: false, needsSignature: false, error: TRIGGER_UNAVAILABLE };
    if (!useMarket.getState().overview) await m.loadOverview();
    try {
      const fetched = await withTriggerJwt(auth, interactive, wallet, async (jwt) => {
        const out: { order: JupiterOrder; bucket: "active" | "past" }[] = [];
        /* Active orders in full (up to 500); the 200 most recently updated past orders are plenty for the cards. */
        for (const bucket of ["active", "past"] as const) {
          for (let page = 0, offset = 0; page < (bucket === "active" ? 5 : 2); page++) {
            const r = await api.trigger("history", { state: bucket, limit: 100, offset, sort: "updated_at", dir: "desc" }, jwt);
            if (!Array.isArray(r.orders)) throw new Error("Jupiter's order history came back in an unexpected shape.");
            const list = r.orders as JupiterOrder[];
            out.push(...list.map((order) => ({ order, bucket })));
            offset += list.length;
            const total = Number((r.pagination as { total?: unknown } | undefined)?.total);
            if (list.length < 100 || (Number.isFinite(total) && offset >= total)) break;
          }
        }
        return out;
      });

      const syncedAt = new Date().toISOString();
      const s = useMarket.getState();
      const prev = s.wallet === wallet ? s.orders : [];
      const local = new Map(prev.filter((o) => o.jupiterOrderId).map((o) => [o.jupiterOrderId!, o]));
      const seen = new Set<string>();
      const orders: AgentRule[] = [];
      let skipped = 0;
      for (const { order, bucket } of fetched) {
        const r = mapJupiterOrder(order, wallet, bucket, syncedAt);
        if (!r) { skipped++; continue; }
        if (seen.has(r.jupiterOrderId!)) continue;
        seen.add(r.jupiterOrderId!);
        const l = local.get(r.jupiterOrderId!);
        orders.push(l ? {
          ...r,
          id: l.id, // keep ids the voice agent or an open card already refer to
          txSignature: r.txSignature ?? l.txSignature,
          withdrawTxSignature: r.withdrawTxSignature ?? l.withdrawTxSignature,
          /* A confirm-cancel that just returned its refund tx can still read as pending_withdraw briefly. */
          needsWithdrawal: r.needsWithdrawal && !l.withdrawTxSignature ? true : undefined,
        } : r);
      }
      for (const o of prev) {
        if (o.jupiterOrderId && seen.has(o.jupiterOrderId)) continue;
        const fresh = o.jupiterOrderId && o.status === "active" && Date.now() - Date.parse(o.createdAt) < NEW_ORDER_GRACE_MS;
        if (fresh || (o.simulated && !import.meta.env.PROD)) orders.push(o);
      }
      orders.sort((a, b) => Number(b.status === "active") - Number(a.status === "active") || Date.parse(b.createdAt) - Date.parse(a.createdAt));
      if (skipped) console.info(`[orders] ${skipped} Jupiter order(s) aren't USDC ↔ xStock single orders Rhea can show; left out`);
      s.replaceOrders(wallet, orders, syncedAt);

      /* Keep an open order card in step with Jupiter. */
      const cur = useMarket.getState();
      const po = cur.pendingOrder;
      const next = po?.jupiterOrderId ? orders.find((x) => x.jupiterOrderId === po.jupiterOrderId) : undefined;
      if (po && next && cur.wallet === wallet && (next.status !== po.status || next.jupiterState !== po.jupiterState || next.withdrawTxSignature !== po.withdrawTxSignature)) cur.setPendingOrder(next, cur.pendingOrderMode);
      return { ok: true, orders, syncedAt };
    } catch (e) {
      if (e instanceof NeedsSignature) return { ok: false, needsSignature: true, error: e.message };
      console.warn("[orders] sync", (e as Error).message);
      return { ok: false, needsSignature: false, error: (e as Error).message };
    }
  })().finally(() => syncInFlight.delete(key));
  syncInFlight.set(key, p);
  return p;
}

/* Signing in (or switching wallets) syncs from Jupiter only when a JWT for that wallet is already cached,
 * so sign-in never springs a signature prompt. Otherwise the cached list shows until the next order action.
 * Signing out drops the JWT (the wallet only goes from an address to null on sign-out, never at boot). */
useMarket.subscribe((s, prev) => {
  if (s.wallet === prev.wallet) return;
  if (!s.wallet) { if (prev.wallet) clearJwt(); return; }
  if (hasTriggerToken(s.wallet)) void syncOrders(null);
});

/* ---------------- Cancel (two signed steps) ----------------
 * 1. POST cancel → Jupiter stops filling at once and returns an unsigned withdrawal tx + requestId.
 * 2. The wallet signs it → POST confirm-cancel → Jupiter returns the withdrawal's signature (the refund).
 * The same two steps withdraw an expired order's funds. */

/* A signed withdrawal whose confirm failed is retried with the same cancelRequestId (as the docs say)
 * while its blockhash is plausibly still valid, instead of asking for a second signature. */
const CANCEL_RETRY_MS = 60_000;
const cancelAttempts = new Map<string, { requestId: string; signedTransaction: string; at: number }>();

export async function cancelTrigger(auth: RheaAuth, rule: AgentRule): Promise<AgentRule> {
  const m = useMarket.getState();
  if (m.demoMode) throw new Error(DEMO_READ_ONLY);
  const owner = auth.address;
  if (!owner) throw new Error("Sign in to cancel this order.");
  if (!rule.jupiterOrderId) {
    if (import.meta.env.PROD || !rule.simulated) throw new Error("This order has no Jupiter order id, so there is nothing to cancel on Jupiter.");
    /* Dev-only local rule: nothing is held anywhere, just retire it. */
    const local: AgentRule = { ...rule, status: "cancelled" };
    m.upsertOrder(local); m.setPendingOrder(local, "cancel");
    return local;
  }
  if (rule.userId && rule.userId !== owner) throw new Error("This order belongs to a different wallet. Sign in with that wallet to cancel it.");
  if (rule.status === "completed") throw new Error("This order already filled, so there is nothing to cancel.");
  const orderId = rule.jupiterOrderId;
  const call = <T,>(fn: (jwt: string) => Promise<T>) => withTriggerJwt(auth, true, owner, fn);

  let attempt = cancelAttempts.get(orderId);
  if (!attempt || Date.now() - attempt.at > CANCEL_RETRY_MS) {
    const c = await call((jwt) => api.trigger("cancel", { orderId }, jwt));
    if (typeof c.requestId !== "string" || !c.requestId || !isB64Tx(c.transaction)) throw new Error("Jupiter didn't return a withdrawal transaction for this order, so nothing was signed. Try again in a moment.");
    /* From here the order no longer fills, but the funds stay in the vault until the withdrawal is signed. */
    const started: AgentRule = { ...rule, status: "cancelled", jupiterState: "pending_withdraw", needsWithdrawal: true };
    m.upsertOrder(started); m.setPendingOrder(started, "cancel");
    const signed = await auth.signTransaction(b64ToBytes(c.transaction));
    attempt = { requestId: c.requestId, signedTransaction: bytesToB64(signed), at: Date.now() };
    cancelAttempts.set(orderId, attempt);
  }

  const a = attempt;
  let r: Record<string, unknown>;
  try {
    r = await call((jwt) => api.trigger("confirm-cancel", { orderId, signedTransaction: a.signedTransaction, cancelRequestId: a.requestId }, jwt));
  } catch (e) {
    /* A rejected withdrawal won't succeed on retry; anything else (timeout, 5xx) may. */
    if ([400, 403, 404].includes((e as { status?: number }).status ?? 0)) cancelAttempts.delete(orderId);
    throw e;
  }
  if (typeof r.txSignature !== "string" || !r.txSignature) throw new Error("Jupiter didn't return the refund transaction. Press the button again to retry the withdrawal.");
  cancelAttempts.delete(orderId);
  const done: AgentRule = { ...rule, status: "cancelled", jupiterState: "cancelled", needsWithdrawal: undefined, withdrawTxSignature: r.txSignature };
  m.upsertOrder(done); m.setPendingOrder(done, "cancel");
  void syncOrders(auth);
  return done;
}

/** Card/voice wording for where an order stands on Jupiter. */
export function orderStatusLabel(rule: AgentRule): string {
  if (rule.status === "pending") return "Awaiting your confirmation";
  if (rule.simulated) return import.meta.env.PROD ? "Unavailable" : "Dev only · local, not on Jupiter";
  const s = rule.jupiterState;
  if (rule.status === "active") return s === "pending" ? "Deposit confirming on Jupiter" : s === "executing" ? "Filling on Jupiter" : "Open on Jupiter";
  if (rule.status === "completed") return "Filled";
  if (rule.needsWithdrawal) return s === "expired" ? "Expired · funds still in your Jupiter order vault" : "Cancel started · funds still in your Jupiter order vault";
  if (s === "failed") return "Failed on Jupiter";
  if (s === "expired") return "Expired";
  return "Cancelled";
}

/** Re-runs a trade the user asked for before signing in / funding the wallet. */
export async function resumeIntent(auth: RheaAuth, intent: PendingIntent): Promise<PrepareResult | { ok: boolean; error?: string }> {
  if (intent.kind === "trigger") return prepareTrigger(auth, intent.companyId, intent.triggerKind, intent.priceUsd, intent.amount, intent.expiresInDays);
  return prepareTrade(auth, intent.companyId, intent.kind, intent.amount);
}

export function describeIntent(intent: PendingIntent) {
  const co = COMPANY_BY_ID[intent.companyId];
  if (intent.kind === "trigger") {
    const buy = intent.triggerKind === "buy_below";
    return `${buy ? "buy" : "sell"} ${co?.name ?? intent.companyId} when the price is ${buy ? "≤" : "≥"} $${intent.priceUsd}`;
  }
  if (intent.kind === "buy") return `buy $${intent.amount} of ${co?.name ?? intent.companyId}`;
  return `sell ${intent.amount} ${co?.tokenSymbol ?? intent.companyId}`;
}

export function describeRule(rule: AgentRule) {
  const co = COMPANY_BY_ID[rule.companyId];
  const cond = rule.condition.kind === "price_below" ? "≤" : "≥";
  const amt = rule.action.side === "buy" ? `$${rule.action.amount}` : `${rule.action.amount} ${rule.action.currency}`;
  return `${rule.action.side.toUpperCase()} ${amt} of ${co?.tokenSymbol ?? rule.assetId} when price ${cond} $${rule.condition.priceUsd}`;
}

/* ---------------- Receipt / announcement wording ---------------- */

/** "Jupiter fee 0.10% ($0.02) · network ~$0.001", from the quote's fee fields; null when the quote has none
 * (older backend), so the UI shows no fee line rather than a made-up one. */
export function feeSummary(q: TradeQuote): string | null {
  const parts: string[] = [];
  if (typeof q.feeBps === "number" && Number.isFinite(q.feeBps)) parts.push(`Jupiter fee ${(q.feeBps / 100).toFixed(2)}%${typeof q.platformFeeUsd === "number" && Number.isFinite(q.platformFeeUsd) ? ` (${fmtFeeUsd(q.platformFeeUsd)})` : ""}`);
  /* feeLamports counts only what the taker pays, so 0 means a gasless route (its cost sits in feeBps). */
  if (typeof q.networkFeeUsd === "number" && Number.isFinite(q.networkFeeUsd)) parts.push(q.networkFeeUsd === 0 && !q.feeLamports ? "network $0 (gasless)" : `network ~${fmtFeeUsd(q.networkFeeUsd)}`);
  else if (q.feeLamports > 0) parts.push(`network ~${(q.feeLamports / 1e9).toFixed(6)} SOL`);
  if (typeof q.rentFeeUsd === "number" && q.rentFeeUsd > 0) parts.push(`one-time token account ~${fmtFeeUsd(q.rentFeeUsd)}`);
  return parts.length ? parts.join(" · ") : null;
}

/** What Rhea is told after /execute returned Success: only what the app saw (Success, signature, timing); amounts are the quote's. */
export function tradeConfirmedAnnouncement(t: TradeIntent): string {
  const q = t.quote;
  const took = t.confirmMs != null ? ` in ${fmtSeconds(t.confirmMs)}` : "";
  const amounts = q ? ` Per the quote that is about ${q.outAmountUi.toFixed(q.outSymbol === "USDC" ? 2 : 4)} ${q.outSymbol} for ${q.inAmountUi} ${q.inSymbol}.` : "";
  return `Jupiter confirmed the ${t.side} on Solana${took}.${amounts} The receipt with the Solscan link is on the panel. Tell the user in one short sentence, mentioning the confirmation time; don't state exact received amounts or say the portfolio updated. Then ask what they'd like to do next.`;
}

/** What Rhea is told after a cancel: the refund tx Jupiter returned, nothing more. */
export function cancelAnnouncement(rule: AgentRule): string {
  const name = COMPANY_BY_ID[rule.companyId]?.name ?? rule.companyId;
  if (!rule.withdrawTxSignature) return `The dev-only local rule on ${name} was removed; it was never on Jupiter. Tell the user briefly.`;
  return `Jupiter accepted the cancel of the limit order on ${name} and returned refund transaction ${shortSig(rule.withdrawTxSignature)} (the withdrawal from the user's Jupiter order vault back to their wallet); it is linked on the card. Tell the user that in one or two short sentences and don't add anything beyond it.`;
}
