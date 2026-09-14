import { resolve } from "node:path";
import basicSsl from "@vitejs/plugin-basic-ssl";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

/* `npm run dev:https` serves the dev build over HTTPS so a Quest headset on
 * the same Wi-Fi can open WebXR + the microphone (both need a secure origin). */
const https = process.argv.includes("--https");

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, import.meta.dirname, "VITE_");
  /* On Railway the API is a separate service; without its URL every request
   * would 404 against the static site, so fail the build with a clear message. */
  const onRailway = Boolean(process.env.RAILWAY_PROJECT_ID || process.env.RAILWAY_ENVIRONMENT_NAME);
  if (command === "build" && onRailway) {
    const apiUrl = (env.VITE_API_URL ?? "").trim();
    if (!apiUrl) {
      throw new Error("VITE_API_URL is not set on the frontend service. Railway → frontend → Variables → add VITE_API_URL = https://${{ backend.RAILWAY_PUBLIC_DOMAIN }}, then redeploy.");
    }
    if (!/^(https?:\/\/)?[^/\s]+\.[^/\s]+/i.test(apiUrl)) {
      throw new Error(`VITE_API_URL is "${apiUrl}", which has no domain. Generate a public domain for the backend service (Settings → Networking → Generate Domain), then redeploy the frontend.`);
    }
  }

  return {
    plugins: [react(), ...(https ? [basicSsl()] : [])],
    resolve: {
      /* One Three.js for everything (the XR dev emulator ships its own copy). */
      dedupe: ["three"],
      alias: {
        "@": resolve(import.meta.dirname, "src"),
        "@shared": resolve(import.meta.dirname, "shared"),
      },
    },
    server: {
      host: "0.0.0.0",
      port: 3000,
      /* Local dev: the backend runs on :5050 (`npm run dev` in backend/). */
      proxy: {
        "/api": { target: "http://127.0.0.1:5050", changeOrigin: true },
      },
    },
    preview: { host: "0.0.0.0", port: 4173 },
    build: {
      outDir: "dist",
      emptyOutDir: true,
      chunkSizeWarningLimit: 2500,
    },
  };
});
