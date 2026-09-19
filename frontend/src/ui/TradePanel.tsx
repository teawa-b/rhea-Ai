/* Trade confirmation (spec §11.1) and conditional-order confirmation (§12).
 * The AI can only bring the user here; only the buttons below move money. */
import { useEffect, useState } from "react";
import { COMPANY_BY_ID } from "@shared/registry";
import { useAuth } from "@/auth/Auth";
import { openSignInTab } from "@/auth/signinTab";
import { useVoice } from "@/ai/voice";
import { useMarket } from "@/state/market";
import { leaveHandheldForDom } from "@/scene/handheld";
import { cancelAnnouncement, cancelTrigger, confirmTrade, confirmTrigger, describeIntent, describeRule, feeSummary, orderStatusLabel, tradeConfirmedAnnouncement } from "@/solana/trade";
import { fmtAge, fmtEt, fmtSeconds, fmtUsd, sessionLabel, shortSig, solscanTx } from "@/theme";

const TxLink = ({ sig }: { sig: string }) => <a href={solscanTx(sig)} target="_blank" rel="noreferrer" title={sig}>{shortSig(sig)} ↗</a>;

export function TradePanel() {
  const auth = useAuth();
  const pending = useMarket((s) => s.pendingTrade);
  const setPending = useMarket((s) => s.setPendingTrade);
  const announce = useVoice((s) => s.announce);
  const price = useMarket((s) => (pending ? s.details[pending.companyId]?.price : undefined));
  const loadDetail = useMarket((s) => s.loadDetail);
  const [err, setErr] = useState<string | null>(null);
  /* The context line reads the company snapshot (reused if under 15 s old), never a second quote. */
  useEffect(() => { if (pending?.companyId) void loadDetail(pending.companyId); }, [pending?.companyId, loadDetail]);
  if (!pending) return null;
  const co = COMPANY_BY_ID[pending.companyId];
  const q = pending.quote;
  const busy = pending.status === "submitted";
  const confirmable = pending.status === "awaiting_confirmation" || pending.status === "failed";
  const fees = q ? feeSummary(q) : null;
  const receipt = pending.status === "confirmed" && pending.signature ? pending.signature : null;
  /* "regular session closed · token +0.40% vs 4pm close · Jupiter fee 0.10% + price impact 0.03%" */
  const session = price ? price.sessionLabel ?? sessionLabel(price.marketSession) : sessionLabel(null);
  const gap = session !== "US regular session" && price?.gapVsClosePct != null && Number.isFinite(price.gapVsClosePct) ? price.gapVsClosePct : null;
  const contextLine = q && !receipt ? [
    session ?? null,
    gap != null ? `token ${gap >= 0 ? "+" : ""}${gap.toFixed(2)}% vs 4pm close` : null,
    `${q.feeBps != null ? `Jupiter fee ${(q.feeBps / 100).toFixed(2)}% + ` : ""}price impact ${q.priceImpactPct.toFixed(q.priceImpactPct < 0.1 ? 3 : 2)}%`,
  ].filter(Boolean).join(" · ") : null;
  const context = contextLine ? contextLine[0].toUpperCase() + contextLine.slice(1) : null;

  const onConfirm = async () => {
    setErr(null);
    try {
      /* Privy's signing prompt is a DOM modal a phone AR session would hide. */
      await leaveHandheldForDom();
      const done = await confirmTrade(auth, pending);
      announce(tradeConfirmedAnnouncement(done));
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
        {context ? <div className="hint" style={{ marginBottom: 8, color: gap != null && Math.abs(gap) >= 1 ? "#ffd24a" : "#dfe9f5" }}>{context}</div> : null}
        {q ? (
          <dl className="kv">
            <dt>{pending.side === "buy" ? "Spend" : "Sell"}</dt><dd>{q.inAmountUi} {q.inSymbol}</dd>
            <dt>Estimated {q.outSymbol}</dt><dd>{q.outAmountUi.toFixed(q.outSymbol === "USDC" ? 2 : 4)}</dd>
            <dt>Route</dt><dd>{q.route}</dd>
            <dt>Network</dt><dd>Solana</dd>
            <dt>Price impact</dt><dd className={q.priceImpactPct > 1 ? "warn" : ""}>{q.priceImpactPct.toFixed(3)}%</dd>
            <dt>Max slippage</dt><dd>{(q.slippageBps / 100).toFixed(2)}%</dd>
            {!receipt && fees ? <><dt>Fees</dt><dd>{fees}</dd></> : null}
            {pending.signature && !receipt ? <><dt>Signature</dt><dd><TxLink sig={pending.signature} /></dd></> : null}
          </dl>
        ) : null}
        {err || pending.error ? <div className="hint" style={{ color: "#ff8ab8", marginTop: 8 }}>{err ?? pending.error}</div> : null}
        {receipt ? (
          /* Receipt: only what the app saw. Timing excludes the wallet approval (see confirmTrade). */
          <div style={{ marginTop: 10, padding: "10px 12px", border: "1px solid rgba(74,222,128,0.45)", borderRadius: 10, background: "rgba(74,222,128,0.06)" }}>
            <div style={{ fontSize: 18, fontWeight: 700, color: "#4ade80" }} title="From sending the signed transaction to Jupiter's Success response; your wallet approval time is not included">
              {pending.confirmMs != null ? `Confirmed in ${fmtSeconds(pending.confirmMs)}` : "Confirmed on Solana"}
            </div>
            {fees ? <div className="hint" style={{ marginTop: 4, color: "#dfe9f5" }}>{fees}</div> : null}
            {pending.confirmedAt ? <div className="hint" style={{ marginTop: 2 }}>{fmtEt(pending.confirmedAt)}{pending.sessionLabel ? ` · ${pending.sessionLabel}` : ""}</div> : null}
            <a className="btn primary" href={solscanTx(receipt)} target="_blank" rel="noreferrer" style={{ display: "block", textAlign: "center", textDecoration: "none", marginTop: 10, padding: "12px 16px", fontSize: 13 }}>View on Solscan ↗</a>
          </div>
        ) : null}
        <div className="row" style={{ marginTop: 12, justifyContent: "flex-end" }}>
          <button className="btn ghost" onClick={() => setPending(null)}>{pending.status === "confirmed" || pending.status === "failed" ? "Close" : "Cancel"}</button>
          {confirmable ? <button className="btn primary" disabled={busy} onClick={onConfirm}>{busy ? "Signing…" : "Confirm"}</button> : null}
        </div>
        <div className="hint" style={{ marginTop: 8 }}>You will sign with your embedded wallet. Rhea never holds your keys.</div>
      </div>
    </div>
  );
}

export function OrderPanel() {
  const auth = useAuth();
  const pending = useMarket((s) => s.pendingOrder);
  const mode = useMarket((s) => s.pendingOrderMode);
  const setPending = useMarket((s) => s.setPendingOrder);
  const announce = useVoice((s) => s.announce);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (!pending) return null;
  const co = COMPANY_BY_ID[pending.companyId];
  const isCancel = mode === "cancel";
  /* Expired orders and half-finished cancels still hold funds: the same two-step flow withdraws them. */
  const withdrawOnly = pending.status !== "active" && Boolean(pending.needsWithdrawal);
  const canCancel = isCancel && (pending.status === "active" || withdrawOnly);
  const canPlace = !isCancel && pending.status === "pending";
  const held = !pending.simulated && (pending.status === "pending" || pending.status === "active" || withdrawOnly);

  const onConfirm = async () => {
    setBusy(true); setErr(null);
    try {
      await leaveHandheldForDom();
      if (isCancel) {
        announce(cancelAnnouncement(await cancelTrigger(auth, pending)));
        return;
      }
      const active = await confirmTrigger(auth, pending);
      /* confirmTrigger refuses simulated rules in production, so this branch is dev-only. */
      announce(active.simulated
        ? `Dev build without a Jupiter key: the rule ${describeRule(active)} on ${co?.name} was recorded locally for testing only. It is not on Jupiter and will not fill. Tell the user briefly.`
        : `Tell the user: "Your limit order is live on Jupiter: ${describeRule(active)}. It is held by Jupiter, not Rhea, and fills even if you close the app." Then mention the beacon now shown by ${co?.name}.`);
    } catch (e) {
      const msg = (e as Error).message;
      setErr(msg);
      if (isCancel) {
        const stuck = useMarket.getState().pendingOrder?.needsWithdrawal;
        announce(`Cancelling the limit order on ${co?.name} didn't finish: ${msg} ${stuck ? "Jupiter has already stopped the order from filling, but the funds stay in the user's Jupiter order vault until they sign the withdrawal (the button on the card retries it)." : "The order is unchanged on Jupiter."} Tell the user briefly.`);
      }
    } finally { setBusy(false); }
  };

  const title = isCancel ? (pending.status === "cancelled" && !pending.needsWithdrawal ? "Order cancelled" : withdrawOnly ? "Withdraw funds" : "Cancel order") : "Limit order";
  const refundLabel = pending.status === "completed" ? "Payout tx" : "Refund tx";

  return (
    <div className="panel clickable" style={{ borderColor: "rgba(255,178,32,0.55)" }}>
      <div className="panel-head">
        <div>
          <h2>{title}</h2>
          <div className="sub">{co?.name} · Jupiter Trigger V2 · Solana</div>
        </div>
        <span className={`tag ${pending.status === "active" ? "green" : pending.status === "cancelled" ? "magenta" : "amber"}`}>{pending.status}</span>
      </div>
      <div className="panel-body">
        <div className="big" style={{ fontSize: 18 }}>{co?.tokenSymbol}</div>
        <dl className="kv" style={{ marginTop: 6 }}>
          <dt>Action</dt><dd>{pending.action.side.toUpperCase()} {pending.action.side === "buy" ? fmtUsd(pending.action.amount) : `${pending.action.amount} ${pending.action.currency}`}</dd>
          <dt>Trigger</dt><dd>{co?.tokenSymbol} {pending.condition.kind === "price_below" ? "≤" : "≥"} {fmtUsd(pending.condition.priceUsd)}</dd>
          <dt>Expires</dt><dd>{pending.expiresAt ? new Date(pending.expiresAt).toLocaleDateString() : "—"}</dd>
          <dt>Status</dt><dd className={pending.needsWithdrawal ? "warn" : ""}>{orderStatusLabel(pending)}</dd>
          {pending.jupiterOrderId ? <><dt>Jupiter order</dt><dd className="mono" title={pending.jupiterOrderId}>{shortSig(pending.jupiterOrderId)}</dd></> : null}
          {pending.txSignature ? <><dt>Deposit tx</dt><dd><TxLink sig={pending.txSignature} /></dd></> : null}
          {pending.fillTxSignature ? <><dt>Fill tx</dt><dd><TxLink sig={pending.fillTxSignature} /></dd></> : null}
          {pending.withdrawTxSignature ? <><dt>{refundLabel}</dt><dd><TxLink sig={pending.withdrawTxSignature} /></dd></> : null}
        </dl>
        {held ? <div className="hint" style={{ marginTop: 8, color: "#ffd24a" }}>Held by Jupiter, not Rhea · funds in your Jupiter order vault</div>
          : pending.simulated ? <div className="hint" style={{ marginTop: 8 }}>{import.meta.env.PROD ? "Unavailable right now" : "Dev only · local, not on Jupiter"}</div> : null}
        {err ? <div className="hint" style={{ color: "#ff8ab8", marginTop: 8 }}>{err}</div> : null}
        <div className="row" style={{ marginTop: 12, justifyContent: "flex-end", flexWrap: "wrap", gap: 8 }}>
          {!isCancel && pending.status === "active" && pending.jupiterOrderId ? <button className="btn ghost sm" onClick={() => { setErr(null); setPending(pending, "cancel"); }}>Cancel order…</button> : null}
          <button className="btn ghost" disabled={busy && isCancel} onClick={() => setPending(null)}>{canPlace ? "Not now" : canCancel ? (withdrawOnly ? "Later" : "Keep order") : "Close"}</button>
          {canPlace || canCancel ? <button className={`btn ${isCancel ? "danger" : "amber"}`} disabled={busy} onClick={onConfirm}>{busy ? "Signing…" : isCancel ? (withdrawOnly ? "Withdraw funds" : "Cancel order") : "Confirm"}</button> : null}
        </div>
        {canPlace ? <div className="hint" style={{ marginTop: 8 }}>Confirm to sign a deposit into your Jupiter order vault. The order is held by Jupiter, not Rhea, and fills when the price condition is met, even if you close the app.</div> : null}
        {canCancel && !withdrawOnly ? <div className="hint" style={{ marginTop: 8 }}>Cancelling is two steps on Jupiter: the order stops filling at once, then you sign a withdrawal that returns the funds from your Jupiter order vault to your wallet.</div> : null}
        {canCancel && withdrawOnly ? <div className="hint" style={{ marginTop: 8 }}>Sign the withdrawal to return the funds from your Jupiter order vault to your wallet.</div> : null}
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
          Sign in with Google, email or a Solana wallet in a new tab, then come back here. New accounts get an embedded Solana wallet in seconds — Rhea never holds your keys.
          {prompt.resume ? ` Your ${describeIntent(prompt.resume)} will continue right after.` : ""}
        </p>
        <div className="row" style={{ justifyContent: "flex-end" }}>
          <button className="btn ghost" onClick={() => setPrompt(null)}>Later</button>
          <button className="btn primary" onClick={() => { void leaveHandheldForDom().then(() => { if (auth.mode === "guest") auth.login(); else openSignInTab(auth); }); }} disabled={!auth.ready} title="Opens sign-in in a new tab">{auth.mode === "guest" ? "Sign in (needs Privy)" : "Sign in ↗"}</button>
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
