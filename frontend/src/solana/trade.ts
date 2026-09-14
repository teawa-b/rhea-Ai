/* Trade preparation + execution (spec §11) and conditional orders (§12).
 *
 * prepare*: compliance → live Jupiter quote → TradeIntent awaiting confirmation
 * confirm*: Privy signs the unsigned transaction → Jupiter executes/lands it
 *
 * Trigger orders use Jupiter Trigger V2 (auth challenge → vault → deposit →
 * order) when the server has a Jupiter key; otherwise the rule is stored
 * locally and clearly marked "simulated" so the demo flow still completes.
 */
import { COMPANY_BY_ID, USDC_MINT, resolveCompany } from "@shared/registry";
import type { AgentRule, TradeIntent, TradeSide } from "@shared/types";
import type { RheaAuth } from "@/auth/Auth";
import { api } from "@/market/api";
import { assetForCompany, useMarket } from "@/state/market";

const b64ToBytes = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
const bytesToB64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const uid = (p: string) => `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;

export type PrepareResult = { ok: true; intent: TradeIntent } | { ok: false; error: string; reasons?: string[] };

export async function prepareTrade(auth: RheaAuth, companyQuery: string, side: TradeSide, amount: number): Promise<PrepareResult> {
  const co = resolveCompany(companyQuery);
  if (!co) return { ok: false, error: `Unknown company "${companyQuery}"` };
  const m = useMarket.getState();
  if (!auth.authenticated || !auth.address) return { ok: false, error: "Sign in to trade — the app will open the login panel.", reasons: ["not_authenticated"] };
  if (!m.jurisdiction) return { ok: false, error: "Choose your region in the top bar before trading.", reasons: ["no_jurisdiction"] };
  if (!Number.isFinite(amount) || amount <= 0) return { ok: false, error: "Amount must be positive." };

  try {
    const { quote, asset } = await api.quote(co.id, side, amount, auth.address, m.jurisdiction);
    const intent: TradeIntent = {
      id: uid("trade"),
      userId: auth.address,
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
  /* Quotes go stale quickly; refresh if older than 45 s. */
  let quote = q;
  if (Date.now() - Date.parse(q.quotedAt) > 45_000 && auth.address) {
    const fresh = await api.quote(intent.companyId, intent.side, intent.amount, auth.address, m.jurisdiction);
    quote = fresh.quote;
  }
  const submitted: TradeIntent = { ...intent, quote, status: "submitted" };
  m.setPendingTrade(submitted); m.recordTrade(submitted);
  try {
    const signed = await auth.signTransaction(b64ToBytes(quote.transaction));
    const res = await api.execute(bytesToB64(signed), quote.requestId);
    if (res.status !== "Success" || !res.signature) throw new Error(res.error || `Swap ${res.status ?? "failed"}${res.code ? ` (code ${res.code})` : ""}`);
    const done: TradeIntent = { ...submitted, status: "confirmed", signature: res.signature };
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

export async function prepareTrigger(auth: RheaAuth, companyQuery: string, kind: TriggerKind, triggerPriceUsd: number, amount: number, expiresInDays = 30): Promise<{ ok: true; rule: AgentRule } | { ok: false; error: string }> {
  const co = resolveCompany(companyQuery);
  if (!co) return { ok: false, error: `Unknown company "${companyQuery}"` };
  const asset = assetForCompany(co.id);
  if (!asset) return { ok: false, error: `${co.name} has no tokenized asset yet.` };
  const m = useMarket.getState();
  if (!auth.authenticated || !auth.address) return { ok: false, error: "Sign in to create orders — the app will open the login panel." };
  if (!m.jurisdiction) return { ok: false, error: "Choose your region in the top bar first." };
  const elig = await api.eligibility(co.id, m.jurisdiction, "trigger");
  if (!elig.result.allowed) return { ok: false, error: elig.result.reasons.join(" ") };
  if (!(triggerPriceUsd > 0) || !(amount > 0)) return { ok: false, error: "Price and amount must be positive." };

  const rule: AgentRule = {
    id: uid("rule"),
    userId: auth.address,
    assetId: asset.id,
    companyId: co.id,
    type: "price_trigger",
    condition: { kind: kind === "buy_below" ? "price_below" : "price_above", priceUsd: triggerPriceUsd, triggerMint: asset.mint },
    action: { side: kind === "buy_below" ? "buy" : "sell", amount, currency: kind === "buy_below" ? "USDC" : asset.symbol },
    status: "pending",
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + expiresInDays * 86400_000).toISOString(),
    simulated: !m.status?.jupiterKey,
  };
  m.setPendingOrder(rule);
  return { ok: true, rule };
}

/** Walks Jupiter Trigger V2: challenge → sign → verify → vault → deposit craft → sign → order. */
export async function confirmTrigger(auth: RheaAuth, rule: AgentRule): Promise<AgentRule> {
  const m = useMarket.getState();
  const owner = auth.address;
  if (!owner) throw new Error("Not signed in");
  const asset = assetForCompany(rule.companyId);
  if (!asset) throw new Error("Asset not found");

  if (rule.simulated) {
    /* No Jupiter key on the server: keep the rule locally (clearly labelled). */
    const active: AgentRule = { ...rule, status: "active" };
    m.upsertOrder(active); m.setPendingOrder(active);
    return active;
  }

  const enc = new TextEncoder();
  const { challenge } = (await api.trigger("challenge", { walletPubkey: owner, type: "message" })) as { challenge: string };
  const sig = await auth.signMessage(enc.encode(challenge));
  const { default: bs58 } = await import("bs58");
  const { token } = (await api.trigger("verify", { type: "message", walletPubkey: owner, signature: bs58.encode(sig) })) as { token: string };
  await api.trigger("vault", {}, token);

  const isBuy = rule.action.side === "buy";
  const inputMint = isBuy ? USDC_MINT : asset.mint;
  const outputMint = isBuy ? asset.mint : USDC_MINT;
  const inputAmount = BigInt(Math.round(rule.action.amount * 10 ** (isBuy ? 6 : asset.decimals))).toString();

  const deposit = (await api.trigger("deposit", { inputMint, outputMint, userAddress: owner, amount: inputAmount, orderType: "price", orderSubType: "single" }, token)) as { requestId?: string; transaction?: string; error?: string };
  if (!deposit.requestId || !deposit.transaction) throw new Error(deposit.error || "Deposit craft failed");
  const signedDeposit = await auth.signTransaction(b64ToBytes(deposit.transaction));

  const order = (await api.trigger("order", {
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
  }, token)) as { id?: string; txSignature?: string; depositConfirmed?: boolean; error?: string };
  if (!order.id) throw new Error(order.error || "Order creation failed");

  const active: AgentRule = { ...rule, status: "active", jupiterOrderId: order.id, txSignature: order.txSignature };
  m.upsertOrder(active); m.setPendingOrder(active);
  return active;
}

export function describeRule(rule: AgentRule) {
  const co = COMPANY_BY_ID[rule.companyId];
  const cond = rule.condition.kind === "price_below" ? "≤" : "≥";
  const amt = rule.action.side === "buy" ? `$${rule.action.amount}` : `${rule.action.amount} ${rule.action.currency}`;
  return `${rule.action.side.toUpperCase()} ${amt} of ${co?.tokenSymbol ?? rule.assetId} when price ${cond} $${rule.condition.priceUsd}`;
}
