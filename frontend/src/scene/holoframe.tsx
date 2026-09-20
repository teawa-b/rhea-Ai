/* HoloFrame — a sci-fi HUD frame drawn by one shader, no filled panel.
 *
 * The text inside stands on its own over passthrough; the frame only *marks*
 * the space: L-shaped corner brackets, a hairline along the top edge that
 * fades toward the ends, tick marks down the sides, faint scanlines, and a
 * slow band of light sweeping down through it. Everything is premultiplied so
 * it adds light to the room rather than darkening it. */
import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { UNIT_PLANE, NO_RAYCAST } from "./glass";

const VERT = /* glsl */ `
  uniform vec2 uQuad;
  varying vec2 vP;
  void main() {
    vP = (uv - 0.5) * uQuad;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;

const FRAG = /* glsl */ `
  uniform vec2 uSize; uniform vec3 uAccent; uniform float uTime; uniform float uOpacity;
  uniform float uCorner; uniform float uStroke; uniform float uFill; uniform float uSweep;
  varying vec2 vP;

  float band(float d, float aa) { return 1.0 - smoothstep(-aa, aa, d); }

  void main() {
    vec2 hs = uSize * 0.5;
    vec2 a = abs(vP);
    vec2 edge = hs - a;                 /* distance in from each edge, inside > 0 */
    float din = min(edge.x, edge.y);
    float aa = max(fwidth(din), 1e-5);
    float inside = band(-din, aa);

    /* --- corner brackets: on the outline, within uCorner of a corner; a thinner
       second bracket runs just inside, a little shorter (the classic doubled L) --- */
    float outline = band(abs(din - uStroke * 0.5) - uStroke * 0.5, aa) * inside;
    float nearCorner = step(hs.x - uCorner, a.x) * step(hs.y - uCorner, a.y);
    float inner = band(abs(din - uStroke * 3.2) - uStroke * 0.28, aa) * inside;
    float nearCorner2 = step(hs.x - uCorner * 0.62, a.x) * step(hs.y - uCorner * 0.62, a.y);
    float brackets = outline * nearCorner + inner * nearCorner2 * 0.7;

    /* --- hairline along the top edge, fading toward the ends --- */
    float top = band(abs(edge.y - uStroke * 0.9) - uStroke * 0.35, aa) * inside;
    float topFade = 1.0 - smoothstep(0.35, 1.0, a.x / hs.x);
    float hair = top * topFade * 0.85;

    /* --- tick marks down both sides, every 3 cm --- */
    float onSide = band(edge.x - uStroke * 2.2, aa) * inside;
    float tick = step(0.8, fract(vP.y / 0.03 + 0.5)) * onSide * step(uCorner, edge.y) * 0.9;

    /* --- scanlines and a sweeping band of light --- */
    float scan = (0.5 + 0.5 * sin(vP.y * 1400.0)) * 0.035;
    float sweepY = hs.y - fract(uTime * 0.12) * (uSize.y + 0.16) + 0.08;
    float sweep = exp(-pow((vP.y - sweepY) / 0.04, 2.0)) * uSweep;
    /* the sweep lights the frame lines more than the interior */
    float lines = brackets + hair + tick;

    /* base wash: nearly nothing, a hint of depth at the top */
    float gy = clamp(vP.y / uSize.y + 0.5, 0.0, 1.0);
    float wash = inside * uFill * (0.55 + 0.45 * gy) + inside * scan * (0.4 + sweep);

    vec3 acc = linearToOutputTexel(vec4(uAccent, 1.0)).rgb;
    vec3 rgb = acc * (lines * (1.0 + sweep * 1.8) + wash * 0.9 + inside * sweep * 0.3);
    float alpha = clamp(lines * 0.95 + wash + inside * sweep * 0.14, 0.0, 1.0);
    gl_FragColor = vec4(rgb, alpha) * uOpacity;
  }`;

export type HoloFrameMaterial = THREE.ShaderMaterial & { uniforms: { uTime: { value: number }; uOpacity: { value: number } } & Record<string, THREE.IUniform> };

function makeFrame(): HoloFrameMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: {
      uQuad: { value: new THREE.Vector2(1, 1) }, uSize: { value: new THREE.Vector2(1, 1) },
      uAccent: { value: new THREE.Color() }, uTime: { value: 0 }, uOpacity: { value: 1 },
      uCorner: { value: 0.12 }, uStroke: { value: 0.0042 }, uFill: { value: 0.0 }, uSweep: { value: 1 },
    },
    transparent: true,
    premultipliedAlpha: true,
    depthWrite: false,
    toneMapped: false,
  }) as HoloFrameMaterial;
}

export type HoloFrameProps = {
  w: number; h: number;
  accent: THREE.ColorRepresentation;
  position?: [number, number, number];
  /** bracket arm length (m) */
  corner?: number;
  stroke?: number;
  /** interior wash, 0 for none */
  fill?: number;
  /** strength of the travelling light band, 0 to disable */
  sweep?: number;
  /** keep the frame hittable so rays stop on it instead of the globe behind */
  interactive?: boolean;
};

export const HoloFrame = forwardRef<HoloFrameMaterial, HoloFrameProps>(function HoloFrame(p, ref) {
  const mat = useMemo(makeFrame, []);
  const mesh = useRef<THREE.Mesh>(null);
  useImperativeHandle(ref, () => mat, [mat]);
  useEffect(() => () => mat.dispose(), [mat]);
  useLayoutEffect(() => {
    const u = mat.uniforms;
    u.uQuad.value.set(p.w, p.h);
    u.uSize.value.set(p.w, p.h);
    u.uAccent.value.set(p.accent);
    u.uCorner.value = p.corner ?? Math.min(0.12, p.w * 0.16, p.h * 0.3);
    u.uStroke.value = p.stroke ?? 0.0042;
    u.uFill.value = p.fill ?? 0.0;
    u.uSweep.value = p.sweep ?? 1;
  });
  /* Each frame starts its sweep at a different phase so a room of them doesn't pulse in unison. */
  const phase = useMemo(() => Math.random() * 8, []);
  useFrame((s) => { mat.uniforms.uTime.value = s.clock.elapsedTime + phase; });
  return (
    <mesh ref={mesh} geometry={UNIT_PLANE} material={mat} scale={[p.w, p.h, 1]} position={p.position} {...(p.interactive ? {} : { raycast: NO_RAYCAST })} />
  );
});
