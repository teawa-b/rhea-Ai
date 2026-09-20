/* Meteora DBC studio — design a bonding curve for a tokenized equity.
 *
 * The thing worth seeing here is *where the raise lands*. A memecoin curve
 * spreads it across a huge price range because nobody knows what the token is
 * worth. An equity curve should concentrate it next to the reference price, so
 * the chart is a single bar split by segment share: if the anchor band is not
 * most of the bar, the curve is not doing its job.
 *
 * Everything is read-only. The panel plans and explains a config; it never
 * signs, sends or funds anything.
 */
import { useEffect, useMemo, useState } from "react";
import { COMPANY_BY_ID } from "@shared/registry";
import { api } from "@/market/api";
import { useWorld } from "@/state/world";
import { C, fmtUsd } from "@/theme";
import type { DbcCurvePlan, DbcPreset } from "@shared/types";
import { CloseIcon } from "./icons";

/* Categorical fills for the three curve segments, validated against this
 * panel's surface (#0b0f1c) for the OKLCH dark band, chroma floor, CVD
 * separation and contrast. Every segment is also named in the legend below the
 * bar, so identity never rests on colour alone. Labels stay on ink tokens. */
const SEGMENT_FILL: Record<string, string> = {
  discovery: "#2394b0",
  anchor: "#8b5cff",
  premium: "#b57410",
};
const fillFor = (name: string) => SEGMENT_FILL[name] ?? C.steel;

const pct = (n: number) => `${n.toFixed(1)}%`;

/** Compact money for raise figures, which run from thousands to hundreds of millions. */
function fmtQuote(n: number | null | undefined, symbol: string): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const unit = symbol === "USDC" ? "$" : "";
  const suffix = symbol === "USDC" ? "" : ` ${symbol}`;
  if (n >= 1e9) return `${unit}${(n / 1e9).toFixed(2)}B${suffix}`;
  if (n >= 1e6) return `${unit}${(n / 1e6).toFixed(1)}M${suffix}`;
  if (n >= 1e3) return `${unit}${(n / 1e3).toFixed(0)}k${suffix}`;
  return `${unit}${n.toFixed(0)}${suffix}`;
}

/** The raise, split by segment. Widths are each segment's share of the total,
 *  which is the question the chart answers. 2px gaps keep the fills apart. */
function RaiseBar({ plan }: { plan: DbcCurvePlan }) {
  const segs = plan.segments.filter((s) => s.sharePct > 0);
  return (
    <div style={{ display: "flex", gap: 2, height: 22, borderRadius: 4, overflow: "hidden", background: "rgba(143,232,255,0.06)" }}>
      {segs.map((s) => (
        <div
          key={s.name}
          title={`${s.name}: ${fmtUsd(s.lowerPriceUsd)} → ${fmtUsd(s.upperPriceUsd)} · ${pct(s.sharePct)} of the raise · ${fmtQuote(s.quoteIn, plan.quote.symbol)} in, ${Math.round(s.baseOut).toLocaleString()} ${plan.base.symbol} out`}
          style={{ width: `${s.sharePct}%`, background: fillFor(s.name), minWidth: 2 }}
        />
      ))}
    </div>
  );
}

/** Where the four prices sit relative to each other, with the reference marked. */
function PriceRail({ plan }: { plan: DbcCurvePlan }) {
  const lo = plan.startPriceUsd;
  const hi = plan.migrationPriceUsd;
  const span = Math.max(1e-9, hi - lo);
  const at = (p: number) => ((p - lo) / span) * 100;
  const bandLeft = at(plan.bandLowPriceUsd);
  const bandWidth = Math.max(0, at(plan.bandHighPriceUsd) - bandLeft);
  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ position: "relative", height: 10 }}>
        <div style={{ position: "absolute", left: 0, right: 0, top: 4, height: 2, background: "rgba(143,232,255,0.18)" }} />
        {/* The anchor band: the stretch of price the curve is built to defend. */}
        <div style={{ position: "absolute", left: `${bandLeft}%`, width: `${bandWidth}%`, top: 1, height: 8, background: SEGMENT_FILL.anchor, opacity: 0.35, borderRadius: 2 }} />
        {/* The reference price itself. */}
        <div
          style={{ position: "absolute", left: `${at(plan.referencePriceUsd)}%`, top: -2, width: 2, height: 14, background: C.frost }}
          title={`Reference ${fmtUsd(plan.referencePriceUsd)} — ${plan.referenceSource}`}
        />
      </div>
      <div className="row" style={{ justifyContent: "space-between", marginTop: 3 }}>
        <span className="hint mono">{fmtUsd(lo)} start</span>
        <span className="hint mono">ref {fmtUsd(plan.referencePriceUsd)}</span>
        <span className="hint mono">{fmtUsd(hi)} migrate</span>
      </div>
    </div>
  );
}

export function DbcStudioPanel({ companyId }: { companyId: string }) {
  const showDbcStudio = useWorld((s) => s.showDbcStudio);
  const co = companyId ? COMPANY_BY_ID[companyId] : undefined;

  const [presets, setPresets] = useState<DbcPreset[]>([]);
  const [presetId, setPresetId] = useState<string | null>(null);
  const [supply, setSupply] = useState<string>("");
  const [plan, setPlan] = useState<DbcCurvePlan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showConfig, setShowConfig] = useState(false);

  useEffect(() => { api.dbcPresets().then((d) => setPresets(d.presets)).catch(() => setPresets([])); }, []);

  /* Re-plan whenever the anchor or the knobs change. The planner is pure and
   * cheap, so there is no reason to make the user press a button. */
  useEffect(() => {
    if (!companyId) { setPlan(null); return; }
    let alive = true;
    setBusy(true);
    const n = Number(supply);
    api.dbcPlan({
      companyId,
      ...(presetId ? { presetId } : {}),
      ...(Number.isFinite(n) && n > 0 ? { totalTokenSupply: n } : {}),
    })
      .then((p) => { if (alive) { setPlan(p); setError(null); } })
      .catch((e: Error) => { if (alive) { setError(e.message); setPlan(null); } })
      .finally(() => { if (alive) setBusy(false); });
    return () => { alive = false; };
  }, [companyId, presetId, supply]);

  const configJson = useMemo(() => (plan ? JSON.stringify(plan.config, null, 2) : ""), [plan]);

  return (
    <div className="panel clickable">
      <div className="panel-head">
        <div style={{ minWidth: 0 }}>
          <h2>Curve studio</h2>
          <div className="sub">Meteora DBC · {co ? `anchored on ${co.name}` : "pick a company"}</div>
        </div>
        <button className="icon-btn" onClick={() => showDbcStudio(null)} title="Close" aria-label="Close"><CloseIcon size={16} /></button>
      </div>

      <div className="panel-body scroll">
        <p className="hint" style={{ marginTop: 0 }}>
          A memecoin curve starts near zero because nobody knows what the token is worth. A tokenized stock
          already has a reference price, so this curve is built around it: thin liquidity closes the launch
          discount, a thick band holds price near fair value, and it graduates into DAMM v2 close to the
          reference rather than wherever a launch spike ended.
        </p>

        {!companyId ? (
          <div className="hint">Open a company and choose “Design a curve” to anchor one.</div>
        ) : null}

        {presets.length ? (
          <div className="row" style={{ gap: 6, marginTop: 10 }}>
            {presets.map((p) => (
              <button
                key={p.id}
                className={`chip clickable${(plan?.preset.id ?? presetId) === p.id ? " sol" : ""}`}
                onClick={() => setPresetId(p.id)}
                title={p.summary}
              >
                {p.name}
              </button>
            ))}
            <input
              className="chip mono"
              type="number"
              min={1}
              placeholder={plan ? plan.totalTokenSupply.toLocaleString() : "supply"}
              value={supply}
              onChange={(e) => setSupply(e.target.value)}
              style={{ width: 110 }}
              aria-label="Total token supply"
            />
          </div>
        ) : null}

        {error ? <div className="hint" style={{ color: C.red, marginTop: 10 }}>{error}</div> : null}
        {busy && !plan ? <div className="hint" style={{ marginTop: 10 }}>Planning…</div> : null}

        {plan ? (
          <>
            <div className="row" style={{ marginTop: 14, alignItems: "baseline", gap: 14 }}>
              <div>
                <div className="hint">REFERENCE · {plan.referenceSource}</div>
                <div className="big">{fmtUsd(plan.referencePriceUsd)}</div>
              </div>
              <div>
                <div className="hint">RAISE TO GRADUATE</div>
                <div className="big" style={{ fontSize: 20 }}>{fmtQuote(plan.migrationQuoteThreshold, plan.quote.symbol)}</div>
              </div>
            </div>

            <div className="row" style={{ marginTop: 6, gap: 6 }}>
              <span className={`tag ${plan.valid ? "green" : "magenta"}`}>{plan.valid ? "config validates" : "config rejected"}</span>
              <span className="tag dim" style={{ textTransform: "none", letterSpacing: "0.04em" }}>{plan.preset.name}</span>
              <span className="hint">
                {plan.totalTokenSupply.toLocaleString()} {plan.base.symbol} supply · quote {plan.quote.symbol}
              </span>
            </div>

            <PriceRail plan={plan} />

            <div className="hint" style={{ marginTop: 14, marginBottom: 5 }}>WHERE THE RAISE LANDS</div>
            <RaiseBar plan={plan} />

            {/* Legend and direct values: each segment named, so the bar is never read by colour alone. */}
            <div style={{ marginTop: 8 }}>
              {plan.segments.map((s) => (
                <div key={s.name} className="row" style={{ gap: 8, alignItems: "baseline", padding: "3px 0", flexWrap: "nowrap" }}>
                  <span style={{ width: 10, height: 10, borderRadius: 2, background: fillFor(s.name), flex: "0 0 auto" }} aria-hidden />
                  <span style={{ width: 74, flex: "0 0 auto", fontSize: 12 }}>{s.name}</span>
                  <span className="hint mono" style={{ flex: 1, minWidth: 0 }}>{fmtUsd(s.lowerPriceUsd)} → {fmtUsd(s.upperPriceUsd)}</span>
                  <span className="mono" style={{ fontSize: 12 }}>{pct(s.sharePct)}</span>
                </div>
              ))}
            </div>

            <dl className="kv" style={{ marginTop: 12 }}>
              <dt>Discount</dt><dd>{plan.launchDiscountPct}% below reference</dd>
              <dt>Anchor</dt><dd>±{plan.bandPct}% · liquidity ×{plan.anchorWeight}</dd>
              <dt>Migration</dt><dd>{fmtUsd(plan.migrationPriceUsd)} · {plan.ceilingPct}% above reference</dd>
              <dt>Sold on curve</dt><dd>{Math.round(plan.totalBaseSold).toLocaleString()} {plan.base.symbol}</dd>
              <dt>Fee</dt><dd>{plan.fee.startingFeeBps} → {plan.fee.endingFeeBps} bps over {plan.fee.decayMinutes} min{plan.fee.dynamicFeeEnabled ? " · dynamic on" : ""}</dd>
              <dt>Graduates</dt><dd>DAMM v2 · half the liquidity locked for good</dd>
            </dl>

            {plan.warnings.length ? (
              <div style={{ marginTop: 10 }}>
                {plan.warnings.map((w, i) => (
                  <div key={i} className="hint" style={{ color: C.gold, lineHeight: 1.45, marginBottom: 4 }}>{w}</div>
                ))}
              </div>
            ) : null}

            <div className="row" style={{ marginTop: 12, gap: 8 }}>
              <button className="btn ghost sm" onClick={() => setShowConfig((v) => !v)}>
                {showConfig ? "Hide config" : "Show config JSON"}
              </button>
              <button
                className="btn ghost sm"
                onClick={() => { void navigator.clipboard?.writeText(configJson); }}
                title="Copy the ConfigParameters object for createConfig"
              >
                Copy config
              </button>
            </div>
            {showConfig ? (
              <pre className="mono" style={{ marginTop: 8, maxHeight: 260, overflow: "auto", fontSize: 10, lineHeight: 1.45, background: "rgba(0,0,0,0.25)", padding: 8, borderRadius: 6 }}>
                {configJson}
              </pre>
            ) : null}

            <div className="hint" style={{ marginTop: 12, lineHeight: 1.5 }}>
              This is a plan, not a launch. Rhea never signs or funds a pool — take the config to the
              Meteora SDK yourself, and set a leftover receiver you control before you do.
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
