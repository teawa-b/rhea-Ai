import type { ImpactAnalysis, NewsEvent } from "@shared/types";
import { COMPANY_BY_ID } from "@shared/registry";
import { useWorld } from "@/state/world";
import { fmtAge } from "@/theme";

export function NewsCards({ items }: { items: NewsEvent[] }) {
  const addChartEvent = useWorld((s) => s.addChartEvent);
  const focusChartTimestamp = useWorld((s) => s.focusChartTimestamp);
  return (
    <div className="news">
      {items.map((n) => (
        <a key={n.id} className="card" href={n.url} target="_blank" rel="noreferrer noopener">
          <div className="title">{n.title}</div>
          <div className="meta">
            {n.source} · {Number.isFinite(Date.parse(n.publishedAt)) ? `${new Date(n.publishedAt).toLocaleDateString()} · ${fmtAge(n.publishedAt)}` : n.publishedAt}
            {n.companyIds[0] && Number.isFinite(Date.parse(n.publishedAt)) ? (
              <button className="btn ghost sm" style={{ marginLeft: 8, padding: "2px 6px" }} onClick={(e) => { e.preventDefault(); const ts = Date.parse(n.publishedAt); addChartEvent({ companyId: n.companyIds[0], timestamp: ts, title: n.title, kind: "news", url: n.url }); focusChartTimestamp(ts); }}>
                ⌖ chart
              </button>
            ) : null}
          </div>
          {n.summary ? <div className="summary">{n.summary}</div> : null}
        </a>
      ))}
    </div>
  );
}

export function ImpactCard({ impact }: { impact: ImpactAnalysis }) {
  const co = COMPANY_BY_ID[impact.companyId];
  const cls = impact.impact === "potentially_negative" ? "neg" : impact.impact === "potentially_positive" ? "pos" : "";
  return (
    <div className={`impact ${cls}`}>
      <div className="row">
        <span className={`tag ${cls === "neg" ? "magenta" : cls === "pos" ? "green" : "amber"}`}>{impact.impact.replace("_", " ")}</span>
        <span className="tag dim">{impact.time_horizon.replace("_", " ")}</span>
        <span className="spacer" />
        <span className="hint">confidence {(impact.confidence * 100).toFixed(0)}%</span>
      </div>
      <div className="bar" style={{ marginTop: 6 }}><i style={{ width: `${Math.round(impact.confidence * 100)}%` }} /></div>
      <div style={{ fontSize: 12.5, marginTop: 8, fontWeight: 600 }}>{co?.name}: {impact.event}</div>
      <ul>{impact.factors.map((f, i) => <li key={i}>{f}</li>)}</ul>
      <div className="hint" style={{ marginTop: 6 }}>AI estimate from cited sources — not a price prediction. Other market factors were also present.</div>
    </div>
  );
}
