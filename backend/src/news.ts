/* Headline wire — keyless Google News RSS, cached.
 *
 * The voice model finds the *best* news with web_search and shows it with
 * show_news, but that round trip takes many seconds. This gives the client
 * something real to put up within a second of a place being focused: recent
 * headlines with sources and links, which the model's picks then replace.
 * Also proxies source favicons so the headset (WebGL, CORS) can draw them. */
import type { NewsEvent } from "../shared/types";

const TTL_MS = 10 * 60_000;
const cache = new Map<string, { at: number; data: Promise<NewsEvent[]> }>();

const decode = (s: string) => s
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
  .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&#39;|&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
  .trim();
const tag = (xml: string, name: string) => { const m = xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`)); return m ? decode(m[1]) : ""; };

/** Recent headlines for a free-text query, newest first, at most `limit`. Never throws: an empty list on failure. */
export function newsFor(query: string, limit = 6): Promise<NewsEvent[]> {
  const q = query.trim().slice(0, 120);
  const key = `${q.toLowerCase()}:${limit}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.data;
  const slot = { at: Date.now(), data: Promise.resolve<NewsEvent[]>([]) };
  slot.data = fetchRss(q, limit).catch((e: Error) => { console.warn("[news] wire failed:", e.message); cache.delete(key); return []; });
  cache.set(key, slot);
  return slot.data;
}

async function fetchRss(q: string, limit: number): Promise<NewsEvent[]> {
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(`${q} when:7d`)}&hl=en-US&gl=US&ceid=US:en`;
  const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (Rhea market interface)" }, signal: AbortSignal.timeout(6_000) });
  if (!r.ok) throw new Error(`google news ${r.status}`);
  const xml = await r.text();
  const items = xml.split("<item>").slice(1);
  const out: NewsEvent[] = [];
  for (const it of items) {
    const source = tag(it, "source");
    const sourceUrl = (it.match(/<source\s+url="([^"]+)"/) ?? [])[1];
    let title = tag(it, "title");
    /* Google appends " - Source" to every title. */
    if (source && title.endsWith(` - ${source}`)) title = title.slice(0, -(source.length + 3));
    const link = tag(it, "link");
    const pub = Date.parse(tag(it, "pubDate"));
    if (!title || !link) continue;
    out.push({
      id: `wire_${Buffer.from(link).toString("base64url").slice(-16)}`,
      companyIds: [], countryCodes: [],
      title: title.slice(0, 160), source: source.slice(0, 60), url: link, sourceUrl: sourceUrl ? decode(sourceUrl) : undefined,
      publishedAt: Number.isFinite(pub) ? new Date(pub).toISOString() : new Date().toISOString(),
    });
    if (out.length >= limit) break;
  }
  return out;
}

/* ---------------- favicons ---------------- */

const iconCache = new Map<string, { at: number; body: Buffer | null; type: string }>();
const ICON_TTL_MS = 24 * 3_600_000;

/** A source site's favicon (Google's s2 service), cached a day. null when there isn't one. */
export async function faviconFor(domain: string): Promise<{ body: Buffer; type: string } | null> {
  const d = domain.toLowerCase().replace(/^www\./, "").replace(/[^a-z0-9.-]/g, "").slice(0, 100);
  if (!d) return null;
  const hit = iconCache.get(d);
  if (hit && Date.now() - hit.at < ICON_TTL_MS) return hit.body ? { body: hit.body, type: hit.type } : null;
  try {
    const r = await fetch(`https://www.google.com/s2/favicons?domain=${encodeURIComponent(d)}&sz=64`, { signal: AbortSignal.timeout(5_000) });
    if (!r.ok) throw new Error(String(r.status));
    const body = Buffer.from(await r.arrayBuffer());
    const type = r.headers.get("content-type") || "image/png";
    iconCache.set(d, { at: Date.now(), body, type });
    return { body, type };
  } catch {
    iconCache.set(d, { at: Date.now(), body: null, type: "" });
    return null;
  }
}
