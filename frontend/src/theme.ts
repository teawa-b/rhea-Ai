/* Rhea palette — locked to the MegBall globe reference (cyan-on-void holographic). */
export const C = {
  void: "#05060d",
  ocean: "#0a0e1a",
  oceanDeep: "#070c1c",
  oceanLift: "#0a1428",
  panel: "#0b0f1c",
  line: "#1c2740",
  steel: "#2c3a5c",
  cyan: "#3fe0ff",
  cyanDeep: "#0a7ea4",
  frost: "#8fe8ff",
  violet: "#8b5cff",
  magenta: "#ff2e88",
  amber: "#ffb020",
  gold: "#ffd24a",
  green: "#14F195",      // Solana green
  red: "#ff5a6e",
  white: "#ffffff",
  /* Solana brand */
  sol: "#9945FF",        // Solana purple
  solDeep: "#5a1fb8",
  solGreen: "#14F195",
  solInk: "#12071f",
} as const;

/* Solana purple, deeper the more assets a country lists (0..1 intensity). */
export function assetTint(intensity: number): string {
  const t = Math.max(0, Math.min(1, intensity));
  const a = [63, 224, 255], b = [153, 69, 255];
  const c = a.map((v, i) => Math.round(v + (b[i] - v) * Math.pow(t, 0.55)));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

export const FONT = "'Inter', 'Segoe UI', system-ui, -apple-system, 'Helvetica Neue', Arial, sans-serif";
export const MONO = "'JetBrains Mono', 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace";

export const fmtUsd = (n: number | null | undefined, digits = 2) =>
  n == null || !Number.isFinite(n) ? "—" : n >= 1000 ? `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : `$${n.toFixed(digits)}`;
export const fmtPct = (n: number | null | undefined) =>
  n == null || !Number.isFinite(n) ? "—" : `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
export const fmtAge = (iso: string | null | undefined) => {
  if (!iso) return "no data";
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (s < 60) return `${Math.round(s)}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
};

/** Company-sized USD: private markets are discussed in billions and trillions. */
export const fmtValuation = (n: number | null | undefined) => {
  if (n == null || !Number.isFinite(n)) return "—";
  if (n >= 1e12) return `$${(n / 1e12).toFixed(2)}T`;
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(0)}M`;
  return fmtUsd(n);
};

/** Fee-sized USD: cents above a cent, otherwise tenths of a cent ("$0.001"), "<$0.001" below that. */
export const fmtFeeUsd = (n: number | null | undefined) =>
  n == null || !Number.isFinite(n) ? "—" : n === 0 ? "$0" : n >= 0.01 ? `$${n.toFixed(2)}` : n >= 0.001 ? `$${n.toFixed(3)}` : "<$0.001";
/** "1.2s" (whole seconds past 10 s). */
export const fmtSeconds = (ms: number) => `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`;
export const shortSig = (sig: string, n = 8) => (sig.length > n + 1 ? `${sig.slice(0, n)}…` : sig);
export const solscanTx = (sig: string) => `https://solscan.io/tx/${sig}`;

/* US Eastern wall clock (DST-aware via Intl) for receipts and session labels. */
const ET_PARTS = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
function etParts(d: Date) {
  const p = Object.fromEntries(ET_PARTS.formatToParts(d).map((x) => [x.type, x.value]));
  return { weekday: p.weekday ?? "", hour: Number(p.hour), minute: Number(p.minute) };
}
/** "Wed 22:41 ET" */
export const fmtEt = (iso: string | number | Date) => {
  const { weekday, hour, minute } = etParts(new Date(iso));
  return `${weekday} ${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")} ET`;
};
/** Session wording: weekends (ET) are "closed for the weekend"; weeknights only "regular session closed"
 * (xStocks still trade 24/5). With no live session flag, only clock-certain cases get a label: an early
 * close or holiday can't be told from the clock, so 9:30–16:00 on a weekday returns undefined. */
export function sessionLabel(marketSession: string | null | undefined, at: string | number | Date = Date.now()): string | undefined {
  const { weekday, hour, minute } = etParts(new Date(at));
  if (weekday === "Sat" || weekday === "Sun") return "US market closed for the weekend";
  if (marketSession === "regular") return "US regular session";
  if (marketSession === "pre_market" || marketSession === "post_market" || marketSession === "closed") return "regular session closed";
  const mins = hour * 60 + minute;
  return mins < 570 || mins >= 960 ? "regular session closed" : undefined;
}
