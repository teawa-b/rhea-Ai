import type { ImpactAnalysis, NewsEvent } from "@shared/types";
import { COMPANY_BY_ID } from "@shared/registry";
import { useWorld } from "@/state/world";
import { useState } from "react";
import { logoUrl } from "@/market/logos";
import { fmtAge } from "@/theme";

function hostOf(url: string) {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; }
}

/** Source badge: the site's favicon, falling back to a gradient monogram. */
function SourceBadge({ source, url }: { source: string; url: string }) {
  const [failed, setFailed] = useState(false);
  const host = hostOf(url);
  if (!host || failed) return <span className="nw-badge mono-badge" aria-hidden>{(source || host || "?").slice(0, 1).toUpperCase()}</span>;
  return <img className="nw-badge" src={`https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64`} alt="" loading="lazy" onError={() => setFailed(true)} />;
}

function NewsCard({ n, hidden }: { n: NewsEvent; hidden?: boolean }) {
  const addChartEvent = useWorld((s) => s.addChartEvent);
  const focusChartTimestamp = useWorld((s) => s.focusChartTimestamp);
  const dated = Number.isFinite(Date.parse(n.publishedAt));
  const logos = n.companyIds.map((id) => ({ id, url: logoUrl(id), co: COMPANY_BY_ID[id] })).filter((x) => x.co).slice(0, 3);
  return (
    <a className="nw-card" href={n.url} target="_blank" rel="noreferrer noopener" aria-hidden={hidden || undefined} tabIndex={hidden ? -1 : undefined}>
      <div className="nw-top">
        <SourceBadge source={n.source} url={n.url} />
        <span className="nw-source">{n.source || hostOf(n.url)}</span>
        {dated ? <span className="nw-age">{fmtAge(n.publishedAt)}</span> : null}
      </div>
      <div className="nw-title">{n.title}</div>
      {n.summary ? <div className="nw-summary">{n.summary}</div> : null}
      <div className="nw-foot">
        {logos.map((l) => l.url
          ? <img key={l.id} className="nw-co" src={l.url} alt={l.co.name} title={l.co.name} />
          : <span key={l.id} className="nw-co tick">{l.co.ticker}</span>)}
        <span className="spacer" />
        {n.companyIds[0] && dated ? (
          <button className="nw-chart" tabIndex={hidden ? -1 : undefined} onClick={(e) => { e.preventDefault(); const ts = Date.parse(n.publishedAt); addChartEvent({ companyId: n.companyIds[0], timestamp: ts, title: n.title, kind: "news", url: n.url }); focusChartTimestamp(ts); }}>
            ⌖ on chart
          </button>
        ) : <span className="nw-open">read ↗</span>}
      </div>
    </a>
  );
}

/** News as a slow left-to-right carousel (pauses on hover / focus). */
export function NewsCards({ items, label }: { items: NewsEvent[]; /** e.g. a country name shown in the header */ label?: string }) {
  const sources = new Set(items.map((n) => n.source || hostOf(n.url))).size;
  const loop = items.length > 1;
  /* Seconds per card keeps the pace the same however many stories there are. */
  const duration = `${Math.max(18, items.length * 9)}s`;
  return (
    <section className="nw" aria-label="News">
      <header className="nw-head">
        <span className="nw-live"><i />Live wire{label ? ` · ${label}` : ""}</span>
        <span className="nw-count">{items.length} {items.length === 1 ? "story" : "stories"} · {sources} {sources === 1 ? "source" : "sources"}</span>
      </header>
      <div className={`nw-viewport${loop ? " loop" : ""}`}>
        <div className="nw-track" style={{ animationDuration: duration }}>
          {items.map((n) => <NewsCard key={n.id} n={n} />)}
          {loop ? items.map((n) => <NewsCard key={`${n.id}-dup`} n={n} hidden />) : null}
        </div>
      </div>
    </section>
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
