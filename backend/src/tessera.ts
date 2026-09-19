/* Tessera T-Token client (keyless public API: rest-api.tessera.pe/v1/public).
 *
 *   token-details    every live T-Token: mint, sector, issuer mark, mark valuation, holders   cache 60 s
 *
 * Tessera tokenizes exposure to private companies (SpaceX, Kalshi, OpenAI) as
 * SPL Token-2022 mints on Solana. Unlike an xStock there is no exchange behind
 * the token: the company is private, so the reference price is the *issuer's
 * mark* on the segregated portfolio, not a last trade. Rhea therefore treats a
 * T-Token's "underlying" as that mark and shows the premium the onchain market
 * is paying over it — see premiumToMark below.
 *
 * Failures resolve to null (never throw) so a slow issuer API degrades the
 * private-markets panel instead of breaking a price snapshot, and failures are
 * cached briefly so a down API isn't hammered by every request.
 */
import { TESSERA_DISCLOSURE_URL, TESSERA_ISSUER, TESSERA_RESTRICTED_JURISDICTIONS, TESSERA_TERMS_URL } from "../shared/registry";
import type { ReserveAttestation, TesseraMark } from "../shared/types";

export { TESSERA_DISCLOSURE_URL, TESSERA_ISSUER, TESSERA_RESTRICTED_JURISDICTIONS, TESSERA_TERMS_URL };

const TESSERA = "https://rest-api.tessera.pe/v1/public";
const TIMEOUT_MS = 4_000;
const DETAILS_TTL = 60_000;
const FAIL_TTL = 30_000;

type Slot<T> = { at: number; ttl: number; data: T | null; pending?: Promise<T | null> };
const cache = new Map<string, Slot<unknown>>();

/* One in-flight request per key, same contract as the xStocks client. */
function cached<T>(key: string, ttl: number, load: () => Promise<T | null>): Promise<T | null> {
  const hit = cache.get(key) as Slot<T> | undefined;
  if (hit?.pending) return hit.pending;
  if (hit && Date.now() - hit.at < hit.ttl) return Promise.resolve(hit.data);
  const pending = load().catch((e) => {
    console.warn(`[tessera] ${key} failed:`, (e as Error).message);
    return null;
  }).then((data) => {
    cache.set(key, { at: Date.now(), ttl: data == null ? FAIL_TTL : ttl, data });
    return data;
  });
  cache.set(key, { at: 0, ttl: 0, data: null, pending });
  return pending;
}

async function getJson<T>(path: string): Promise<T> {
  const r = await fetch(`${TESSERA}${path}`, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!r.ok) throw new Error(`Tessera ${r.status} ${path}`);
  return (await r.json()) as T;
}

const num = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/* ---------------- token-details ---------------- */

type RawTokenDetail = {
  id?: string; name?: string; symbol?: string; code?: string; sector?: string;
  mint?: string; markPrice?: number | string; holders?: number | string; markValuation?: number | string;
};

/** Every live T-Token, straight from the issuer. Null when the API is unreachable. */
export function tesseraTokens(): Promise<TesseraMark[] | null> {
  return cached("token-details", DETAILS_TTL, async () => {
    const raw = await getJson<RawTokenDetail[]>("/token-details");
    if (!Array.isArray(raw)) throw new Error("token-details was not an array");
    const marks = raw.flatMap((t): TesseraMark[] => {
      const mint = typeof t.mint === "string" ? t.mint.trim() : "";
      const symbol = typeof t.symbol === "string" ? t.symbol.trim() : "";
      if (!mint || !symbol) return [];
      return [{
        id: t.id?.trim() || symbol,
        name: t.name?.trim() || symbol,
        symbol,
        /* `code` is the onchain ticker Jupiter shows ("tOpenAI"); `symbol` is the
         * display name ("T-OpenAI"). Keep both — they are matched separately. */
        code: t.code?.trim() || symbol,
        sector: t.sector?.trim() || "Private company",
        mint,
        markPriceUsd: num(t.markPrice),
        markValuationUsd: num(t.markValuation),
        holders: num(t.holders),
        fetchedAt: new Date().toISOString(),
      }];
    });
    /* An empty array means "issuer listed nothing", which is never true while
     * three markets are live — treat it as a failure so we retry sooner. */
    return marks.length > 0 ? marks : null;
  });
}

/** One T-Token by mint. */
export async function tesseraByMint(mint: string): Promise<TesseraMark | null> {
  const all = await tesseraTokens();
  return all?.find((t) => t.mint === mint) ?? null;
}

/** One T-Token by either its display symbol ("T-OpenAI") or onchain code ("tOpenAI"). */
export async function tesseraBySymbol(symbol: string): Promise<TesseraMark | null> {
  const q = symbol.trim().toLowerCase();
  const all = await tesseraTokens();
  return all?.find((t) => t.symbol.toLowerCase() === q || t.code.toLowerCase() === q) ?? null;
}

/* ---------------- Mark vs market ----------------
 *
 * WARNING — do not substitute Jupiter's `stockData.price` for the issuer mark on
 * a T-Token. For Tessera mints Jupiter reports a cross-venue reference for the
 * *company* on a different notional basis than the token: on 19 Sep 2026
 * T-SpaceX marked at $423.00 per token at Tessera while Jupiter's stockData read
 * $762.36, and T-Kalshi marked at $413.80 against Jupiter's $893.17. Dividing an
 * onchain token price by that figure invents a 25-50% "discount" that does not
 * exist. Only Tessera's own markPrice is per-token and therefore comparable.
 */

/** Premium (+) or discount (-) of the onchain price against the issuer's mark, as a %. */
export function premiumToMark(tokenPriceUsd: number | null | undefined, markPriceUsd: number | null | undefined): number | null {
  if (!Number.isFinite(tokenPriceUsd as number) || !Number.isFinite(markPriceUsd as number)) return null;
  const mark = markPriceUsd as number;
  if (mark <= 0) return null;
  return (((tokenPriceUsd as number) / mark) - 1) * 100;
}

/** What the onchain price implies the whole company is worth, scaling the
 *  issuer's mark valuation by the premium the market is paying. */
export function impliedValuation(tokenPriceUsd: number | null | undefined, mark: TesseraMark | null | undefined): number | null {
  if (!mark?.markValuationUsd || !Number.isFinite(tokenPriceUsd as number)) return null;
  if (!mark.markPriceUsd || mark.markPriceUsd <= 0) return null;
  return mark.markValuationUsd * ((tokenPriceUsd as number) / mark.markPriceUsd);
}

/* ---------------- Proof of reserve ----------------
 * Tessera publishes Chainlink SmartData (DataLink) PoR streams per token. The
 * streams carry *asset counts* — units held in the Cayman segregated portfolio
 * versus T-Tokens in circulation — not dollar valuations, and the attestation
 * behind them is refreshed roughly monthly by independent auditors.
 * Docs: https://docs.tessera.pe/technicals/proof-of-reserve-por
 */
export const TESSERA_POR_STREAMS: Record<string, string> = {
  "T-SpaceX": "https://data.chain.link/streams/tspacex-usd-smartdata-datalink",
  "T-Kalshi": "https://data.chain.link/streams/tkalshi-usd-smartdata-datalink",
  "T-OpenAI": "https://data.chain.link/streams/topenai--nav-streams",
};

/** The PoR reference for a T-Token: where the feed lives and what it attests.
 *  Rhea links out rather than reading the stream — the numbers a viewer acts on
 *  should come from Chainlink's page, not a cached copy of it. */
export function tesseraProofOfReserve(symbol: string): ReserveAttestation | null {
  const url = TESSERA_POR_STREAMS[symbol];
  if (!url) return null;
  return {
    symbol,
    issuer: TESSERA_ISSUER,
    custodian: "Cayman Islands SPC, segregated portfolio per company",
    verifier: "Chainlink Proof of Reserve (SmartData / DataLink)",
    attestationUrl: url,
    /* Asset counts, refreshed ~monthly — deliberately no dollar figure and no
     * backed-% here, because a cached one would go stale between attestations. */
    note: "Chainlink publishes the attested unit count and circulating T-Token supply on Solana. The auditor attestation behind the feed refreshes about monthly, so it reflects the latest attested holdings rather than intra-month changes.",
  };
}

/* ---------------- Compliance + disclosure ----------------
 * T-Tokens are loan participation rights, not equity and not securities: the
 * holder lends to a Tessera issuer entity and is repaid from the proceeds of a
 * qualifying liquidity event. No ownership, no voting, no dividends, no place on
 * the company's cap table. Rhea states this before any T-Token trade.
 * Docs: https://docs.tessera.pe/overview/how-do-tessera-token-work
 */
export const TESSERA_DISCLOSURE =
  "T-Tokens are loan participation rights issued by a Tessera issuer entity, not shares and not securities. " +
  "Holding one gives you a contractual right to a share of the proceeds if a qualifying liquidity event happens " +
  "(an IPO or acquisition) — it gives you no ownership, no voting rights, no dividends and no place on the company's cap table. " +
  "The exposure sits in a segregated portfolio of a Cayman Islands SPC and your claim is against the issuer entity, not the company itself. " +
  "The company is private, so there is no exchange price: the reference is Tessera's own mark, refreshed by the issuer, " +
  "and the onchain price can trade well above or below it. Tessera's terms exclude several jurisdictions, including the United States and China.";

/** One sentence the voice agent can say aloud before a T-Token trade. */
export const TESSERA_DISCLOSURE_SHORT =
  "T-Tokens are loan participation rights against a Tessera issuer entity, not shares — no ownership, no voting, no dividends — and the price you pay onchain can differ a lot from Tessera's published mark.";
