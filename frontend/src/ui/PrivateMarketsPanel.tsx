/* Private (pre-IPO) markets.
 *
 * A listed company has a price. A private one has a *mark* — a number the
 * issuer puts on the portfolio backing the token — and an onchain price that
 * is free to disagree with it. The gap between the two is the only thing on
 * this panel that a holder cannot get anywhere else, so it is the headline.
 *
 * The bar under each row is that gap drawn to scale, centred on the mark:
 * right of centre means the market is paying above what the issuer says the
 * exposure is worth, left means below.
 */
import { useEffect, useState } from "react";
import { api } from "@/market/api";
import { useWorld } from "@/state/world";
import { C, fmtAge, fmtUsd, fmtValuation } from "@/theme";
import type { PrivateMarketSnapshot, PrivateMarketsOverview } from "@shared/types";
import { CloseIcon } from "./icons";
import { CoLogo } from "./CoLogo";

/* The widest premium the bar can draw before it clips. Beyond this the number
 * still reads correctly; only the bar saturates. */
const BAR_RANGE_PCT = 40;

function PremiumBar({ pct }: { pct: number }) {
  const clamped = Math.max(-BAR_RANGE_PCT, Math.min(BAR_RANGE_PCT, pct));
  const half = Math.abs(clamped) / BAR_RANGE_PCT * 50;
  const over = pct >= 0;
  return (
    <div
      style={{ position: "relative", height: 6, borderRadius: 3, background: "rgba(143,232,255,0.10)", overflow: "hidden" }}
      title={`Onchain price is ${pct >= 0 ? "above" : "below"} the issuer mark by ${Math.abs(pct).toFixed(2)}%`}
    >
      {/* Centre line = the issuer's mark. */}
      <div style={{ position: "absolute", left: "50%", top: 0, bottom: 0, width: 1, background: "rgba(143,232,255,0.5)" }} />
      <div
        style={{
          position: "absolute", top: 0, bottom: 0,
          left: over ? "50%" : `${50 - half}%`,
          width: `${half}%`,
          background: over ? C.green : C.magenta,
          opacity: 0.8,
        }}
      />
    </div>
  );
}

function Row({ a, onOpen }: { a: PrivateMarketSnapshot; onOpen: (id: string) => void }) {
  const pct = a.premiumToMarkPct;
  const over = (pct ?? 0) >= 0;
  return (
    <div
      className="clickable"
      onClick={() => onOpen(a.companyId)}
      style={{ padding: "10px 0", borderTop: `1px solid ${C.line}`, cursor: "pointer" }}
    >
      <div className="row" style={{ gap: 10, flexWrap: "nowrap", alignItems: "center" }}>
        <CoLogo id={a.companyId} size={26} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="row" style={{ gap: 6, alignItems: "baseline", flexWrap: "nowrap" }}>
            <strong style={{ fontSize: 14 }}>{a.companyName}</strong>
            <span className="hint mono">{a.symbol}</span>
          </div>
          <div className="hint">{a.sector}</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div className="mono" style={{ fontSize: 15 }}>{fmtUsd(a.tokenPriceUsd)}</div>
          <div className="hint">mark {fmtUsd(a.markPriceUsd)}</div>
        </div>
      </div>

      <div style={{ marginTop: 8 }}>
        {pct == null ? (
          <div className="hint">
            {a.markUnavailable ? "The issuer's mark is unavailable right now, so there is nothing to compare the onchain price against." : "No mark to compare against."}
          </div>
        ) : (
          <>
            <PremiumBar pct={pct} />
            <div className="row" style={{ marginTop: 5, gap: 8, alignItems: "baseline" }}>
              <span className={`tag ${over ? "green" : "magenta"}`} style={{ textTransform: "none", letterSpacing: "0.04em" }}>
                {over ? "+" : ""}{pct.toFixed(2)}% vs mark
              </span>
              <span className="hint">
                implied {fmtValuation(a.impliedValuationUsd)} · issuer marks it at {fmtValuation(a.markValuationUsd)}
              </span>
            </div>
          </>
        )}
      </div>

      <div className="row" style={{ marginTop: 6, gap: 8 }}>
        {!a.tradable ? <span className="tag amber">too thin to trade</span> : null}
        {a.liquidityUsd != null ? <span className="hint">liquidity {fmtUsd(a.liquidityUsd, 0)}</span> : null}
        {a.holders != null ? <span className="hint">{a.holders.toLocaleString()} holders</span> : null}
        <span className="hint">mark {fmtAge(a.markFetchedAt)}</span>
      </div>
    </div>
  );
}

export function PrivateMarketsPanel() {
  const [data, setData] = useState<PrivateMarketsOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const focusCompany = useWorld((s) => s.focusCompany);
  const resetGlobe = useWorld((s) => s.resetGlobe);

  useEffect(() => {
    let alive = true;
    const load = () => {
      api.privateMarkets()
        .then((d) => { if (alive) { setData(d); setError(null); } })
        .catch((e: Error) => { if (alive) setError(e.message); });
    };
    load();
    const h = setInterval(load, 15_000);
    return () => { alive = false; clearInterval(h); };
  }, []);

  return (
    <div className="panel clickable">
      <div className="panel-head">
        <div style={{ minWidth: 0 }}>
          <h2>Private markets</h2>
          <div className="sub">
            {data ? `${data.assets.length} pre-IPO ${data.assets.length === 1 ? "company" : "companies"} · ${data.issuer}` : "Loading…"}
          </div>
        </div>
        <button className="icon-btn" onClick={() => resetGlobe()} title="Close" aria-label="Close"><CloseIcon size={16} /></button>
      </div>

      <div className="panel-body scroll">
        {error ? <div className="hint" style={{ color: C.red }}>{error}</div> : null}

        <p className="hint" style={{ marginTop: 0 }}>
          These companies are not listed anywhere, so there is no exchange price. The reference is the
          issuer's mark on the exposure behind each token; the bar shows what the onchain market pays against it.
        </p>

        {data?.assets.map((a) => <Row key={a.mint} a={a} onOpen={focusCompany} />)}

        {data ? (
          <div style={{ marginTop: 14, paddingTop: 10, borderTop: `1px solid ${C.line}` }}>
            <div className="hint" style={{ lineHeight: 1.5 }}>{data.disclosure}</div>
            <div className="row" style={{ marginTop: 8, gap: 10 }}>
              <a className="hint" href={data.disclosureUrl} target="_blank" rel="noreferrer" style={{ color: C.frost }}>How PreStocks work ↗</a>
              <a className="hint" href={data.termsUrl} target="_blank" rel="noreferrer" style={{ color: C.frost }}>Terms ↗</a>
              <span className="hint">excluded: {data.restrictedJurisdictions.join(", ")}</span>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
