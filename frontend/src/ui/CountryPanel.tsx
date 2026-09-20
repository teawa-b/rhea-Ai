/* Country view (spec §3.3): tokenized companies, live moves, exposure, news. */
import { useEffect } from "react";
import { COMPANY_BY_ID, COUNTRIES } from "@shared/registry";
import type { CountryCode } from "@shared/types";
import { useMarket } from "@/state/market";
import { useWorld } from "@/state/world";
import { fmtPct, fmtUsd } from "@/theme";
import { CloseIcon } from "./icons";
import { CoLogo } from "./CoLogo";
import { NewsCards } from "./NewsCards";

export function CountryPanel({ code }: { code: CountryCode }) {
  const cd = COUNTRIES[code];
  const overview = useMarket((s) => s.overview);
  const prices = useMarket((s) => s.prices);
  const portfolio = useMarket((s) => s.portfolio);
  const orders = useMarket((s) => s.orders);
  const loadPrices = useMarket((s) => s.loadPrices);
  const focusCompany = useWorld((s) => s.focusCompany);
  const resetGlobe = useWorld((s) => s.resetGlobe);
  const news = useWorld((s) => s.news);
  const newsPending = useWorld((s) => s.newsPending);

  const cs = overview?.countries.find((c) => c.code === code);
  const ids = cs?.companies ?? [];
  useEffect(() => { if (ids.length) void loadPrices(ids); }, [ids.join(","), loadPrices]); // eslint-disable-line react-hooks/exhaustive-deps

  const exposure = portfolio?.positions.filter((p) => COMPANY_BY_ID[p.companyId]?.countryCode === code).reduce((s, p) => s + (p.valueUsd ?? 0), 0) ?? 0;
  const activeRules = orders.filter((o) => o.status === "active" && COMPANY_BY_ID[o.companyId]?.countryCode === code).length;
  const sorted = [...ids].sort((a, b) => {
    const pa = prices[a]?.tokenPriceUsd ?? 0, pb = prices[b]?.tokenPriceUsd ?? 0;
    if ((pa > 0) !== (pb > 0)) return pa > 0 ? -1 : 1;
    return (COMPANY_BY_ID[a].featured ? 0 : 1) - (COMPANY_BY_ID[b].featured ? 0 : 1) || COMPANY_BY_ID[a].name.localeCompare(COMPANY_BY_ID[b].name);
  });
  const countryNews = news && (news.target === cd.name || news.items.some((n) => n.countryCodes.includes(code))) ? news.items : [];

  return (
    <div className="panel clickable">
      <div className="panel-head">
        <div>
          <h2>{cd.name}</h2>
          <div className="sub">{cs?.assetCount ?? 0} tokenized assets · {cs?.tradableCount ?? 0} with liquidity{activeRules ? ` · ${activeRules} agent${activeRules > 1 ? "s" : ""} watching` : ""}</div>
        </div>
        <button className="icon-btn" onClick={() => resetGlobe(false)} title="Close · back to world" aria-label="Close, back to world view"><CloseIcon size={16} /></button>
      </div>
      <div className="panel-body scroll">
        {portfolio ? <dl className="kv" style={{ marginBottom: 10 }}><dt>Your exposure here</dt><dd>{fmtUsd(exposure)} · {portfolio.totalValueUsd ? ((exposure / portfolio.totalValueUsd) * 100).toFixed(0) : 0}%</dd></dl> : null}
        <div className="list">
          {sorted.map((id) => {
            const co = COMPANY_BY_ID[id];
            const p = prices[id];
            const live = (p?.tokenPriceUsd ?? 0) > 0;
            const ch = p?.change24hPct ?? null;
            return (
              <div key={id} className="item" onClick={() => focusCompany(id, "user")}>
                <CoLogo id={id} />
                <div className="grow">
                  <div className="name">{co.name} <span className="muted">{co.ticker}</span></div>
                  <div className="meta">{co.sector}{co.headquarters ? ` · ${co.headquarters.name}` : ""}</div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div className="mono">{live ? fmtUsd(p?.tokenPriceUsd) : <span className="tag dim">listed</span>}</div>
                  {live ? <div className={`mono ${ch == null ? "" : ch >= 0 ? "pos" : "neg"}`} style={{ fontSize: 11 }}>{fmtPct(ch)}</div> : null}
                </div>
              </div>
            );
          })}
        </div>
        {countryNews.length ? (<><div className="divider" /><NewsCards items={countryNews} label={cd.name} /></>)
          : newsPending === cd.name ? (<><div className="divider" /><div className="hint wire-wait"><i />Searching the wire for {cd.name}…</div></>) : null}
      </div>
    </div>
  );
}
