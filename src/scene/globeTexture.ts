/* Procedural planet map — the sci-fi "dot-matrix Earth".
 *
 * Real continents come from world-atlas (Natural Earth 110m) so countries are
 * where the user expects them; everything is then re-drawn as a schematic:
 * deep-navy ocean gradient, a faint cyan graticule, soft land glow, thin
 * borders, and a hex-grid stipple of glowing dots over land. Countries with
 * tokenized stocks glow brighter than the rest.
 *
 * A second, smaller canvas is used for the live highlight overlay (focused /
 * highlighted countries, exposure heat) so the base map is drawn only once.
 */
import * as THREE from "three";
import * as topojson from "topojson-client";
import type { Topology, GeometryCollection } from "topojson-specification";
import world from "world-atlas/countries-110m.json";
import type { CountryCode } from "@shared/types";
import { ISO_NUMERIC_TO_CODE } from "@shared/registry";
import { C } from "@/theme";

type Ring = [number, number][];
type Feature = { id: string; rings: Ring[] };

const W = 2048, H = 1024;
const HL_W = 1024, HL_H = 512;

let features: Feature[] | null = null;
function loadFeatures(): Feature[] {
  if (features) return features;
  const topo = world as unknown as Topology<{ countries: GeometryCollection }>;
  const fc = topojson.feature(topo, topo.objects.countries);
  features = fc.features.map((f) => {
    const rings: Ring[] = [];
    const g = f.geometry;
    if (g.type === "Polygon") rings.push(...(g.coordinates as Ring[]));
    else if (g.type === "MultiPolygon") for (const poly of g.coordinates as Ring[][]) rings.push(...poly);
    return { id: String(f.id ?? ""), rings };
  });
  return features;
}

const px = (lng: number, w: number) => ((lng + 180) / 360) * w;
const py = (lat: number, h: number) => ((90 - lat) / 180) * h;

function tracePolygons(ctx: CanvasRenderingContext2D, rings: Ring[], w: number, h: number) {
  ctx.beginPath();
  for (const ring of rings) {
    for (let i = 0; i < ring.length; i++) {
      const [lng, lat] = ring[i];
      const x = px(lng, w), y = py(lat, h);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
  }
}

/* ---------------- Base map ---------------- */

export type BaseMap = { texture: THREE.CanvasTexture; landIndex: Uint16Array; codeByIndex: (CountryCode | null)[] };

export function buildBaseMap(supported: Set<CountryCode>): BaseMap {
  const feats = loadFeatures();
  const cv = document.createElement("canvas");
  cv.width = W; cv.height = H;
  const ctx = cv.getContext("2d")!;

  /* Ocean */
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, C.oceanLift);
  g.addColorStop(0.5, C.ocean);
  g.addColorStop(1, C.oceanDeep);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  /* Country id map (offscreen) so the stipple knows what it is standing on. */
  const idc = document.createElement("canvas");
  idc.width = W; idc.height = H;
  const ictx = idc.getContext("2d", { willReadFrequently: true })!;
  ictx.fillStyle = "#000000";
  ictx.fillRect(0, 0, W, H);
  const codeByIndex: (CountryCode | null)[] = [null];
  feats.forEach((f, i) => {
    const idx = i + 1;
    codeByIndex[idx] = ISO_NUMERIC_TO_CODE[f.id] ?? null;
    ictx.fillStyle = `rgb(${(idx >> 8) & 255},${idx & 255},0)`;
    tracePolygons(ictx, f.rings, W, H);
    ictx.fill();
  });
  const idData = ictx.getImageData(0, 0, W, H).data;
  const landIndex = new Uint16Array(W * H);
  for (let p = 0, i = 0; p < idData.length; p += 4, i++) landIndex[i] = (idData[p] << 8) | idData[p + 1];

  /* Soft land glow + borders. Supported countries get a warmer, brighter fill. */
  for (const f of feats) {
    const code = ISO_NUMERIC_TO_CODE[f.id] ?? null;
    const isSupported = code != null && supported.has(code);
    tracePolygons(ctx, f.rings, W, H);
    ctx.fillStyle = isSupported ? "rgba(63,224,255,0.085)" : "rgba(63,224,255,0.03)";
    ctx.fill();
    ctx.lineWidth = isSupported ? 1.6 : 0.9;
    ctx.strokeStyle = isSupported ? "rgba(143,232,255,0.42)" : "rgba(63,224,255,0.16)";
    ctx.stroke();
  }

  /* Graticule: every 15°, equator + prime meridian emphasised. */
  ctx.lineWidth = 1;
  for (let lng = -180; lng <= 180; lng += 15) {
    const x = px(lng, W);
    ctx.strokeStyle = lng === 0 ? "rgba(63,224,255,0.28)" : "rgba(63,224,255,0.10)";
    ctx.lineWidth = lng === 0 ? 1.6 : 1;
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
  }
  for (let lat = -75; lat <= 75; lat += 15) {
    const y = py(lat, H);
    ctx.strokeStyle = lat === 0 ? "rgba(63,224,255,0.30)" : "rgba(63,224,255,0.10)";
    ctx.lineWidth = lat === 0 ? 1.8 : 1;
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
  }

  /* Dot matrix: hex grid sampled against the id map. */
  const step = 6.5, rowStep = step * 0.87;
  ctx.globalCompositeOperation = "lighter";
  for (let row = 0, y = 3; y < H - 2; row++, y += rowStep) {
    const offset = row % 2 ? step / 2 : 0;
    /* Compensate the equirectangular stretch near the poles a little. */
    const lat = 90 - (y / H) * 180;
    const stretch = Math.max(0.35, Math.cos(lat * Math.PI / 180));
    const xs = step / stretch;
    for (let x = offset; x < W; x += xs) {
      const idx = landIndex[Math.round(y) * W + Math.round(x)];
      if (!idx) continue;
      const code = codeByIndex[idx];
      const on = code != null && supported.has(code);
      const jitter = ((x * 7919 + y * 104729) % 97) / 97;
      const r = on ? 2.0 + jitter * 0.6 : 1.5 + jitter * 0.5;
      ctx.fillStyle = on
        ? `rgba(143,232,255,${0.55 + jitter * 0.35})`
        : `rgba(96,150,200,${0.22 + jitter * 0.18})`;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    }
  }
  ctx.globalCompositeOperation = "source-over";

  const texture = new THREE.CanvasTexture(cv);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  texture.wrapS = THREE.RepeatWrapping;
  return { texture, landIndex, codeByIndex };
}

/* ---------------- Highlight overlay ---------------- */

export type HighlightMap = { texture: THREE.CanvasTexture; draw: (opts: HighlightOpts) => void };
export type HighlightOpts = {
  focused: CountryCode | null;
  highlighted: CountryCode[];
  heat: Partial<Record<CountryCode, number>>;
  pulse: number; // 0..1 animation phase
};

export function buildHighlightMap(): HighlightMap {
  const feats = loadFeatures();
  const cv = document.createElement("canvas");
  cv.width = HL_W; cv.height = HL_H;
  const ctx = cv.getContext("2d")!;
  const texture = new THREE.CanvasTexture(cv);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;

  const byCode = new Map<CountryCode, Feature[]>();
  for (const f of feats) {
    const code = ISO_NUMERIC_TO_CODE[f.id];
    if (!code) continue;
    if (!byCode.has(code)) byCode.set(code, []);
    byCode.get(code)!.push(f);
  }

  const draw = ({ focused, highlighted, heat, pulse }: HighlightOpts) => {
    ctx.clearRect(0, 0, HL_W, HL_H);
    const paint = (code: CountryCode, fill: string, stroke: string, lineWidth: number) => {
      const fs = byCode.get(code);
      if (!fs) return;
      for (const f of fs) {
        tracePolygons(ctx, f.rings, HL_W, HL_H);
        ctx.fillStyle = fill; ctx.fill();
        ctx.lineWidth = lineWidth; ctx.strokeStyle = stroke; ctx.stroke();
      }
    };
    for (const [code, v] of Object.entries(heat) as [CountryCode, number][]) {
      if (!v) continue;
      paint(code, `rgba(255,178,32,${0.10 + 0.35 * v})`, `rgba(255,210,74,${0.35 + 0.5 * v})`, 1.5);
    }
    for (const code of highlighted) {
      if (code === focused) continue;
      paint(code, "rgba(63,224,255,0.16)", "rgba(143,232,255,0.7)", 1.6);
    }
    if (focused) {
      const p = 0.5 + 0.5 * Math.sin(pulse * Math.PI * 2);
      paint(focused, `rgba(63,224,255,${0.22 + 0.12 * p})`, `rgba(255,255,255,${0.75 + 0.25 * p})`, 2.2);
    }
    texture.needsUpdate = true;
  };

  return { texture, draw };
}
