/* Product analytics (spec §16.2) — privacy-preserving event counters.
 *
 * Events are aggregated locally (a ring buffer + counters in localStorage) and
 * printed with `window.rhea.analytics()`. No conversational text, wallet
 * addresses or trade sizes are recorded — only event names and coarse tags. */
import { useMarket } from "@/state/market";
import { useWorld } from "@/state/world";
import { useVoice } from "@/ai/voice";

export type AnalyticsEvent =
  | "login_completed" | "webxr_entered" | "country_explored" | "company_selected" | "ai_question"
  | "ai_tool_call" | "chart_interaction" | "news_shown" | "research_request" | "quote_requested"
  | "trade_prepared" | "trade_completed" | "trade_failed" | "order_created" | "error" | "session_length";

type Rec = { e: AnalyticsEvent; t: number; tag?: string };
const KEY = "rhea.analytics.v1";
let buf: Rec[] = [];
const counters: Record<string, number> = {};
try {
  const raw = localStorage.getItem(KEY);
  if (raw) { const saved = JSON.parse(raw) as { buf?: Rec[]; counters?: Record<string, number> }; buf = saved.buf ?? []; Object.assign(counters, saved.counters ?? {}); }
} catch { /* fresh */ }

function persist() {
  try { localStorage.setItem(KEY, JSON.stringify({ buf: buf.slice(-300), counters })); } catch { /* ignore */ }
}

export function track(e: AnalyticsEvent, tag?: string) {
  buf.push({ e, t: Date.now(), tag });
  if (buf.length > 300) buf = buf.slice(-300);
  counters[e] = (counters[e] ?? 0) + 1;
  persist();
  if (import.meta.env.DEV) console.debug("[analytics]", e, tag ?? "");
}

export function analyticsSummary() {
  return { counters: { ...counters }, recent: buf.slice(-20) };
}

/* Wire the stores once; keeps the tracking out of the components. */
let wired = false;
export function wireAnalytics() {
  if (wired) return;
  wired = true;
  const started = Date.now();
  useWorld.subscribe((s, p) => {
    if (s.focusedCountry && s.focusedCountry !== p.focusedCountry && s.view === "country") track("country_explored", s.focusedCountry);
    if (s.focusedCompany && s.focusedCompany !== p.focusedCompany) track("company_selected", s.focusedCompany);
    if (s.chartRange !== p.chartRange || s.chartMode !== p.chartMode || (s.chartFocusTs && s.chartFocusTs !== p.chartFocusTs)) track("chart_interaction", s.chartRange);
    if (s.news && s.news !== p.news) track("news_shown");
    if (s.impact && s.impact !== p.impact) track("research_request");
  });
  useMarket.subscribe((s, p) => {
    if (s.wallet && s.wallet !== p.wallet) track("login_completed");
    if (s.pendingTrade && s.pendingTrade !== p.pendingTrade) {
      if (s.pendingTrade.status === "awaiting_confirmation" && p.pendingTrade?.id !== s.pendingTrade.id) { track("quote_requested"); track("trade_prepared", s.pendingTrade.side); }
      if (s.pendingTrade.status === "confirmed" && p.pendingTrade?.status !== "confirmed") track("trade_completed", s.pendingTrade.side);
      if (s.pendingTrade.status === "failed" && p.pendingTrade?.status !== "failed") track("trade_failed");
    }
    if (s.orders.length > p.orders.length) track("order_created");
    if (s.lastError && s.lastError !== p.lastError) track("error", "market");
  });
  useVoice.subscribe((s, p) => {
    if (s.captions.length > p.captions.length && s.captions[s.captions.length - 1]?.role === "user") track("ai_question");
    if (s.lastTool && s.lastTool !== p.lastTool) track("ai_tool_call", s.lastTool);
    if (s.error && s.error !== p.error) track("error", "voice");
  });
  window.addEventListener("beforeunload", () => track("session_length", String(Math.round((Date.now() - started) / 1000))));
}
