/* The world store — single source of truth for what the 3D scene shows.
 *
 * AI tools, the HUD and pointer input all mutate this; the scene components
 * subscribe to it. Keeping it flat and serialisable also lets us send a
 * compact "UI context" summary to the voice model (GPT-Live share-UI-context).
 */
import { create } from "zustand";
import type { ChartRange, CountryCode, ImpactAnalysis, NewsEvent } from "@shared/types";
import { COMPANY_BY_ID, COUNTRIES, resolveCompany, resolveCountry } from "@shared/registry";
import { REGION_BY_ID, resolveRegion } from "./regions";

export type ViewMode = "world" | "region" | "country" | "company";

/* Who asked for the focus. On phones the side panel is a bottom sheet: a user
 * tap (a globe marker, a list row, the holdings chip) opens it outright, while
 * Rhea narrating her way around the world leaves it collapsed to a peek bar so
 * the globe keeps the screen. Desktop shows the panel either way. */
export type FocusSource = "user" | "ai";

export type Connection = {
  id: string;
  from: { lat: number; lng: number; label: string };
  to: { lat: number; lng: number; label: string };
  label?: string;
  sentiment: "negative" | "positive" | "neutral";
  createdAt: number;
};

export type ChartEvent = {
  id: string;
  companyId: string;
  timestamp: number; // ms
  title: string;
  kind: "news" | "earnings" | "corporate_action" | "macro";
  url?: string;
};

export type Comparison = { companyIds: string[] } | null;

type WorldState = {
  view: ViewMode;
  /** REGIONS id when view === "region" */
  focusedRegion: string | null;
  focusedCountry: CountryCode | null;
  focusedCompany: string | null;
  highlightedCountries: CountryCode[];
  highlightedCompanies: string[];
  /** country → 0..1 intensity for exposure heat */
  countryHeat: Partial<Record<CountryCode, number>>;
  connections: Connection[];
  chartRange: ChartRange;
  chartMode: "line" | "candles";
  chartFocusTs: number | null;
  chartEvents: ChartEvent[];
  /** `wire`: loaded by the app the moment a place was focused; the voice model's show_news replaces it. */
  news: { target: string; items: NewsEvent[]; wire?: boolean } | null;
  /** Target whose wire is being fetched (the panels show a searching line meanwhile). */
  newsPending: string | null;
  impact: ImpactAnalysis | null;
  comparison: Comparison;
  streetViewCompany: string | null;
  /** False while the camera is still flying to a newly focused place; the side
   * panel waits for arrival so the globe moves first and the panel follows. */
  panelReady: boolean;
  /** Phones only: whether the bottom sheet is expanded (see FocusSource). */
  panelOpen: boolean;
  /** True while the camera is away at the holdings planet (stock buildings, USDC and SOL in orbit). */
  vault: boolean;
  /** The pre-IPO panel: private companies, their issuer marks and the premium
   *  the onchain market is paying over them. */
  privateMarkets: boolean;
  /** The Meteora DBC studio. Holds the company its curve is anchored on, or ""
   *  for an unanchored curve; null when closed. */
  dbcStudio: string | null;
  /** Bumps whenever something the AI should know about changes (for UI context). */
  contextVersion: number;

  revealPanel: () => void;
  setPanelOpen: (open: boolean) => void;
  /** Fly to the holdings planet; any focus / reset brings the camera back to Earth. */
  showHoldings: (src?: FocusSource) => void;
  /** Open (or close) the pre-IPO panel. */
  showPrivateMarkets: (on?: boolean, src?: FocusSource) => void;
  /** Open the DBC studio, optionally anchored on a company; null closes it. */
  showDbcStudio: (companyId?: string | null, src?: FocusSource) => void;
  focusRegion: (q: string, src?: FocusSource) => string | null;
  focusCountry: (q: string, src?: FocusSource) => CountryCode | null;
  focusCompany: (q: string, src?: FocusSource) => string | null;
  resetGlobe: (clear?: boolean) => void;
  highlightCountries: (qs: string[]) => CountryCode[];
  highlightCompanies: (qs: string[]) => string[];
  setCountryHeat: (heat: Partial<Record<CountryCode, number>>) => void;
  drawConnection: (from: string, to: string, label?: string, sentiment?: Connection["sentiment"]) => Connection | null;
  clearConnections: () => void;
  showChart: (q: string, range: ChartRange, mode?: "line" | "candles") => string | null;
  setChartRange: (range: ChartRange) => void;
  setChartMode: (mode: "line" | "candles") => void;
  focusChartTimestamp: (ts: number | null) => void;
  addChartEvent: (ev: Omit<ChartEvent, "id">) => ChartEvent;
  showNews: (target: string, items: NewsEvent[], wire?: boolean) => void;
  setNewsPending: (target: string | null) => void;
  showImpact: (impact: ImpactAnalysis | null) => void;
  compareCompanies: (qs: string[]) => string[];
  showStreetView: (companyId: string | null) => void;
};

let idCounter = 0;
const nextId = (p: string) => `${p}_${++idCounter}_${Date.now().toString(36)}`;

/* The camera reveals the panel on arrival; this guarantees it appears even if
 * the 3D scene never runs (no WebGL, lost context, paused frames). Longest
 * flight is ~2.5 s. */
const REVEAL_FALLBACK_MS = 3200;
let revealTimer: ReturnType<typeof setTimeout> | undefined;
const holdPanelUntilArrival = () => {
  clearTimeout(revealTimer);
  revealTimer = setTimeout(() => useWorld.getState().revealPanel(), REVEAL_FALLBACK_MS);
  return false;
};

/** Resolve "Nvidia" / "China" / "TSMx" to a lat/lng + label. */
export function resolvePlace(q: string): { lat: number; lng: number; label: string; kind: "country" | "company"; id: string } | null {
  /* Countries win on an exact name/alias; companies otherwise. */
  const cdExact = resolveCountry(q);
  const co = resolveCompany(q);
  const cd = cdExact && (!co || cdExact.name.toLowerCase() === q.trim().toLowerCase() || q.trim().length <= 3) ? cdExact : null;
  if (cd) return { lat: cd.lat, lng: cd.lng, label: cd.name, kind: "country", id: cd.code };
  if (co) {
    const hq = co.headquarters ?? COUNTRIES[co.countryCode];
    return { lat: hq.lat, lng: hq.lng, label: co.name, kind: "company", id: co.id };
  }
  if (cdExact) return { lat: cdExact.lat, lng: cdExact.lng, label: cdExact.name, kind: "country", id: cdExact.code };
  return null;
}

export const useWorld = create<WorldState>((set, get) => ({
  view: "world",
  focusedRegion: null,
  focusedCountry: null,
  focusedCompany: null,
  highlightedCountries: [],
  highlightedCompanies: [],
  countryHeat: {},
  connections: [],
  chartRange: "1M",
  chartMode: "line",
  chartFocusTs: null,
  chartEvents: [],
  news: null,
  newsPending: null,
  impact: null,
  comparison: null,
  streetViewCompany: null,
  panelReady: true,
  panelOpen: true,
  vault: false,
  privateMarkets: false,
  dbcStudio: null,
  contextVersion: 0,

  revealPanel: () => { clearTimeout(revealTimer); set({ panelReady: true }); },
  setPanelOpen: (open) => set({ panelOpen: open }),
  showHoldings: (src = "ai") => {
    clearTimeout(revealTimer);
    /* Leave any focused place so Earth is back at the world view on return. */
    set((s) => ({ vault: true, view: "world", focusedRegion: null, focusedCountry: null, focusedCompany: null, comparison: null, streetViewCompany: null, privateMarkets: false, dbcStudio: null, panelReady: true, panelOpen: src === "user", contextVersion: s.contextVersion + 1 }));
  },

  showPrivateMarkets: (on = true, src = "ai") => {
    clearTimeout(revealTimer);
    set((s) => ({
      privateMarkets: on,
      ...(on ? { vault: false, comparison: null, dbcStudio: null, panelReady: true, panelOpen: src === "user" } : {}),
      contextVersion: s.contextVersion + 1,
    }));
  },

  showDbcStudio: (companyId = "", src = "ai") => {
    clearTimeout(revealTimer);
    set((s) => ({
      dbcStudio: companyId,
      ...(companyId != null ? { vault: false, comparison: null, privateMarkets: false, panelReady: true, panelOpen: src === "user" } : {}),
      contextVersion: s.contextVersion + 1,
    }));
  },

  focusRegion: (q, src = "ai") => {
    const region = resolveRegion(q);
    if (!region) return null;
    set((s) => ({
      view: "region",
      vault: false,
      focusedRegion: region.id,
      focusedCountry: null,
      focusedCompany: null,
      panelReady: s.view === "region" && s.focusedRegion === region.id ? s.panelReady : holdPanelUntilArrival(),
      panelOpen: src === "user",
      highlightedCountries: [...new Set([...s.highlightedCountries, ...region.countries])],
      comparison: null,
      streetViewCompany: null,
      contextVersion: s.contextVersion + 1,
    }));
    return region.id;
  },

  focusCountry: (q, src = "ai") => {
    const cd = resolveCountry(q);
    if (!cd) return null;
    set((s) => ({
      view: "country",
      vault: false,
      focusedRegion: null,
      focusedCountry: cd.code,
      focusedCompany: null,
      panelReady: s.view === "country" && s.focusedCountry === cd.code ? s.panelReady : holdPanelUntilArrival(),
      panelOpen: src === "user",
      highlightedCountries: s.highlightedCountries.includes(cd.code) ? s.highlightedCountries : [...s.highlightedCountries, cd.code],
      comparison: null,
      streetViewCompany: null,
      contextVersion: s.contextVersion + 1,
    }));
    return cd.code;
  },

  focusCompany: (q, src = "ai") => {
    const co = resolveCompany(q);
    if (!co) return null;
    set((s) => ({
      view: "company",
      vault: false,
      focusedRegion: null,
      focusedCompany: co.id,
      focusedCountry: co.countryCode,
      panelReady: s.view === "company" && s.focusedCompany === co.id ? s.panelReady : holdPanelUntilArrival(),
      panelOpen: src === "user",
      highlightedCompanies: s.highlightedCompanies.includes(co.id) ? s.highlightedCompanies : [...s.highlightedCompanies, co.id],
      chartFocusTs: null,
      comparison: null,
      streetViewCompany: null,
      contextVersion: s.contextVersion + 1,
    }));
    return co.id;
  },

  resetGlobe: (clear = false) => {
    clearTimeout(revealTimer);
    set((s) => ({
      view: "world",
      vault: false,
      focusedRegion: null,
      focusedCountry: null,
      focusedCompany: null,
      comparison: null,
      streetViewCompany: null,
      privateMarkets: false,
      dbcStudio: null,
      panelReady: true,
      panelOpen: false,
      ...(clear ? { highlightedCountries: [], highlightedCompanies: [], connections: [], countryHeat: {}, news: null, impact: null, chartEvents: [] } : {}),
      contextVersion: s.contextVersion + 1,
    }));
  },

  highlightCountries: (qs) => {
    const codes = qs.map((q) => resolveCountry(q)?.code).filter(Boolean) as CountryCode[];
    set((s) => ({ highlightedCountries: [...new Set([...s.highlightedCountries, ...codes])], contextVersion: s.contextVersion + 1 }));
    return codes;
  },

  highlightCompanies: (qs) => {
    const ids = qs.map((q) => resolveCompany(q)?.id).filter(Boolean) as string[];
    set((s) => ({ highlightedCompanies: [...new Set([...s.highlightedCompanies, ...ids])] }));
    return ids;
  },

  setCountryHeat: (heat) => set({ countryHeat: heat }),

  drawConnection: (fromQ, toQ, label, sentiment = "neutral") => {
    const from = resolvePlace(fromQ);
    const to = resolvePlace(toQ);
    if (!from || !to) return null;
    const conn: Connection = {
      id: nextId("conn"),
      from: { lat: from.lat, lng: from.lng, label: from.label },
      to: { lat: to.lat, lng: to.lng, label: to.label },
      label,
      sentiment,
      createdAt: Date.now(),
    };
    set((s) => ({
      connections: [...s.connections.slice(-11), conn],
      highlightedCountries: [...new Set([...s.highlightedCountries, ...([from, to].filter((p) => p.kind === "country").map((p) => p.id as CountryCode))])],
      highlightedCompanies: [...new Set([...s.highlightedCompanies, ...([from, to].filter((p) => p.kind === "company").map((p) => p.id))])],
    }));
    return conn;
  },

  clearConnections: () => set({ connections: [] }),

  showChart: (q, range, mode) => {
    const co = resolveCompany(q);
    if (!co) return null;
    const cur = get();
    if (cur.focusedCompany !== co.id) cur.focusCompany(co.id);
    set((s) => ({ chartRange: range, chartMode: mode ?? s.chartMode, contextVersion: s.contextVersion + 1 }));
    return co.id;
  },
  setChartRange: (range) => set({ chartRange: range }),
  setChartMode: (mode) => set({ chartMode: mode }),
  focusChartTimestamp: (ts) => set({ chartFocusTs: ts }),
  addChartEvent: (ev) => {
    const full: ChartEvent = { ...ev, id: nextId("ev") };
    set((s) => ({ chartEvents: [...s.chartEvents.filter((e) => !(e.companyId === ev.companyId && Math.abs(e.timestamp - ev.timestamp) < 60_000 && e.title === ev.title)), full].slice(-20) }));
    return full;
  },
  showNews: (target, items, wire) => set((s) => {
    /* The wire never overwrites what the model chose to show for the same place. */
    if (wire && s.news && !s.news.wire && s.news.target === target) return { newsPending: null };
    return { news: { target, items, wire }, newsPending: null, contextVersion: s.contextVersion + 1 };
  }),
  setNewsPending: (target) => set({ newsPending: target }),
  showImpact: (impact) => set({ impact }),
  compareCompanies: (qs) => {
    const ids = [...new Set(qs.map((q) => resolveCompany(q)?.id).filter(Boolean) as string[])].slice(0, 4);
    if (ids.length < 2) return ids;
    set((s) => ({
      comparison: { companyIds: ids },
      highlightedCompanies: [...new Set([...s.highlightedCompanies, ...ids])],
      view: "world",
      vault: false,
      focusedRegion: null,
      focusedCompany: null,
      focusedCountry: null,
      panelReady: true,
      panelOpen: false,
      contextVersion: s.contextVersion + 1,
    }));
    return ids;
  },
  showStreetView: (companyId) => set({ streetViewCompany: companyId }),
}));

/** Compact plain-text summary for the voice model (kept well under 500 tokens). */
export function describeWorld(): string {
  const s = useWorld.getState();
  const parts: string[] = [];
  parts.push(`View: ${s.view}.`);
  if (s.vault) parts.push("Showing the holdings planet instead of Earth: each stock position is a building on it, USDC and SOL orbit as balls.");
  if (s.focusedRegion) parts.push(`Focused region: ${REGION_BY_ID[s.focusedRegion]?.name}.`);
  if (s.focusedCountry) parts.push(`Focused country: ${COUNTRIES[s.focusedCountry].name}.`);
  if (s.focusedCompany) {
    const co = COMPANY_BY_ID[s.focusedCompany];
    parts.push(`Focused company: ${co.name} (${co.ticker}, token ${co.tokenSymbol}); chart range ${s.chartRange}.`);
  }
  if (s.comparison) parts.push(`Comparing: ${s.comparison.companyIds.map((id) => COMPANY_BY_ID[id]?.name).join(", ")}.`);
  if (s.highlightedCountries.length) parts.push(`Highlighted countries: ${s.highlightedCountries.map((c) => COUNTRIES[c].name).join(", ")}.`);
  if (s.connections.length) parts.push(`Arcs drawn: ${s.connections.slice(-4).map((c) => `${c.from.label}→${c.to.label}${c.label ? ` (${c.label})` : ""}`).join("; ")}.`);
  if (!s.panelOpen && typeof window !== "undefined" && window.matchMedia("(max-width: 600px)").matches) {
    parts.push("On this phone the detail panel is collapsed to a peek bar at the bottom so the globe stays visible; the user can tap it to open the panel.");
  }
  if (s.news) parts.push(`${s.news.wire ? "Wire headlines already on screen" : "News cards shown"} for ${s.news.target}: ${s.news.items.slice(0, 3).map((n) => `${n.title} (${n.source})`).join(" | ")}.`);
  return parts.join(" ");
}
