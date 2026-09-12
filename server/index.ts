/* Rhea application server.
 *
 * Owns every secret (OpenAI, Jupiter, Pyth, Google) and exposes a small API
 * to the WebXR client. In production it also serves the built client from
 * ./dist so a single process runs on Railway / Render / a VPS.
 */
import "dotenv/config";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import express from "express";
import { createLiveSession } from "./live";
import { marketRouter } from "./market";

const app = express();
const isProd = process.env.NODE_ENV === "production";
/* In dev the Vite server owns PORT (3000) and proxies /api here; production
 * hosts (Railway etc.) inject PORT for the single combined process. */
const port = Number(isProd ? process.env.PORT || 5050 : process.env.API_PORT || 5050);

app.disable("x-powered-by");
app.use(express.json({ limit: "256kb" }));

app.use((_req, res, next) => {
  /* WebXR + WebRTC + Privy need a permissive but sane policy. */
  res.setHeader("Permissions-Policy", "microphone=(self), xr-spatial-tracking=(self), camera=(self)");
  next();
});

app.get("/api/health", (_req, res) => res.json({ ok: true, at: new Date().toISOString() }));
app.post("/api/live/session", createLiveSession);
app.use("/api/market", marketRouter());

if (isProd) {
  const dist = resolve("dist");
  if (existsSync(dist)) {
    app.use(express.static(dist, { maxAge: "1h", index: false }));
    app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(resolve(dist, "index.html")));
  } else {
    console.warn("[server] dist/ not found — run `npm run build` first");
  }
}

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error("[server] unhandled", err);
  res.status(500).json({ error: "Internal error" });
});

app.listen(port, "0.0.0.0", () => {
  console.log(`[rhea] api listening on http://0.0.0.0:${port} (${isProd ? "production" : "development"})`);
  console.log(`[rhea] OpenAI ${process.env.OPENAI_API_KEY ? "✓" : "✗ (set OPENAI_API_KEY)"} · Jupiter key ${process.env.JUPITER_API_KEY ? "✓" : "– (keyless lite-api)"} · Pyth Pro ${process.env.PYTH_PRO_API_KEY ? "✓" : "– (Yahoo fallback)"}`);
});
