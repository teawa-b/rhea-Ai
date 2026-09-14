/* Company / building view (spec §3.4): prices, chart, position, news,
 * impact, corporate actions, active orders, trade actions, street view. */
import { useEffect, useState } from "react";
import { COMPANY_BY_ID, COUNTRIES } from "@shared/registry";
import { useAuth } from "@/auth/Auth";
import { api } from "@/market/api";
import { useMarket } from "@/state/market";
import { useWorld } from "@/state/world";
import { isGated, prepareTrade, prepareTrigger, describeRule } from "@/solana/trade";
import { fmtAge, fmtPct, fmtUsd } from "@/theme";
import { Chart } from "./Chart";
import { CloseIcon } from "./icons";
import { CoLogo } from "./CoLogo";
import { NewsCards, ImpactCard } from "./NewsCards";

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

  /* Corporate actions from the issuer's onchain data become chart markers (spec §21). */
  const addChartEvent = useWorld((s) => s.addChartEvent);
  const actionsKey = detail?.corporateActions.map((c) => c.id).join(",") ?? "";
  useEffect(() => {
    for (const ca of detail?.corporateActions ?? []) {
      const ts = Date.parse(ca.effectiveAt);
      if (Number.isFinite(ts)) addChartEvent({ companyId, timestamp: ts, title: ca.type === "rebase" ? "xStocks rebase (distribution)" : ca.type, kind: "corporate_action" });
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
          <div className="sub">{co.ticker} · {co.tokenSymbol} · {co.sector} · {COUNTRIES[co.countryCode].name}</div>
          </div>
        </div>
        <button className="icon-btn" onClick={() => focusCountry(co.countryCode)} title={`Close · back to ${COUNTRIES[co.countryCode].name}`} aria-label={`Close, back to ${COUNTRIES[co.countryCode].name}`}><CloseIcon size={16} /></button>
      </div>
      <div className="panel-body scroll">
        {/* Prices */}
        <div className="row" style={{ alignItems: "baseline", gap: 14 }}>
          <div>
            <div className="hint">UNDERLYING · {p?.underlyingSource === "pyth" ? "Pyth Pro" : p?.underlyingSource === "jupiter-stockdata" ? "Jupiter · xStocks ref" : p?.underlyingSource === "yahoo" ? "Yahoo (fallback)" : "—"}</div>
            <div className="big">{fmtUsd(p?.underlyingPriceUsd)}</div>
          </div>
          <div>
            <div className="hint">ONCHAIN TOKEN · Jupiter</div>
            <div className="big" style={{ fontSize: 20 }}>{fmtUsd(p?.tokenPriceUsd)} <span className={cls} style={{ fontSize: 13 }}>{fmtPct(change)}</span></div>
          </div>
        </div>
        <div className="row" style={{ marginTop: 6 }}>
          <span className={`tag ${p?.marketSession === "regular" ? "green" : "dim"}`}>{p ? p.marketSession.replace("_", " ") : "…"}</span>
          {p?.stale ? <span className="tag amber">stale data</span> : null}
          {divergence != null && Math.abs(divergence) > 0.5 ? <span className="tag amber">token {divergence > 0 ? "+" : ""}{divergence.toFixed(2)}% vs stock</span> : null}
          <span className="hint">token {fmtAge(p?.tokenUpdatedAt)} · stock {fmtAge(p?.underlyingUpdatedAt)}</span>
        </div>

        <div className="divider" />
        <Chart companyId={co.id} ticker={co.ticker} />

        {/* Position */}
        <div className="divider" />
        <dl className="kv">
          <dt>Your position</dt><dd>{pos ? `${pos.amountUi.toFixed(4)} ${pos.symbol}` : auth.authenticated ? "none" : "sign in"}</dd>
          <dt>Position value</dt><dd>{pos ? fmtUsd(pos.valueUsd) : "—"}</dd>
          {detail?.asset ? <><dt>Liquidity</dt><dd>{fmtUsd(detail.asset.liquidityUsd, 0)}</dd></> : null}
          {detail?.asset ? <><dt>Mint</dt><dd className="muted" title={detail.asset.mint}>{detail.asset.mint.slice(0, 6)}…{detail.asset.mint.slice(-4)}</dd></> : null}
        </dl>

        {/* Active orders */}
        {active.length ? (
          <>
            <div className="divider" />
            {active.map((o) => (
              <div key={o.id} className="impact" style={{ marginBottom: 6 }}>
                <div className="row"><span className="tag amber">◉ agent watching</span>{o.simulated ? <span className="tag dim">simulated</span> : <span className="tag green">onchain</span>}</div>
                <div style={{ fontSize: 12.5, marginTop: 6 }}>{describeRule(o)}</div>
                <div className="hint">created {fmtAge(o.createdAt)}{o.jupiterOrderId ? ` · Jupiter ${o.jupiterOrderId.slice(0, 8)}…` : ""}</div>
              </div>
            ))}
          </>
        ) : null}

        {/* Corporate actions */}
        {detail?.corporateActions.length ? (
          <>
            <div className="divider" />
            <div className="hint" style={{ marginBottom: 4 }}>CORPORATE ACTION</div>
            {detail.corporateActions.map((ca) => (
              <div key={ca.id} className="impact">
                <div className="row"><span className="tag amber">{ca.type}</span><span className="hint">effective {new Date(ca.effectiveAt).toLocaleDateString()}</span></div>
                <div style={{ fontSize: 12, marginTop: 6, color: "#c7d7ea" }}>{ca.detail}</div>
                <div className="hint">source: {ca.source}</div>
              </div>
            ))}
          </>
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
        <div className="row" style={{ marginTop: 8 }}>
          <span className="hint">Buy</span>
          <input className="chip mono" type="number" min={1} value={trigger.amount} onChange={(e) => setTrigger({ ...trigger, amount: e.target.value })} style={{ width: 80 }} />
          <span className="hint">USDC if ≤</span>
          <input className="chip mono" type="number" min={0} placeholder={p?.tokenPriceUsd ? (p.tokenPriceUsd * 0.9).toFixed(0) : "price"} value={trigger.price} onChange={(e) => setTrigger({ ...trigger, price: e.target.value })} style={{ width: 96 }} />
          <button className="btn amber sm" disabled={!canTrade || busy != null || !Number(trigger.price)} onClick={doTrigger}>{busy === "trigger" ? "…" : "Set trigger"}</button>
        </div>
        {status && !status.jupiterKey ? <div className="hint" style={{ marginTop: 4 }}>Trigger orders run in simulated mode until a JUPITER_API_KEY is configured.</div> : null}

        {/* Street view */}
        {co.headquarters ? (
          <>
            <div className="divider" />
            <div className="row">
              <span className="hint">HQ · {co.headquarters.name}</span>
              <span className="spacer" />
              <button className="btn ghost sm" onClick={() => showStreetView(streetView === co.id ? null : co.id)}>{streetView === co.id ? "Hide" : "Street View"}</button>
            </div>
            {streetView === co.id ? (
              status?.streetView && !svFailed ? (
                <div className="streetview" style={{ marginTop: 8 }}>
                  <img src={api.streetViewUrl(co.id)} alt={`Street View near ${co.headquarters.name}`} onError={() => setSvFailed(true)} />
                  <span className="attr">Imagery © Google</span>
                </div>
              ) : <div className="hint" style={{ marginTop: 6 }}>{svFailed ? "No Street View imagery here — showing the map marker instead." : "Street View needs GOOGLE_MAPS_API_KEY on the server; showing the map marker."}</div>
            ) : null}
          </>
        ) : null}

        {/* News + impact */}
        {impact && impact.companyId === co.id ? (<><div className="divider" /><ImpactCard impact={impact} /></>) : null}
        {companyNews.length ? (<><div className="divider" /><NewsCards items={companyNews} label={countryNews ? COUNTRIES[co.countryCode].name : co.ticker} /></>) : null}
      </div>
    </div>
  );
}
