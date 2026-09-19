/* PreStocks client (keyless public API: prestocks.com/api/prestocks).
 *
 * PreStocks tokenizes exposure to private, pre-IPO companies — OpenAI,
 * Anthropic, SpaceX, Anduril, Neuralink, Figure AI, Kalshi, Polymarket — as SPL
 * mints on Solana. Each token is described by the issuer as backed 1:1 by SPV
 * exposure that tracks the price of the underlying private company.
 *
 * One call returns everything Rhea needs per token:
 *
 *   markPrice         the issuer's mark per token — the reference price, since
 *                     a private company has no exchange quote
 *   tokenPrice        the onchain price (matches Jupiter Price v3 to the cent)
 *   markValuation     what the issuer marks the whole company at
 *   impliedValuation  markValuation scaled by tokenPrice / markPrice
 *
 * The premium the market is paying over the mark is the number worth leading
 * with, and it is currently wide in both directions: on 19 Sep 2026 Neuralink
 * traded +31% over mark while SpaceX sat 20% under it.
 *
 * Failures resolve to null (never throw) so a slow issuer API degrades the
 * private-markets panel instead of breaking a price snapshot, and failures are
 * cached briefly so a down API isn't hammered by every request.
 */
import {
  PRESTOCKS_DISCLOSURE_URL, PRESTOCKS_ISSUER, PRESTOCKS_RESTRICTED_JURISDICTIONS, PRESTOCKS_TERMS_URL,
} from "../shared/registry";
import type { PreStockMark } from "../shared/types";

export { PRESTOCKS_DISCLOSURE_URL, PRESTOCKS_ISSUER, PRESTOCKS_RESTRICTED_JURISDICTIONS, PRESTOCKS_TERMS_URL };

const PRESTOCKS = "https://prestocks.com/api/prestocks";
const TIMEOUT_MS = 4_000;
const CATALOG_TTL = 60_000;
const FAIL_TTL = 30_000;

type Slot<T> = { at: number; ttl: number; data: T | null; pending?: Promise<T | null> };
const cache = new Map<string, Slot<unknown>>();

/* One in-flight request per key, same contract as the xStocks client. */
function cached<T>(key: string, ttl: number, load: () => Promise<T | null>): Promise<T | null> {
  const hit = cache.get(key) as Slot<T> | undefined;
  if (hit?.pending) return hit.pending;
  if (hit && Date.now() - hit.at < hit.ttl) return Promise.resolve(hit.data);
  const pending = load().catch((e) => {
    console.warn(`[prestocks] ${key} failed:`, (e as Error).message);
    return null;
  }).then((data) => {
    cache.set(key, { at: Date.now(), ttl: data == null ? FAIL_TTL : ttl, data });
    return data;
  });
  cache.set(key, { at: 0, ttl: 0, data: null, pending });
  return pending;
}

const num = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

type RawPreStock = {
  name?: string; symbol?: string; description?: string; image?: string; external_url?: string;
  contract_address?: string; markPrice?: number | string; markValuation?: number | string;
  tokenPrice?: number | string; impliedValuation?: number | string; supply?: number | string;
};

/** Every live PreStock, straight from the issuer. Null when unreachable. */
export function preStocksCatalog(): Promise<PreStockMark[] | null> {
  return cached("catalog", CATALOG_TTL, async () => {
    const r = await fetch(PRESTOCKS, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!r.ok) throw new Error(`PreStocks ${r.status}`);
    const raw = (await r.json()) as RawPreStock[];
    if (!Array.isArray(raw)) throw new Error("catalog was not an array");
    const marks = raw.flatMap((t): PreStockMark[] => {
      const mint = typeof t.contract_address === "string" ? t.contract_address.trim() : "";
      const symbol = typeof t.symbol === "string" ? t.symbol.trim() : "";
      if (!mint || !symbol) return [];
      return [{
        name: t.name?.trim() || symbol,
        symbol,
        mint,
        /* The issuer's blurb ends with the standing "backed 1:1 by SPV exposure"
         * sentence; the paragraph before it describes the company. */
        description: (t.description ?? "").split("\n").filter(Boolean)[0] ?? "",
        image: t.image?.trim() || undefined,
        url: t.external_url?.trim() || undefined,
        markPriceUsd: num(t.markPrice),
        markValuationUsd: num(t.markValuation),
        tokenPriceUsd: num(t.tokenPrice),
        impliedValuationUsd: num(t.impliedValuation),
        supply: num(t.supply),
        fetchedAt: new Date().toISOString(),
      }];
    });
    /* An empty array means "the issuer listed nothing", which is never true
     * while the markets are live — treat it as a failure so we retry sooner. */
    return marks.length > 0 ? marks : null;
  });
}

export async function preStockByMint(mint: string): Promise<PreStockMark | null> {
  const all = await preStocksCatalog();
  return all?.find((t) => t.mint === mint) ?? null;
}

export async function preStockBySymbol(symbol: string): Promise<PreStockMark | null> {
  const q = symbol.trim().toUpperCase();
  const all = await preStocksCatalog();
  return all?.find((t) => t.symbol.toUpperCase() === q) ?? null;
}

/* ---------------- Mark vs market ----------------
 *
 * Both figures are per token, so they are directly comparable — unlike Jupiter's
 * `stockData`, which for these mints reports a company-level reference on its
 * own basis and must not be substituted for the issuer mark.
 */

/** Premium (+) or discount (-) of the onchain price against the issuer's mark, as a %. */
export function premiumToMark(tokenPriceUsd: number | null | undefined, markPriceUsd: number | null | undefined): number | null {
  if (!Number.isFinite(tokenPriceUsd as number) || !Number.isFinite(markPriceUsd as number)) return null;
  const mark = markPriceUsd as number;
  if (mark <= 0) return null;
  return (((tokenPriceUsd as number) / mark) - 1) * 100;
}

/** What the onchain price implies the whole company is worth.
 *
 *  PreStocks publishes `impliedValuation` itself, but against *its* snapshot of
 *  the token price. We recompute from the executable Jupiter price so the
 *  premium and the valuation on screen always agree with each other; the formula
 *  is the issuer's own and reproduces their figure exactly when the two prices
 *  match. Falls back to the published number if there is no live price. */
export function impliedValuation(tokenPriceUsd: number | null | undefined, mark: PreStockMark | null | undefined): number | null {
  if (!mark) return null;
  if (!Number.isFinite(tokenPriceUsd as number)) return mark.impliedValuationUsd;
  if (!mark.markValuationUsd || !mark.markPriceUsd || mark.markPriceUsd <= 0) return mark.impliedValuationUsd;
  return mark.markValuationUsd * ((tokenPriceUsd as number) / mark.markPriceUsd);
}

/* ---------------- Disclosure ----------------
 * Taken from the issuer's own standing disclosure rather than paraphrased, so
 * what Rhea shows is what PreStocks says. Two points matter most for a holder:
 * the token carries economic exposure only, and it is not affiliated with or
 * endorsed by the company it references.
 */
export const PRESTOCKS_DISCLOSURE =
  "PreStocks are issuer tokens backed 1:1 by SPV exposure that tracks the price of the underlying private company. " +
  "They provide economic exposure only and confer no ownership, voting, dividend, information or other legal rights. " +
  "They are not affiliated with, endorsed by, or issued by the companies they reference. " +
  "They are risky investments that may result in total loss, and they have no guaranteed secondary-market liquidity. " +
  "The company is private, so there is no exchange price: the reference is PreStocks' own mark, and the onchain price " +
  "can trade well above or below it. PreStocks are not available in the U.S., to U.S. persons, or to other ineligible persons.";

/** One sentence the voice agent can say aloud before a PreStocks trade. */
export const PRESTOCKS_DISCLOSURE_SHORT =
  "PreStocks give economic exposure to a private company and nothing else — no ownership, no voting, no dividends — they are not endorsed by the company, and the price you pay onchain can differ a lot from the issuer's published mark.";
