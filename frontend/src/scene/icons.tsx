/* Scene icons: one small canvas atlas drawn once with vector paths, shared by
 * every icon quad (clones share the GPU upload). Replaces the ◂ ▸ ● ◉ ↗ glyphs,
 * which aren't in the self-hosted latin fonts and made troika download fallback
 * fonts mid-session. */
import * as THREE from "three";
import { NO_RAYCAST, UNIT_PLANE } from "./glass";

export type IconName = "back" | "bullet" | "dot" | "order" | "external";
const NAMES: IconName[] = ["back", "bullet", "dot", "order", "external"];
const CELL = 128;

function draw(ctx: CanvasRenderingContext2D, name: IconName) {
  const s = CELL;
  ctx.strokeStyle = "#fff"; ctx.fillStyle = "#fff";
  ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.lineWidth = s * 0.13;
  switch (name) {
    case "back":
      ctx.beginPath(); ctx.moveTo(s * 0.62, s * 0.24); ctx.lineTo(s * 0.34, s * 0.5); ctx.lineTo(s * 0.62, s * 0.76); ctx.stroke(); break;
    case "bullet":
      ctx.beginPath(); ctx.moveTo(s * 0.38, s * 0.24); ctx.lineTo(s * 0.66, s * 0.5); ctx.lineTo(s * 0.38, s * 0.76); ctx.stroke(); break;
    case "dot":
      ctx.beginPath(); ctx.arc(s / 2, s / 2, s * 0.26, 0, Math.PI * 2); ctx.fill(); break;
    case "order":
      ctx.lineWidth = s * 0.09;
      ctx.beginPath(); ctx.arc(s / 2, s / 2, s * 0.34, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.arc(s / 2, s / 2, s * 0.15, 0, Math.PI * 2); ctx.fill(); break;
    case "external":
      ctx.beginPath(); ctx.moveTo(s * 0.3, s * 0.7); ctx.lineTo(s * 0.7, s * 0.3); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(s * 0.4, s * 0.3); ctx.lineTo(s * 0.7, s * 0.3); ctx.lineTo(s * 0.7, s * 0.6); ctx.stroke(); break;
  }
}

let atlas: Map<IconName, THREE.Texture> | null = null;
function textures() {
  if (atlas) return atlas;
  const cv = document.createElement("canvas");
  cv.width = CELL * NAMES.length; cv.height = CELL;
  const ctx = cv.getContext("2d")!;
  NAMES.forEach((n, i) => { ctx.save(); ctx.translate(i * CELL, 0); draw(ctx, n); ctx.restore(); });
  const base = new THREE.CanvasTexture(cv);
  base.colorSpace = THREE.SRGBColorSpace;
  atlas = new Map(NAMES.map((n, i) => {
    const t = base.clone();
    t.repeat.set(1 / NAMES.length, 1);
    t.offset.set(i / NAMES.length, 0);
    t.needsUpdate = true;
    return [n, t] as const;
  }));
  return atlas;
}

export function Icon({ name, size, color, position, opacity = 1 }: { name: IconName; size: number; color: string; position?: [number, number, number]; opacity?: number }) {
  return (
    <mesh geometry={UNIT_PLANE} scale={[size, size, 1]} position={position} raycast={NO_RAYCAST}>
      <meshBasicMaterial map={textures().get(name)} color={color} transparent opacity={opacity} depthWrite={false} toneMapped={false} />
    </mesh>
  );
}
