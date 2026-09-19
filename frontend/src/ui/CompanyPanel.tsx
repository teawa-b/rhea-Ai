/* Company / building view (spec §3.4): prices, chart, position, news,
 * impact, corporate actions, active orders, trade actions, street view. */
import { useEffect, useState } from "react";
import { COMPANY_BY_ID, COUNTRIES } from "@shared/registry";
import { useAuth } from "@/auth/Auth";
import { api } from "@/market/api";
import { useMarket } from "@/state/market";
import { useWorld } from "@/state/world";
import { isGated, prepareTrade, prepareTrigger, describeRule } from "@/solana/trade";
import { fmtAge, fmtPct, fmtUsd, fmtValuation, sessionLabel } from "@/theme";
import type { CorporateAction } from "@shared/types";
import { Chart } from "./Chart";
import { CloseIcon } from "./icons";
import { CoLogo } from "./CoLogo";
import { NewsCards, ImpactCard } from "./NewsCards";

/* Badges keep their exact wording (caType is verbatim), so no uppercase transform. */
const CASE = { textTransform: "none", letterSpacing: "0.04em" } as const;
/* Corporate-action dates are the issuer's effectiveTimeUtc; shown as the UTC day so they match what Rhea says. */
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const caDate = (iso: string) => { const d = new Date(iso); return Number.isFinite(d.getTime()) ? `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}` : "—"; };
const caMoney = (n: number, cur = "USD") => (cur === "USD" ? `$${n < 1 ? n.toFixed(4).replace(/0{1,2}$/, "") : n.toFixed(2)}` : `${n} ${cur}`);
/** "Net $0.175 · gross $0.25 per share-equivalent · 30% withholding"; null for events without amounts (splits etc.). */
function caAmounts(ca: CorporateAction) {
  if (ca.netAmount == null && ca.grossAmount == null) return null;
  const parts = [ca.netAmount != null ? `Net ${caMoney(ca.netAmount, ca.currency)}` : null, ca.grossAmount != null ? `gross ${caMoney(ca.grossAmount, ca.currency)}` : null].filter(Boolean);
  return `${parts.join(" · ")} per share-equivalent${ca.withholdingPct ? ` · ${ca.withholdingPct}% withholding` : ""}`;
}

/** A collapsed section of the company panel. Everything that is reference
 *  rather than the reason you opened the panel lives behind one of these. */
function Section({ title, count, defaultOpen = false, children }: {
  title: string; count?: number; defaultOpen?: boolean; children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <>
      <div className="divider" />
      <button type="button" className="sect" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        {title}
        {count != null ? <span className="count">{count}</span> : null}
        <span className="caret" aria-hidden>›</span>
      </button>
      {open ? <div className="sect-body">{children}</div> : null}
    </>
  );
}

export function CompanyPanel({ companyId }: { companyId: string }) {
  const co = COMPANY_BY_ID[companyId];
  const auth = useAuth();
  const detail = useMarket((s) => s.details[companyId]);
  const loadDetail = useMarket((s) => s.loadDetail);
  const portfolio = useMarket((s) => s.portfolio);
  const orders = useMarket((s) => s.orders);
  const status = useMarket((s) => s.status);
  const setError = useMarket((s) => s.setError);
  const news = useWorld((s) => s.news);
  const impact = useWorld((s) => s.impact);
  const streetView = useWorld((s) => s.streetViewCompany);
  const showStreetView = useWorld((s) => s.showStreetView);
  const focusCountry = useWorld((s) => s.focusCountry);

  const [amount, setAmount] = useState(100);
  const [trigger, setTrigger] = useState<{ price: string; amount: string }>({ price: "", amount: "100" });
  const [busy, setBusy] = useState<string | null>(null);
  const [svFailed, setSvFailed] = useState(false);

  useEffect(() => {
    void loadDetail(companyId, true);
    const h = setInterval(() => void loadDetail(companyId, true), 10_000);
    return () => clearInterval(h);
  }, [companyId, loadDetail]);
  useEffect(() => { setSvFailed(false); }, [companyId]);

  /* Corporate actions from the xStocks API become chart markers (spec §21). */
  const addChartEvent = useWorld((s) => s.addChartEvent);
  const actionsKey = detail?.corporateActions.map((c) => c.id).join(",") ?? "";
  useEffect(() => {
    for (const ca of detail?.corporateActions ?? []) {
      const ts = Date.parse(ca.effectiveAt);
      /* caType verbatim from the xStocks API; the Jupiter-only multiplier row has none. */
      if (Number.isFinite(ts)) addChartEvent({ companyId, timestamp: ts, title: ca.caType ?? (ca.type === "rebase" ? "xStocks rebase (distribution)" : ca.type), kind: "corporate_action" });
    }
  }, [actionsKey, companyId, addChartEvent]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!co) return null;
  const p = detail?.price;
  const pos = portfolio?.positions.find((x) => x.companyId === companyId);
  const active = orders.filter((o) => o.companyId === companyId && o.status === "active");
  const change = p?.change24hPct ?? null;
  const cls = change == null ? "" : change >= 0 ? "pos" : "neg";
  const divergence = p?.tokenPriceUsd && p?.underlyingPriceUsd ? ((p.tokenPriceUsd - p.underlyingPriceUsd) / p.underlyingPriceUsd) * 100 : null;
  const tradable = detail?.asset?.tradable ?? false;
  /* Session wording from the server; the clock-only fallback never says "closed" on a weeknight. */
  const session = p ? p.sessionLabel ?? sessionLabel(p.marketSession) : undefined;
  const inSession = p?.sessionLabel ? p.sessionLabel === "US regular session" : p?.marketSession === "regular";
  const gap = !inSession && p?.gapVsClosePct != null && Number.isFinite(p.gapVsClosePct) ? p.gapVsClosePct : null;
  const reserves = detail?.reserves ?? null;
  /* A private company has no exchange behind it: the reference is the issuer's
   * mark, there is no session and no 4pm close to gap against. */
  const isPrivate = Boolean(co?.private) || p?.underlyingSource === "issuer-mark";
  const premium = p?.premiumToMarkPct ?? null;
  /* Every tokenized wrapper of this company. More than one means two issuers
   * wrap the same exposure and their prices are worth comparing directly. */
  const wrappers = detail?.wrappers ?? [];
  const multiWrapped = wrappers.length > 1;
  const showDbcStudio = useWorld((s) => s.showDbcStudio);
  /* Upcoming first, then newest. */
  const actions = [...(detail?.corporateActions ?? [])].sort((a, b) => Number(!!b.upcoming) - Number(!!a.upcoming) || Date.parse(b.effectiveAt) - Date.parse(a.effectiveAt));
  /* Signed-out users may still press Buy: prepareTrade opens the sign-in panel. */
  const canTrade = tradable;
  /* Company news when there is some; otherwise keep the country briefing that led here visible. */
  const ownNews = news && (news.target === co.name || news.items.some((n) => n.companyIds.includes(co.id)));
  const countryNews = news && !ownNews && (news.target === COUNTRIES[co.countryCode].name || news.items.some((n) => n.countryCodes.includes(co.countryCode)));
  const companyNews = ownNews || countryNews ? news!.items : [];

  const doBuy = async () => {
    setBusy("buy");
    const r = await prepareTrade(auth, co.id, "buy", amount);
    if (!r.ok && !isGated(r)) setError(r.error);
    setBusy(null);
  };
  const doSell = async () => {
    if (!pos) return;
    setBusy("sell");
    const r = await prepareTrade(auth, co.id, "sell", pos.amountUi);
    if (!r.ok && !isGated(r)) setError(r.error);
    setBusy(null);
  };
  const doTrigger = async () => {
    setBusy("trigger");
    const r = await prepareTrigger(auth, co.id, "buy_below", Number(trigger.price), Number(trigger.amount));
    if (!r.ok) setError(r.error);
    setBusy(null);
  };

  return (
    <div className="panel clickable">
      <div className="panel-head">
        <div className="row" style={{ gap: 10, flexWrap: "nowrap", minWidth: 0 }}>
          <CoLogo id={co.id} size={34} />
          <div style={{ minWidth: 0 }}>
          <h2>{co.name}</h2>
          <div className="sub">{co.ticker} · {co.sector}</div>
          </div>
        </div>
        <button className="icon-btn" onClick={() => focusCountry(co.countryCode)} title={`Close · back to ${COUNTRIES[co.countryCode].name}`} aria-label={`Close, back to ${COUNTRIES[co.countryCode].name}`}><CloseIcon size={16} /></button>
      </div>
      <div className="panel-body scroll">
        {/* Prices */}
        <div className="row" style={{ alignItems: "baseline", gap: 14 }}>
          <div>
            <div className="hint">{p?.underlyingSource === "issuer-mark" ? "ISSUER MARK · PreStocks" : `UNDERLYING · ${p?.underlyingSource === "pyth" ? "Pyth Pro" : p?.underlyingSource === "jupiter-stockdata" ? "Jupiter · xStocks ref" : p?.underlyingSource === "yahoo" ? "Yahoo (fallback)" : "—"}`}</div>
            <div className="big">{fmtUsd(p?.underlyingPriceUsd)}</div>
          </div>
          <div>
            <div className="hint">ONCHAIN TOKEN · Jupiter</div>
            <div className="big" style={{ fontSize: 20 }}>{fmtUsd(p?.tokenPriceUsd)} <span className={cls} style={{ fontSize: 13 }}>{fmtPct(change)}</span></div>
          </div>
        </div>
        <div className="row" style={{ marginTop: 6 }}>
          {isPrivate
            ? <span className="tag dim" style={CASE} title="A private company has no exchange session; the Solana market runs continuously.">private · trades 24/7</span>
            : <span className={`tag ${inSession ? "green" : "dim"}`}>{p ? session ?? p.marketSession.replace("_", " ") : "…"}</span>}
          {p?.halted ? <span className="tag magenta" title="The issuer has halted this xStock">issuer halt</span> : null}
          {p?.stale ? <span className="tag amber">stale data</span> : null}
          {isPrivate && premium != null ? (
            <span className={`tag ${premium >= 0 ? "green" : "magenta"}`} style={CASE} title={`Onchain ${fmtUsd(p?.tokenPriceUsd)} against the issuer's mark of ${fmtUsd(p?.markPriceUsd)} per token`}>
              Token {premium >= 0 ? "+" : ""}{premium.toFixed(2)}% vs mark
            </span>
          ) : gap != null ? (
            <span className={`tag ${gap >= 0 ? "green" : "magenta"}`} style={CASE} title={p?.lastCloseUsd != null ? `Solana token ${fmtUsd(p.tokenPriceUsd)} vs ${fmtUsd(p.lastCloseUsd)} at the US 4pm ET close` : undefined}>
              Token {gap >= 0 ? "+" : ""}{gap.toFixed(2)}% vs 4pm close
            </span>
          ) : divergence != null && Math.abs(divergence) > 0.5 ? <span className="tag amber">token {divergence > 0 ? "+" : ""}{divergence.toFixed(2)}% vs stock</span> : null}
          <span className="hint">token {fmtAge(p?.tokenUpdatedAt)} · {isPrivate ? "mark" : "stock"} {fmtAge(p?.underlyingUpdatedAt)}</span>
        </div>

        {isPrivate && p?.impliedValuationUsd ? (
          <div className="hint" style={{ marginTop: 4 }}>
            At this price the market values {co.name} at {fmtValuation(p.impliedValuationUsd)}.
          </div>
        ) : null}

        {multiWrapped ? (
          <div style={{ marginTop: 12 }}>
            <div className="hint">TOKENIZED BY {wrappers.length} ISSUERS</div>
            {wrappers.map((w) => {
              const prem = w.price.premiumToMarkPct;
              return (
                <div key={w.asset.id} className="row" style={{ gap: 8, alignItems: "baseline", padding: "4px 0", flexWrap: "nowrap" }}>
                  <span className="mono" style={{ width: 74, flex: "0 0 auto", fontSize: 12 }}>{w.asset.symbol}</span>
                  <span className="hint" style={{ flex: 1, minWidth: 0 }}>{w.asset.issuer}</span>
                  <span className="mono" style={{ fontSize: 13 }}>{fmtUsd(w.price.tokenPriceUsd)}</span>
                  {prem != null ? <span className={`tag ${prem >= 0 ? "green" : "magenta"}`} style={CASE}>{prem >= 0 ? "+" : ""}{prem.toFixed(1)}%</span> : null}
                  {!w.asset.tradable ? <span className="tag amber">thin</span> : null}
                </div>
              );
            })}
            <div className="hint" style={{ marginTop: 4, lineHeight: 1.45 }}>
              Different issuers, different backing and different legal claims — the prices are not
              interchangeable quotes for the same instrument.
            </div>
          </div>
        ) : null}

        <div className="divider" />
        {isPrivate ? (
          /* No exchange lists this company, so there is no series to draw and
           * the range buttons would be meaningless. Say why, rather than
           * leaving a chart that can only ever show a spinner. */
          <div className="hint" style={{ lineHeight: 1.5 }}>
            No price history: {co.name} is private, so there is no exchange series to chart. The issuer's
            mark and the onchain price above are the only two prices that exist.
          </div>
        ) : (
          <Chart companyId={co.id} ticker={co.ticker} />
        )}

        {/* Position, liquidity and backing — reference, not the headline. */}
        <Section title="Position & details" defaultOpen={Boolean(pos)}>
          <dl className="kv">
            <dt>Your position</dt><dd>{pos ? `${pos.amountUi.toFixed(4)} ${pos.symbol}` : auth.authenticated ? "none" : "sign in"}</dd>
            <dt>Position value</dt><dd>{pos ? fmtUsd(pos.valueUsd) : "—"}</dd>
            {detail?.asset ? <><dt>Liquidity</dt><dd>{fmtUsd(detail.asset.liquidityUsd, 0)}</dd></> : null}
            {detail?.asset ? <><dt>Issuer</dt><dd>{detail.asset.issuer}</dd></> : null}
            {reserves ? <><dt>Backed</dt><dd title={`${reserves.shares.toLocaleString(undefined, { maximumFractionDigits: 0 })} shares at ${reserves.custodian} vs ${reserves.circulating.toLocaleString(undefined, { maximumFractionDigits: 0 })} ${reserves.symbol} circulating · ${fmtAge(reserves.asOf)}`}>{reserves.backedPct.toFixed(2)}% · {reserves.custodian}</dd></> : null}
            {detail?.asset ? <><dt>Mint</dt><dd className="muted" title={detail.asset.mint}>{detail.asset.mint.slice(0, 6)}…{detail.asset.mint.slice(-4)}</dd></> : null}
          </dl>
        </Section>

        {/* Active orders: open by default — an unfilled order is live money. */}
        {active.length ? (
          <Section title="Open orders" count={active.length} defaultOpen>
            {active.map((o) => (
              <div key={o.id} className="impact" style={{ marginBottom: 6 }}>
                <div className="row"><span className="tag amber">◉ limit order</span>{o.simulated ? <span className="tag dim">dev only</span> : <span className="tag green">held by Jupiter, not Rhea</span>}</div>
                <div style={{ fontSize: 12.5, marginTop: 6 }}>{describeRule(o)}</div>
                <div className="hint">created {fmtAge(o.createdAt)}{o.jupiterOrderId ? ` · Jupiter ${o.jupiterOrderId.slice(0, 8)}…` : ""}</div>
              </div>
            ))}
          </Section>
        ) : null}

        {/* Corporate actions */}
        {actions.length ? (
          <Section title="Corporate actions" count={actions.length} defaultOpen={actions.some((a) => a.upcoming)}>
            {actions.map((ca) => {
              const amounts = caAmounts(ca);
              return (
                <div key={ca.id} className="impact" style={{ marginBottom: 6 }}>
                  <div className="row">
                    <span className="tag amber" style={CASE}>{ca.caType ?? ca.type}</span>
                    {ca.upcoming ? <span className="tag">scheduled</span> : null}
                    <span className="hint" title={ca.effectiveAt}>effective {caDate(ca.effectiveAt)}{ca.payDate ? ` · paid ${caDate(ca.payDate)}` : ""}</span>
                  </div>
                  {amounts ? <div className="mono" style={{ fontSize: 12, marginTop: 6, color: "#e8f4ff" }}>{amounts}</div> : null}
                  {ca.detail ? <div style={{ fontSize: 11.5, marginTop: 4, color: "#c7d7ea" }}>{ca.detail}</div> : null}
                  <div className="hint">source: {ca.source}</div>
                </div>
              );
            })}
          </Section>
        ) : null}

        {/* Trade */}
        <div className="divider" />
        <div className="hint" style={{ marginBottom: 6 }}>TRADE · Jupiter · Solana</div>
        {!auth.authenticated ? <div className="hint">Not signed in — Buy opens sign-in. Research stays available.</div> : null}
        {detail && !tradable ? <div className="hint warn">Listed, but no onchain liquidity yet — trading disabled.</div> : null}
        <div className="row" style={{ marginTop: 6 }}>
          <input className="chip mono" type="number" min={1} value={amount} onChange={(e) => setAmount(Number(e.target.value))} style={{ width: 96 }} />
          <span className="hint">USDC</span>
          <button className="btn sol sm" disabled={!canTrade || busy != null} onClick={doBuy}>{busy === "buy" ? "Quoting…" : `Buy ${co.tokenSymbol}`}</button>
          <button className="btn danger sm" disabled={!canTrade || !pos || busy != null} onClick={doSell}>Sell all</button>
        </div>

        {/* A conditional order is a deliberate act, not something to trip over. */}
        <Section title="Limit order">
          <div className="row">
            <span className="hint">Buy</span>
            <input className="chip mono" type="number" min={1} value={trigger.amount} onChange={(e) => setTrigger({ ...trigger, amount: e.target.value })} style={{ width: 80 }} />
            <span className="hint">USDC if ≤</span>
            <input className="chip mono" type="number" min={0} placeholder={p?.tokenPriceUsd ? (p.tokenPriceUsd * 0.9).toFixed(0) : "price"} value={trigger.price} onChange={(e) => setTrigger({ ...trigger, price: e.target.value })} style={{ width: 96 }} />
            <button className="btn amber sm" disabled={!canTrade || busy != null || !Number(trigger.price)} onClick={doTrigger}>{busy === "trigger" ? "…" : "Set trigger"}</button>
          </div>
          {status && !status.jupiterKey ? <div className="hint" style={{ marginTop: 6 }}>Trigger orders run in simulated mode until a JUPITER_API_KEY is configured.</div> : null}
        </Section>

        {/* Location and the curve studio: both secondary to price and trade. */}
        {co.headquarters ? (
          <Section title="Location & tools">
            <div className="row">
              <span className="hint">HQ · {co.headquarters.name}</span>
              <span className="spacer" />
              <button className="btn ghost sm" onClick={() => showStreetView(streetView === co.id ? null : co.id)}>{streetView === co.id ? "Hide" : "Street View"}</button>
            </div>
            <div className="row" style={{ marginTop: 8 }}>
              <button className="btn ghost sm" onClick={() => showDbcStudio(co.id)} title={`Design a Meteora bonding curve anchored on ${co.name}'s reference price`}>Design a curve</button>
            </div>
            {streetView === co.id ? (
              status?.streetView && !svFailed ? (
                <div className="streetview" style={{ marginTop: 8 }}>
                  <img src={api.streetViewUrl(co.id)} alt={`Street View near ${co.headquarters.name}`} onError={() => setSvFailed(true)} />
                  <span className="attr">Imagery © Google</span>
                </div>
              ) : <div className="hint" style={{ marginTop: 6 }}>{svFailed ? "No Street View imagery here — showing the map marker instead." : "Street View needs GOOGLE_MAPS_API_KEY on the server; showing the map marker."}</div>
            ) : null}
          </Section>
        ) : null}

        {/* News + impact */}
        {impact && impact.companyId === co.id ? (<><div className="divider" /><ImpactCard impact={impact} /></>) : null}
        {companyNews.length ? (<><div className="divider" /><NewsCards items={companyNews} label={countryNews ? COUNTRIES[co.countryCode].name : co.ticker} /></>) : null}
      </div>
    </div>
  );
}
