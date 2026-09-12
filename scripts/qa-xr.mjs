/* Headless MR layout preview via @react-three/xr's built-in IWER emulator (Quest 3). */
import { chromium } from "playwright";
const out = process.argv[2] || "xr";
const script = process.argv[3] || "";
const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--disable-features=WebXR"] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text().slice(0, 200)); });
await page.goto("http://localhost:3000", { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => window.rhea?.market?.getState().overview, null, { timeout: 30000 });
await page.waitForTimeout(2500);
const hasXR = await page.waitForFunction(() => !!navigator.xr, null, { timeout: 15000 }).then(() => true).catch(() => false);
const mode = await page.evaluate(async () => { try { return await window.rhea.enterImmersive(); } catch (e) { return "ERR " + e.message; } });
console.log("navigator.xr present:", hasXR);
await page.waitForTimeout(2500);
if (script) { await page.evaluate(script); await page.waitForTimeout(4500); }
await page.screenshot({ path: `scratch/${out}.png` });
const st = await page.evaluate(() => ({ xrMode: window.rhea.xrStore.getState().mode, session: !!window.rhea.xrStore.getState().session }));
console.log(JSON.stringify({ mode, st, errors: errors.slice(0, 6) }));
await browser.close();
