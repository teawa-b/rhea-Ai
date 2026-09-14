/* Region view ("show me Europe"): the region's markets with tradable stocks. */
import { useEffect } from "react";
import { COMPANY_BY_ID } from "@shared/registry";
import { useMarket } from "@/state/market";
import { REGION_BY_ID } from "@/state/regions";
import { useWorld } from "@/state/world";
import { fmtPct, fmtUsd } from "@/theme";
import { CloseIcon } from "./icons";

export function RegionPanel({ id }: { id: string }) {
  const region = REGION_BY_ID[id];
  const overview = useMarket((s) => s.overview);
  const prices = useMarket((s) => s.prices);
  const loadPrices = useMarket((s) => s.loadPrices);
  const focusCountry = useWorld((s) => s.focusCountry);
  const focusCompany = useWorld((s) => s.focusCompany);
  const resetGlobe = useWorld((s) => s.resetGlobe);

  const markets = (overview?.countries ?? []).filter((c) => region?.countries.includes(c.code)).sort((a, b) => b.tradableCount - a.tradableCount);
  const ids = markets.flatMap((c) => c.companies);
  useEffect(() => { if (ids.length) void loadPrices(ids); }, [ids.join(","), loadPrices]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!region) return null;
  const total = markets.reduce((n, c) => n + c.tradableCount, 0);

  return (
    <div className="panel clickable">
      <div className="panel-head">
        <div>
          <h2>{region.name}</h2>
          <div className="sub">{total} tradable stock{total === 1 ? "" : "s"} · {markets.length} market{markets.length === 1 ? "" : "s"}</div>
        </div>
        <button className="icon-btn" onClick={() => resetGlobe(false)} title="Close · back to world" aria-label="Close, back to world view"><CloseIcon size={16} /></button>
      </div>
      <div className="panel-body scroll">
        {markets.length ? markets.map((cs) => (
          <div key={cs.code} className="region-market">
            <button className="region-country" onClick={() => focusCountry(cs.code)}>
              <span className="name">{cs.name}</span>
              <span className="meta">{cs.tradableCount} stock{cs.tradableCount === 1 ? "" : "s"} ›</span>
            </button>
            <div className="list">
              {cs.companies.slice(0, 4).map((cid) => {
                const co = COMPANY_BY_ID[cid]; const p = prices[cid]; const ch = p?.change24hPct ?? null;
                return (
                  <div key={cid} className="item" onClick={() => focusCompany(cid)}>
                    <div className="grow"><div className="name">{co.name} <span className="muted">{co.ticker}</span></div><div className="meta">{co.sector}</div></div>
                    <div style={{ textAlign: "right" }}>
                      <div className="mono">{fmtUsd(p?.tokenPriceUsd)}</div>
                      <div className={`mono ${ch == null ? "" : ch >= 0 ? "pos" : "neg"}`} style={{ fontSize: 11 }}>{fmtPct(ch)}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )) : <div className="hint">No tokenized stocks are tradable in {region.name} yet.</div>}
      </div>
    </div>
  );
}
