/* Rhea API server.
 *
 * Owns every secret (OpenAI, Jupiter, Pyth, Google) and exposes a small API
 * to the WebXR client. The client is a separate Railway service (its own
 * domain) and calls this service cross-origin, so CORS is handled here.
 */
import "dotenv/config";
import express from "express";
import { listTokenizedAssets } from "./jupiter";
import { createLiveSession } from "./live";
import { marketRouter } from "./market";

const app = express();
const isProd = process.env.NODE_ENV === "production";
/* Railway injects PORT (`npm start` sets NODE_ENV=production). In dev the
 * frontend's Vite proxy expects :5050, and a PORT inherited from the shell or
 * a launcher must not move the API onto Vite's port. */
const port = Number(isProd ? process.env.PORT || 5050 : process.env.API_PORT || 5050);

/* CORS_ORIGIN = comma-separated list of sites allowed to call the API, e.g.
 * "https://${{ frontend.RAILWAY_PUBLIC_DOMAIN }}" on Railway. Unset allows any origin. */
const allowedOrigins = (process.env.CORS_ORIGIN || "")
  .split(",")
  .map((o) => o.trim().replace(/\/+$/, ""))
  .filter(Boolean);

app.disable("x-powered-by");
/* Railway puts one proxy hop in front of us; without this every visitor shares
 * the proxy's IP and the per-IP voice limit below would be global. */
app.set("trust proxy", 1);
app.use(express.json({ limit: "256kb" }));

/* ---- Voice session limiter ----
 * Each POST /api/live/session opens a paid GPT-Live session, and the demo is
 * public and logged-out. In-memory is enough for one Railway replica: a restart
 * resets the counters, which only errs towards letting people talk. */
const LIVE_PER_IP_HOUR = Number(process.env.LIVE_SESSION_PER_IP_HOUR) || 10;
const LIVE_DAILY_CAP = Number(process.env.LIVE_SESSION_DAILY_CAP) || 400;
const HOUR_MS = 3_600_000;
const MAX_TRACKED_IPS = 10_000;
const liveHits = new Map<string, { hits: number[]; warned: boolean }>();
const liveDay = { day: "", count: 0, warned: false };

function pruneLiveHits(now: number) {
  for (const [ip, e] of liveHits) if (!e.hits.length || now - e.hits[e.hits.length - 1] >= HOUR_MS) liveHits.delete(ip);
  /* Still too many (a spray of unique IPs): drop the oldest-inserted entries. */
  for (const ip of liveHits.keys()) { if (liveHits.size <= MAX_TRACKED_IPS) break; liveHits.delete(ip); }
}
setInterval(() => pruneLiveHits(Date.now()), 10 * 60_000).unref();

const liveSessionLimiter: express.RequestHandler = (req, res, next) => {
  const now = Date.now();
  const day = new Date(now).toISOString().slice(0, 10); // UTC day
  if (liveDay.day !== day) Object.assign(liveDay, { day, count: 0, warned: false });
  if (liveDay.count >= LIVE_DAILY_CAP) {
    if (!liveDay.warned) { liveDay.warned = true; console.warn(`[limit] live session daily cap ${LIVE_DAILY_CAP} reached for ${day} UTC`); }
    res.setHeader("Retry-After", String(Math.ceil((Date.parse(`${day}T00:00:00Z`) + 24 * HOUR_MS - now) / 1000)));
    res.status(429).json({ error: "Rhea's voice has reached today's session limit, so please come back tomorrow; the globe still works without voice." });
    return;
  }
  const ip = req.ip || req.socket.remoteAddress || "unknown";
  const entry = liveHits.get(ip) ?? { hits: [], warned: false };
  entry.hits = entry.hits.filter((t) => now - t < HOUR_MS);
  if (entry.hits.length >= LIVE_PER_IP_HOUR) {
    if (!entry.warned) { entry.warned = true; console.warn(`[limit] live session per-IP limit ${LIVE_PER_IP_HOUR}/h hit by ${ip}`); }
    liveHits.set(ip, entry);
    res.setHeader("Retry-After", String(Math.ceil((entry.hits[0] + HOUR_MS - now) / 1000)));
    res.status(429).json({ error: "You've started a lot of voice sessions this hour, so please wait a little while before starting another." });
    return;
  }
  entry.hits.push(now);
  entry.warned = false;
  liveHits.set(ip, entry);
  liveDay.count += 1;
  if (liveHits.size > MAX_TRACKED_IPS) pruneLiveHits(now);
  next();
};

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && (allowedOrigins.length === 0 || allowedOrigins.includes(origin))) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-trigger-jwt");
    res.setHeader("Access-Control-Max-Age", "86400");
  }
  res.setHeader("Vary", "Origin");
  if (req.method === "OPTIONS") { res.sendStatus(204); return; }
  next();
});

app.get("/", (_req, res) => res.json({ service: "rhea-api", ok: true, health: "/api/health" }));
app.get("/api/health", (_req, res) => res.json({ ok: true, at: new Date().toISOString() }));
app.post("/api/live/session", liveSessionLimiter, createLiveSession);
app.use("/api/market", marketRouter());

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error("[server] unhandled", err);
  res.status(500).json({ error: "Internal error" });
});

app.listen(port, "0.0.0.0", () => {
  console.log(`[rhea] api listening on http://0.0.0.0:${port} (${isProd ? "production" : "development"})`);
  console.log(`[rhea] voice sessions limited to ${LIVE_PER_IP_HOUR}/IP/hour and ${LIVE_DAILY_CAP}/UTC day`);
  console.log(`[rhea] CORS ${allowedOrigins.length ? allowedOrigins.join(", ") : "any origin (set CORS_ORIGIN to lock it down)"}`);
  console.log(`[rhea] OpenAI ${process.env.OPENAI_API_KEY ? "✓" : "✗ (set OPENAI_API_KEY)"} · Jupiter key ${process.env.JUPITER_API_KEY ? "✓" : "– (keyless lite-api)"} · Pyth Pro ${process.env.PYTH_PRO_API_KEY ? "✓" : "– (Yahoo fallback)"}`);
  /* Warm the asset cache: pricing the full 715-token catalog takes ~5s keyless,
   * and the first /overview should not pay for it. */
  listTokenizedAssets()
    .then((a) => console.log(`[rhea] xStocks catalog: ${a.length} listed · ${a.filter((x) => x.tradable).length} tradable on Solana`))
    .catch((e) => console.warn("[rhea] catalog warm-up failed:", (e as Error).message));
});
