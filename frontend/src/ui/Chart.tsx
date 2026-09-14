import { useEffect, useRef } from "react";
import type { ChartRange } from "@shared/types";
import { useMarket } from "@/state/market";
import { useWorld } from "@/state/world";
import { drawChart } from "./chartDraw";

const RANGES: ChartRange[] = ["1D", "5D", "1M", "3M", "1Y", "5Y", "MAX"];

export function Chart({ companyId, ticker }: { companyId: string; ticker: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const range = useWorld((s) => s.chartRange);
  const mode = useWorld((s) => s.chartMode);
  const focusTs = useWorld((s) => s.chartFocusTs);
  const events = useWorld((s) => s.chartEvents);
  const setChartRange = useWorld((s) => s.setChartRange);
  const setChartMode = useWorld((s) => s.setChartMode);
  const focusChartTimestamp = useWorld((s) => s.focusChartTimestamp);
  const history = useMarket((s) => s.histories[`${companyId}:${range}`]);
  const detail = useMarket((s) => s.details[companyId]);
  const loadHistory = useMarket((s) => s.loadHistory);

  useEffect(() => {
    void loadHistory(companyId, range);
    const h = setInterval(() => void loadHistory(companyId, range, true), range === "1D" ? 60_000 : 300_000);
    return () => clearInterval(h);
  }, [companyId, range, loadHistory]);

  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const draw = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = cv.clientWidth || 380, h = cv.clientHeight || 190;
      if (cv.width !== w * dpr || cv.height !== h * dpr) { cv.width = w * dpr; cv.height = h * dpr; }
      const ctx = cv.getContext("2d");
      if (!ctx) return;
      drawChart(ctx, {
        candles: history?.candles ?? [],
        range, mode,
        currentPrice: detail?.price.underlyingPriceUsd ?? detail?.price.tokenPriceUsd ?? null,
        marketOpen: detail?.price.marketSession === "regular",
        events: events.filter((e) => e.companyId === companyId),
        focusTs, width: w, height: h, dpr, ticker,
        source: history ? (history.source === "pyth" ? "Pyth Pro" : "Yahoo Finance (fallback)") : "—",
      });
    };
    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(cv);
    return () => ro.disconnect();
  }, [history, range, mode, focusTs, events, detail, companyId, ticker]);

  return (
    <div className="chart-wrap">
      <canvas ref={ref} />
      <div className="ranges">
        {RANGES.map((r) => <button key={r} className={r === range ? "on" : ""} onClick={() => { setChartRange(r); focusChartTimestamp(null); }}>{r}</button>)}
        <button className={mode === "candles" ? "on" : ""} onClick={() => setChartMode(mode === "line" ? "candles" : "line")} title="Toggle candles">{mode === "line" ? "◫" : "∿"}</button>
        {focusTs ? <button className="on" onClick={() => focusChartTimestamp(null)} title="Clear focus">✕</button> : null}
      </div>
    </div>
  );
}
