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
