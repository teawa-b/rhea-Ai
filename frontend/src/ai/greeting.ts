/* Greeting instruction (spec §23 scene 1) built from live app state. */
import type { RheaAuth } from "@/auth/Auth";
import { COMPANY_BY_ID } from "@shared/registry";
import { useMarket } from "@/state/market";

export function greetingFor(auth: RheaAuth, returning = false) {
  const m = useMarket.getState();
  const name = auth.displayName && !auth.displayName.includes("…") ? auth.displayName.split(" ")[0] : null;
  /* Someone who has used Rhea before in this browser gets a one-line welcome back, not the tour. */
  if (returning) return `Say this right now, without waiting for the user: one short, warm "welcome back"${name ? ` to ${name}` : ""} as Rhea — no introduction or examples, they already know the app. Then stop and listen.`;
  let portfolio = "";
  if (m.portfolio && m.portfolio.positions.length) {
    const top = m.portfolio.positions.slice(0, 3).map((p) => COMPANY_BY_ID[p.companyId]?.name ?? p.symbol).join(", ");
    portfolio = ` The user's portfolio is worth about $${m.portfolio.totalValueUsd.toFixed(0)} and includes ${top}.`;
  } else if (auth.authenticated) {
    portfolio = " The wallet is connected but holds no tokenized stocks yet.";
  } else {
    portfolio = " The user is not signed in; mention they can sign in whenever they want to trade.";
  }
  const countries = m.overview?.countries.length ?? 0;
  const assets = m.overview?.assets.length ?? 0;
  return `Say this right now, without waiting for the user: a quick, warm hello as Rhea${name ? ` (their name is ${name})` : ""} in two short sentences at most. Welcome them to the market globe${assets ? ` (${assets} tokenized stocks across ${countries} countries, live on Solana)` : ""} and say they can ask about any country or company, like "What's happening in China?" or "Show me Nvidia".${portfolio} Then stop and listen.`;
}
