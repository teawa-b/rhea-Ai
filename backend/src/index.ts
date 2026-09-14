/* Rhea API server.
 *
 * Owns every secret (OpenAI, Jupiter, Pyth, Google) and exposes a small API
 * to the WebXR client. The client is a separate Railway service (its own
 * domain) and calls this service cross-origin, so CORS is handled here.
 */
import "dotenv/config";
import express from "express";
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
app.use(express.json({ limit: "256kb" }));

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
app.post("/api/live/session", createLiveSession);
app.use("/api/market", marketRouter());

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error("[server] unhandled", err);
  res.status(500).json({ error: "Internal error" });
});

app.listen(port, "0.0.0.0", () => {
  console.log(`[rhea] api listening on http://0.0.0.0:${port} (${isProd ? "production" : "development"})`);
  console.log(`[rhea] CORS ${allowedOrigins.length ? allowedOrigins.join(", ") : "any origin (set CORS_ORIGIN to lock it down)"}`);
  console.log(`[rhea] OpenAI ${process.env.OPENAI_API_KEY ? "✓" : "✗ (set OPENAI_API_KEY)"} · Jupiter key ${process.env.JUPITER_API_KEY ? "✓" : "– (keyless lite-api)"} · Pyth Pro ${process.env.PYTH_PRO_API_KEY ? "✓" : "– (Yahoo fallback)"}`);
});
