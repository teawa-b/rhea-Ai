import { resolve } from "node:path";
import basicSsl from "@vitejs/plugin-basic-ssl";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/* `npm run dev:https` serves the dev build over HTTPS so a Quest headset on
 * the same Wi-Fi can open WebXR + the microphone (both need a secure origin). */
const https = process.argv.includes("--https");

export default defineConfig({
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
});
