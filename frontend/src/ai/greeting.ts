/* Greeting instruction (spec §23 scene 1) built from live app state. */
import type { RheaAuth } from "@/auth/Auth";
import { useMarket } from "@/state/market";

/* The evening habit Rhea is built around; also the first HUD suggestion chip. */
const STARTER = `"What changed while the market was closed?"`;

export function greetingFor(auth: RheaAuth, returning = false) {
  const m = useMarket.getState();
  const name = auth.displayName && !auth.displayName.includes("…") ? auth.displayName.split(" ")[0] : null;
  /* Any wallet in the store (signed in, or the read-only demo wallet) opens with its chain facts, first visit or
   * not: the briefing is the reason to come back. Chain facts only; headlines wait for a follow-up question. */
  const wallet = m.wallet ?? (auth.authenticated ? auth.address : null);
  if (wallet) {
    void m.loadBriefing(wallet); // prewarm, so the get_briefing call below lands on a warm cache
    /* ?demo=1: the visitor isn't signed in; this is a public wallet's real portfolio, so it must never sound like theirs. */
    const demo = m.demoMode && !auth.authenticated
      ? ` This visitor is not signed in: they are viewing Rhea's read-only demo portfolio (a public wallet that made real mainnet trades), not their own. Say "the demo portfolio", never "your portfolio", and after the briefing mention in a few words that they can sign in to trade their own wallet.`
      : "";
    return `Start right now, without waiting for the user. Say one short, warm line as Rhea${name ? ` to ${name}` : ""}${returning ? " with no introduction (they already know the app)" : ""}, such as "Here's what changed while the market was closed." Then delegate to the backend: call get_briefing first, and only get_briefing (no web_search for this opener). When it returns, speak chain facts only, in at most three short sentences, in this order: the portfolio value, the biggest move vs the 4pm close, any order status, any distribution (as the result words it), and reserves. Use the session wording the result gives. Then ask whether they want the news behind the biggest mover, and stop and listen.${demo}`;
  }
  if (returning) return `Say this right now, without waiting for the user: one short, warm "welcome back"${name ? ` to ${name}` : ""} as Rhea, no introduction, and suggest they ask ${STARTER}. Then stop and listen.`;
  const countries = m.overview?.countries.length ?? 0;
  const assets = m.overview?.assets.length ?? 0;
  /* Examples are fixed to names that are liquid and tradable today. */
  return `Say this right now, without waiting for the user: a quick, warm hello as Rhea${name ? ` (their name is ${name})` : ""} in two short sentences at most. Welcome them to the market globe${assets ? ` (${assets} tokenized stocks across ${countries} countries, live on Solana)` : ""} and suggest they ask ${STARTER} or "Why is Nvidia moving?". Use exactly these examples; don't invent others. They aren't signed in; they can sign in whenever they want to trade. Then stop and listen.`;
}
