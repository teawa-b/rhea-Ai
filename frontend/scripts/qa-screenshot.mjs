/* Headless visual QA: `node scripts/qa-screenshot.mjs <name> "<js to run in page>"` (needs `npm i -g playwright` + chromium; dev server on :3000; writes ./scratch/<name>.png) */
import { chromium } from "playwright";
const out = process.argv[2] || "shot";
const script = process.argv[3] || "";
const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text().slice(0, 200)); });
await page.goto("http://localhost:3000", { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => window.rhea?.market?.getState().overview, null, { timeout: 30000 });
await page.waitForTimeout(3000);
if (script) { await page.evaluate(script); await page.waitForTimeout(4500); }
await page.screenshot({ path: `./scratch/${out}.png` });
const rig = await page.evaluate(() => ({ dist: window.rhea.rig.dist, yaw: window.rhea.rig.yaw, view: window.rhea.world.getState().view }));
console.log(JSON.stringify({ rig, errors: errors.slice(0, 8) }));
await browser.close();
