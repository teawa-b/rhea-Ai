/* Trade confirmation (spec §11.1) and conditional-order confirmation (§12).
 * The AI can only bring the user here; only the buttons below move money. */
import { useState } from "react";
import { COMPANY_BY_ID } from "@shared/registry";
import { useAuth } from "@/auth/Auth";
import { useVoice } from "@/ai/voice";
import { useMarket } from "@/state/market";
import { confirmTrade, confirmTrigger, describeIntent, describeRule } from "@/solana/trade";
import { fmtAge, fmtUsd } from "@/theme";

export function TradePanel() {
  const auth = useAuth();
  const pending = useMarket((s) => s.pendingTrade);
  const setPending = useMarket((s) => s.setPendingTrade);
  const announce = useVoice((s) => s.announce);
  const [err, setErr] = useState<string | null>(null);
  if (!pending) return null;
  const co = COMPANY_BY_ID[pending.companyId];
  const q = pending.quote;
  const busy = pending.status === "submitted";

  const onConfirm = async () => {
    setErr(null);
    try {
      const done = await confirmTrade(auth, pending);
      announce(`The ${done.side} order filled: ${done.quote!.outAmountUi.toFixed(4)} ${done.quote!.outSymbol} for ${done.quote!.inAmountUi} ${done.quote!.inSymbol}, settled on Solana. Tell the user briefly, then ask what they'd like to do next.`);
    } catch (e) {
      setErr((e as Error).message);
      announce(`The trade did not go through: ${(e as Error).message}. Tell the user briefly and offer to retry.`);
    }
  };

  return (
    <div className="panel clickable" style={{ borderColor: pending.status === "confirmed" ? "rgba(74,222,128,0.6)" : pending.status === "failed" ? "rgba(255,90,110,0.6)" : undefined }}>
      <div className="panel-head">
        <div>
          <h2>{pending.side === "buy" ? "Buy" : "Sell"} {co?.tokenSymbol}</h2>
          <div className="sub">{co?.name} · Jupiter · Solana · quote {fmtAge(q?.quotedAt)}</div>
        </div>
        <span className={`tag ${pending.status === "confirmed" ? "green" : pending.status === "failed" ? "magenta" : "amber"}`}>{pending.status.replace("_", " ")}</span>
      </div>
      <div className="panel-body">
        {q ? (
          <dl className="kv">
            <dt>{pending.side === "buy" ? "Spend" : "Sell"}</dt><dd>{q.inAmountUi} {q.inSymbol}</dd>
            <dt>Estimated {q.outSymbol}</dt><dd>{q.outAmountUi.toFixed(q.outSymbol === "USDC" ? 2 : 4)}</dd>
            <dt>Route</dt><dd>{q.route}</dd>
            <dt>Network</dt><dd>Solana</dd>
            <dt>Price impact</dt><dd className={q.priceImpactPct > 1 ? "warn" : ""}>{q.priceImpactPct.toFixed(3)}%</dd>
            <dt>Max slippage</dt><dd>{(q.slippageBps / 100).toFixed(2)}%</dd>
            <dt>Network fee</dt><dd>~{(q.feeLamports / 1e9).toFixed(5)} SOL</dd>
            {pending.signature ? <><dt>Signature</dt><dd><a href={`https://solscan.io/tx/${pending.signature}`} target="_blank" rel="noreferrer">{pending.signature.slice(0, 8)}…</a></dd></> : null}
          </dl>
        ) : null}
        {err || pending.error ? <div className="hint" style={{ color: "#ff8ab8", marginTop: 8 }}>{err ?? pending.error}</div> : null}
        {pending.status === "confirmed" ? <div className="hint" style={{ color: "#4ade80", marginTop: 8 }}>Settled. Your position has been updated.</div> : null}
        <div className="row" style={{ marginTop: 12, justifyContent: "flex-end" }}>
          <button className="btn ghost" onClick={() => setPending(null)}>{pending.status === "confirmed" || pending.status === "failed" ? "Close" : "Cancel"}</button>
          {pending.status === "awaiting_confirmation" || pending.status === "failed" ? <button className="btn primary" disabled={busy} onClick={onConfirm}>{busy ? "Signing…" : "Confirm"}</button> : null}
        </div>
        <div className="hint" style={{ marginTop: 8 }}>You will sign with your embedded wallet. Rhea never holds your keys.</div>
      </div>
    </div>
  );
}

export function OrderPanel() {
  const auth = useAuth();
  const pending = useMarket((s) => s.pendingOrder);
  const setPending = useMarket((s) => s.setPendingOrder);
  const upsertOrder = useMarket((s) => s.upsertOrder);
  const removeOrder = useMarket((s) => s.removeOrder);
  const announce = useVoice((s) => s.announce);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (!pending) return null;
  const co = COMPANY_BY_ID[pending.companyId];
  const isCancel = pending.status === "cancelled";

  const onConfirm = async () => {
    setBusy(true); setErr(null);
    try {
      if (isCancel) {
        removeOrder(pending.id);
        setPending(null);
        announce(`The conditional order on ${co?.name} was cancelled.`);
        return;
      }
      const active = await confirmTrigger(auth, pending);
      upsertOrder(active);
      announce(`Done: the agent is now watching ${co?.name}: ${describeRule(active)}${active.simulated ? " (recorded locally — simulated mode)" : ", live on Jupiter"}. Mention the beacon now shown by the company.`);
    } catch (e) {
      setErr((e as Error).message);
    } finally { setBusy(false); }
  };

  return (
    <div className="panel clickable" style={{ borderColor: "rgba(255,178,32,0.55)" }}>
      <div className="panel-head">
        <div>
          <h2>{isCancel ? "Cancel order" : "Conditional order"}</h2>
          <div className="sub">{co?.name} · Jupiter Trigger V2 · Solana</div>
        </div>
        <span className={`tag ${pending.status === "active" ? "green" : "amber"}`}>{pending.status}</span>
      </div>
      <div className="panel-body">
        <div className="big" style={{ fontSize: 18 }}>{co?.tokenSymbol}</div>
        <dl className="kv" style={{ marginTop: 6 }}>
          <dt>Action</dt><dd>{pending.action.side.toUpperCase()} {pending.action.side === "buy" ? fmtUsd(pending.action.amount) : `${pending.action.amount} ${pending.action.currency}`}</dd>
          <dt>Trigger</dt><dd>{co?.tokenSymbol} {pending.condition.kind === "price_below" ? "≤" : "≥"} {fmtUsd(pending.condition.priceUsd)}</dd>
          <dt>Expires</dt><dd>{pending.expiresAt ? new Date(pending.expiresAt).toLocaleDateString() : "—"}</dd>
          <dt>Execution</dt><dd>{pending.simulated ? "simulated (no Jupiter key)" : "Jupiter keeper · onchain vault"}</dd>
          {pending.txSignature ? <><dt>Deposit tx</dt><dd><a href={`https://solscan.io/tx/${pending.txSignature}`} target="_blank" rel="noreferrer">{pending.txSignature.slice(0, 8)}…</a></dd></> : null}
        </dl>
        {err ? <div className="hint" style={{ color: "#ff8ab8", marginTop: 8 }}>{err}</div> : null}
        <div className="row" style={{ marginTop: 12, justifyContent: "flex-end" }}>
          <button className="btn ghost" onClick={() => setPending(null)}>{pending.status === "active" ? "Close" : "Cancel"}</button>
          {pending.status === "pending" || isCancel ? <button className={`btn ${isCancel ? "danger" : "amber"}`} disabled={busy} onClick={onConfirm}>{busy ? "Signing…" : isCancel ? "Cancel order" : "Confirm"}</button> : null}
        </div>
        {!isCancel ? <div className="hint" style={{ marginTop: 8 }}>Funds move into a Jupiter vault and the keeper executes when the price condition is met. Confirm to sign the deposit.</div> : null}
      </div>
    </div>
  );
}

/* ---------------- Sign-in / funding gates ----------------
 * Opened by the trade flow (and by Rhea's tools) when a trade is asked for
 * while signed out or while the wallet lacks USDC. IntentResumer in App.tsx
 * picks the trade up again once the blocker clears. */

export function LoginPanel() {
  const auth = useAuth();
  const prompt = useMarket((s) => s.loginPrompt);
  const setPrompt = useMarket((s) => s.setLoginPrompt);
  if (!prompt) return null;
  return (
    <div className="panel clickable">
      <div className="panel-head">
        <div><h2>Sign in to trade</h2><div className="sub">{prompt.reason}</div></div>
        <button className="btn ghost sm" onClick={() => setPrompt(null)} aria-label="Close">✕</button>
      </div>
      <div className="panel-body">
        <p className="hint" style={{ margin: "0 0 12px", fontSize: 12.5, color: "#dfe9f5" }}>
          Sign in with Google, email or a Solana wallet. New accounts get an embedded Solana wallet in seconds — Rhea never holds your keys.
          {prompt.resume ? ` Your ${describeIntent(prompt.resume)} will continue right after.` : ""}
        </p>
        <div className="row" style={{ justifyContent: "flex-end" }}>
          <button className="btn ghost" onClick={() => setPrompt(null)}>Later</button>
          <button className="btn primary" onClick={auth.login} disabled={!auth.ready}>{auth.mode === "guest" ? "Sign in (needs Privy)" : "Sign in"}</button>
        </div>
      </div>
    </div>
  );
}

export function DepositPanel() {
  const auth = useAuth();
  const prompt = useMarket((s) => s.depositPrompt);
  const setPrompt = useMarket((s) => s.setDepositPrompt);
  const loadPortfolio = useMarket((s) => s.loadPortfolio);
  const portfolio = useMarket((s) => s.portfolio);
  const [copied, setCopied] = useState(false);
  const [checking, setChecking] = useState(false);
  if (!prompt) return null;
  const have = portfolio?.usdcBalance ?? prompt.haveUsd;
  const missing = Math.max(0, prompt.neededUsd - have);
  const copy = () => { if (auth.address) void navigator.clipboard?.writeText(auth.address).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }); };
  return (
    <div className="panel clickable">
      <div className="panel-head">
        <div><h2>Fund your wallet</h2><div className="sub">USDC on Solana · {fmtUsd(missing)} more needed</div></div>
        <button className="btn ghost sm" onClick={() => setPrompt(null)} aria-label="Close">✕</button>
      </div>
      <div className="panel-body">
        <dl className="kv">
          <dt>Wallet USDC</dt><dd>{fmtUsd(have)}</dd>
          <dt>This trade needs</dt><dd>{fmtUsd(prompt.neededUsd)}</dd>
        </dl>
        <div className="divider" />
        <div className="hint">SEND USDC (SOLANA) TO</div>
        <div className="mono" style={{ fontSize: 12, wordBreak: "break-all", margin: "6px 0 10px", color: "#e8f4ff" }}>{auth.address ?? "—"}</div>
        <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
          <button className="btn sm" onClick={copy}>{copied ? "Copied" : "Copy address"}</button>
          <div className="row">
            <button className="btn ghost sm" onClick={() => setPrompt(null)}>Later</button>
            <button className="btn primary sm" disabled={checking} onClick={() => { setChecking(true); void loadPortfolio().finally(() => setChecking(false)); }}>{checking ? "Checking…" : "I've sent it"}</button>
          </div>
        </div>
        <div className="hint" style={{ marginTop: 10 }}>
          Send from an exchange or another wallet on the Solana network only. Keep a little SOL (~0.01) in the wallet for network fees.
          {prompt.resume ? ` Your ${describeIntent(prompt.resume)} continues automatically when the USDC lands.` : ""}
        </div>
      </div>
    </div>
  );
}
