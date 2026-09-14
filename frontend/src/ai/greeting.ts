/* Greeting instruction (spec §23 scene 1) built from live app state. */
import type { RheaAuth } from "@/auth/Auth";
import { COMPANY_BY_ID } from "@shared/registry";
import { useMarket } from "@/state/market";

export function greetingFor(auth: RheaAuth) {
  const m = useMarket.getState();
  const name = auth.displayName && !auth.displayName.includes("…") ? auth.displayName.split(" ")[0] : null;
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
  return `Greet the user now in English, without waiting for them to speak, in one or two short sentences as Rhea${name ? ` (their name is ${name})` : ""}. Welcome them to the market globe: there are ${assets} tokenized stocks across ${countries} countries live on Solana. Invite them to ask about any country or company, for example "What's happening in China?" or "Show me Nvidia".${portfolio} Then pause and listen.`;
}
