/* Pure-canvas price chart (spec §5): line or candles, current-price marker,
 * market-open/closed state, event markers (news / corporate actions) and a
 * focus timestamp the AI can "scroll" to. Drawn into any 2D context, so the
 * same code feeds the desktop <canvas> and the in-headset texture. */
import type { Candle, ChartRange } from "@shared/types";
import type { ChartEvent } from "@/state/world";

export type ChartDrawOpts = {
  candles: Candle[];
  range: ChartRange;
  mode: "line" | "candles";
  currentPrice: number | null;
  marketOpen: boolean;
  events: ChartEvent[];
  focusTs: number | null; // ms
  source: string;
  width: number;
  height: number;
  dpr: number;
  ticker: string;
  /** Passthrough mode: no backdrop, heavier strokes, haloed text for legibility */
  ar?: boolean;
  /** 0..1 draw-in progress: the series is revealed left to right, markers fade in last. */
  reveal?: number;
};

const CY = "#3fe0ff", FR = "#8fe8ff", MG = "#ff2e88", GR = "#14F195", AM = "#ffb020", MUTED = "#8ea3bd";

function fmtPrice(v: number) {
  return v >= 1000 ? v.toLocaleString(undefined, { maximumFractionDigits: 0 }) : v >= 100 ? v.toFixed(1) : v.toFixed(2);
}
function fmtTime(t: number, range: ChartRange) {
  const d = new Date(t);
  if (range === "1D") return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  if (range === "5D" || range === "1M") return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  if (range === "3M" || range === "1Y") return d.toLocaleDateString(undefined, { month: "short", year: "2-digit" });
  return d.toLocaleDateString(undefined, { year: "numeric" });
}

export function drawChart(ctx: CanvasRenderingContext2D, o: ChartDrawOpts) {
  const { width: W, height: H, dpr } = o;
  ctx.save();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  const ar = Boolean(o.ar);
  /* Text halo so labels survive over a live camera feed. */
  const halo = () => { if (ar) { ctx.shadowColor = "rgba(0,0,0,0.9)"; ctx.shadowBlur = 4; } };
  const noHalo = () => { ctx.shadowBlur = 0; };

  const padL = 8, padR = 54, padT = 30, padB = 22;
  const iw = W - padL - padR, ih = H - padT - padB;

  /* Subtle grid */
  ctx.strokeStyle = ar ? "rgba(143,232,255,0.22)" : "rgba(63,224,255,0.09)";
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = padT + (ih * i) / 4;
    ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(W - padR, y); ctx.stroke();
  }

  const candles = o.candles;
  if (!candles.length) {
    ctx.fillStyle = MUTED; ctx.font = "12px Inter, system-ui, sans-serif"; ctx.textAlign = "center";
    ctx.fillText("Loading price history…", W / 2, H / 2);
    ctx.restore();
    return;
  }

  /* Focus window: when the AI focuses a timestamp, zoom to ±12% of the range around it. */
  let view = candles;
  if (o.focusTs) {
    const t0 = candles[0].t * 1000, t1 = candles[candles.length - 1].t * 1000;
    const span = Math.max(1, t1 - t0);
    const half = span * 0.14;
    const lo = Math.max(t0, o.focusTs - half), hi = Math.min(t1, o.focusTs + half);
    const sub = candles.filter((c) => c.t * 1000 >= lo && c.t * 1000 <= hi);
    if (sub.length >= 3) view = sub;
  }

  const tMin = view[0].t, tMax = view[view.length - 1].t;
  let lo = Infinity, hi = -Infinity;
  for (const c of view) { lo = Math.min(lo, c.l); hi = Math.max(hi, c.h); }
  if (o.currentPrice != null && !o.focusTs) { lo = Math.min(lo, o.currentPrice); hi = Math.max(hi, o.currentPrice); }
  const padY = (hi - lo) * 0.08 || 1;
  lo -= padY; hi += padY;
  const x = (t: number) => padL + ((t - tMin) / Math.max(1, tMax - tMin)) * iw;
  const y = (v: number) => padT + (1 - (v - lo) / (hi - lo)) * ih;

  const first = view[0].o, last = view[view.length - 1].c;
  const up = last >= first;
  const lineColor = up ? GR : MG;
  const reveal = Math.min(1, Math.max(0, o.reveal ?? 1));
  const overlayAlpha = Math.min(1, Math.max(0, (reveal - 0.8) / 0.2));

  ctx.save();
  if (reveal < 1) { ctx.beginPath(); ctx.rect(0, 0, padL + iw * reveal + 2, H); ctx.clip(); }
  if (o.mode === "line") {
    /* Gradient fill under the line */
    const grad = ctx.createLinearGradient(0, padT, 0, padT + ih);
    grad.addColorStop(0, up ? "rgba(74,222,128,0.28)" : "rgba(255,46,136,0.28)");
    grad.addColorStop(1, "rgba(63,224,255,0)");
    ctx.beginPath();
    view.forEach((c, i) => { const px = x(c.t), py = y(c.c); if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py); });
    ctx.lineTo(x(tMax), padT + ih); ctx.lineTo(x(tMin), padT + ih); ctx.closePath();
    ctx.fillStyle = grad; ctx.fill();

    ctx.beginPath();
    view.forEach((c, i) => { const px = x(c.t), py = y(c.c); if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py); });
    ctx.strokeStyle = lineColor; ctx.lineWidth = ar ? 3.2 : 1.8; ctx.lineJoin = "round";
    ctx.shadowColor = lineColor; ctx.shadowBlur = ar ? 14 : 8;
    ctx.stroke();
    if (ar) { ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 1; ctx.shadowBlur = 0; ctx.globalAlpha = 0.55; ctx.stroke(); ctx.globalAlpha = 1; }
    ctx.shadowBlur = 0;
  } else {
    const bw = Math.max(1.5, (iw / view.length) * 0.62);
    for (const c of view) {
      const cx = x(c.t);
      const col = c.c >= c.o ? GR : MG;
      ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(cx, y(c.h)); ctx.lineTo(cx, y(c.l)); ctx.stroke();
      const top = y(Math.max(c.o, c.c)), bot = y(Math.min(c.o, c.c));
      ctx.fillRect(cx - bw / 2, top, bw, Math.max(1, bot - top));
    }
  }
  ctx.restore();

  /* Event markers (labels stacked under the header so they never collide) */
  ctx.globalAlpha = overlayAlpha;
  ctx.font = "600 10px Inter, system-ui, sans-serif";
  let evRow = 0;
  for (const ev of o.events) {
    const ts = ev.timestamp / 1000;
    if (ts < tMin || ts > tMax) continue;
    const ex = x(ts);
    const col = ev.kind === "corporate_action" ? AM : ev.kind === "earnings" ? FR : CY;
    ctx.strokeStyle = col; ctx.setLineDash([3, 3]); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(ex, padT); ctx.lineTo(ex, padT + ih); ctx.stroke();
    ctx.setLineDash([]);
    /* nearest candle for the dot */
    let near = view[0];
    for (const c of view) if (Math.abs(c.t - ts) < Math.abs(near.t - ts)) near = c;
    ctx.fillStyle = col; ctx.beginPath(); ctx.arc(ex, y(near.c), 4, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(ex, y(near.c), 1.8, 0, Math.PI * 2); ctx.fill();
    const label = ev.title.length > 26 ? ev.title.slice(0, 25) + "…" : ev.title;
    const tw = ctx.measureText(label).width + 10;
    const ly = padT + 4 + (evRow++ % 3) * 15;
    const lx = Math.min(W - padR - tw, Math.max(padL, ex - tw / 2));
    ctx.fillStyle = "rgba(5,6,13,0.85)"; ctx.fillRect(lx, ly, tw, 14);
    ctx.strokeStyle = col; ctx.strokeRect(lx + 0.5, ly + 0.5, tw - 1, 13);
    ctx.fillStyle = col; ctx.textAlign = "left"; ctx.fillText(label, lx + 5, ly + 10.5);
  }

  /* Current price marker */
  if (o.currentPrice != null && !o.focusTs) {
    const py = y(o.currentPrice);
    ctx.setLineDash([2, 4]); ctx.strokeStyle = "rgba(255,255,255,0.45)"; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(padL, py); ctx.lineTo(W - padR, py); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = o.marketOpen ? CY : "#5b6d86";
    ctx.fillRect(W - padR + 4, py - 8, padR - 6, 16);
    ctx.fillStyle = "#05060d"; ctx.font = "700 10px 'JetBrains Mono', monospace"; ctx.textAlign = "center";
    ctx.fillText(fmtPrice(o.currentPrice), W - padR / 2 + 3, py + 3.5);
    /* pulse dot at line end */
    ctx.fillStyle = o.marketOpen ? CY : "#5b6d86";
    ctx.beginPath(); ctx.arc(x(tMax), y(last), 3.2, 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalAlpha = 1;

  /* Y labels */
  halo();
  ctx.fillStyle = ar ? "#dfe9f5" : MUTED; ctx.font = "10px 'JetBrains Mono', monospace"; ctx.textAlign = "left";
  ctx.fillText(fmtPrice(hi - padY), W - padR + 6, padT + 10);
  ctx.fillText(fmtPrice(lo + padY), W - padR + 6, padT + ih - 2);

  /* X labels */
  ctx.textAlign = "center"; ctx.fillStyle = ar ? "#dfe9f5" : MUTED; ctx.font = "10px Inter, system-ui, sans-serif";
  const n = 4;
  for (let i = 0; i <= n; i++) {
    const t = tMin + ((tMax - tMin) * i) / n;
    const label = fmtTime(t * 1000, o.range);
    ctx.textAlign = i === 0 ? "left" : i === n ? "right" : "center";
    ctx.fillText(label, x(t), H - 7);
  }

  /* Header row: ticker · range · session   |   data source */
  ctx.textAlign = "left"; ctx.font = "700 10px Inter, system-ui, sans-serif";
  ctx.fillStyle = FR;
  const head = `${o.ticker} · ${o.range}${o.focusTs ? " · FOCUS" : ""}`;
  ctx.fillText(head, padL + 2, 12);
  const headW = ctx.measureText(head).width;
  ctx.fillStyle = o.marketOpen ? GR : MUTED;
  ctx.fillText(o.marketOpen ? "● MARKET OPEN" : "○ MARKET CLOSED", padL + 2 + headW + 12, 12);
  ctx.textAlign = "right"; ctx.fillStyle = ar ? "#dfe9f5" : "rgba(142,163,189,0.75)"; ctx.font = "9px Inter, system-ui, sans-serif";
  ctx.fillText(`data: ${o.source}`, W - 6, 12);
  noHalo();
  ctx.restore();
}
