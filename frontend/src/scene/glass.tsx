/* GlassRect — a rounded panel drawn by one shader in one draw call.
 *
 * Buttons, cards and chips used to stack 3–5 meshes each (fill, rim, sheen,
 * glow, halo) plus 1px line borders that shimmer on Quest. Here a signed
 * distance field gives the fill gradient, an anti-aliased rim, a top sheen, a
 * left accent bar, a top accent strip and a soft outer glow at once. Output is
 * premultiplied: the panel composites normally while the glow adds light with
 * zero alpha, so over passthrough it brightens the room instead of darkening it.
 * Every instance shares one compiled program and one unit quad. */
import { forwardRef, useImperativeHandle, useLayoutEffect, useMemo, useEffect } from "react";
import * as THREE from "three";

const VERT = /* glsl */ `
  uniform vec2 uQuad;
  varying vec2 vP;
  void main() {
    vP = (uv - 0.5) * uQuad;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;

const FRAG = /* glsl */ `
  uniform vec2 uSize; uniform float uRadius; uniform float uStroke; uniform float uPad;
  uniform vec3 uTop; uniform vec3 uBottom; uniform vec3 uAccent;
  uniform float uFill; uniform float uRim; uniform float uGlow; uniform float uSheen;
  uniform float uBar; uniform vec3 uBarGeo; uniform float uTopBar; uniform float uOpacity; uniform float uChamfer;
  varying vec2 vP;

  float sdRound(vec2 p, vec2 b, float r) {
    vec2 q = abs(p) - b + r;
    return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
  }
  /* The app's corner cut (--btn-cut in the DOM): a 45 degree slice of size c
     off each corner, the same shape the CSS clip-path draws. */
  float sdShape(vec2 p, vec2 b, float r, float c) {
    float d = sdRound(p, b, r);
    if (c <= 0.0) return d;
    vec2 a = abs(p);
    return max(d, (a.x + a.y - (b.x + b.y - c)) * 0.70710678);
  }
  float band(float d, float aa) { return 1.0 - smoothstep(-aa, aa, d); }
  /* premultiplied "over" */
  vec4 over(vec4 dst, vec3 c, float a) { return vec4(c * a + dst.rgb * (1.0 - a), a + dst.a * (1.0 - a)); }

  void main() {
    vec2 hs = uSize * 0.5;
    float d = sdShape(vP, hs, uRadius, uChamfer);
    float aa = max(fwidth(d), 1e-5);
    float inside = band(d, aa);
    float corner = max(uRadius, uChamfer);

    float gy = clamp(vP.y / uSize.y + 0.5, 0.0, 1.0);
    vec4 c = vec4(mix(uBottom, uTop, gy) * inside * uFill, inside * uFill);

    if (uSheen > 0.0) {
      float s = band(abs(vP.y - (hs.y - min(0.009, hs.y * 0.3))) - 0.002, aa)
              * band(abs(vP.x) - (uSize.x - corner) * 0.5, aa);
      c = over(c, vec3(1.0), s * inside * uSheen);
    }
    if (uBar > 0.0) {
      float b = band(sdRound(vP - vec2(-hs.x + uBarGeo.x, 0.0), uBarGeo.yz, uBarGeo.y), aa);
      c = over(c, uAccent, b * uBar);
    }
    if (uTopBar > 0.0) {
      float t = band(abs(vP.x) - uSize.x * 0.3, aa) * band(-(vP.y - (hs.y - 0.004)), aa);
      c = over(c, uAccent, t * inside * uTopBar);
    }
    if (uRim > 0.0) {
      float r = inside * band(-uStroke - d, aa);
      c = over(c, uAccent, r * uRim);
    }

    /* straight -> output colour space, then re-premultiply */
    vec3 rgb = c.a > 0.0 ? linearToOutputTexel(vec4(c.rgb / c.a, 1.0)).rgb * c.a : vec3(0.0);
    float glow = 0.0;
    if (uGlow > 0.0 && uPad > 0.0) {
      float o = max(d, 0.0);
      float fall = clamp(1.0 - o / uPad, 0.0, 1.0);
      glow = uGlow * (0.34 * exp(-o / 0.007) + 0.14 * exp(-o / 0.018)) * fall * fall * (1.0 - inside);
    }
    rgb += linearToOutputTexel(vec4(uAccent, 1.0)).rgb * glow;
    gl_FragColor = vec4(rgb, c.a) * uOpacity;
  }`;

/** Shared unit quad; each panel scales it to size. */
export const UNIT_PLANE = new THREE.PlaneGeometry(1, 1);
export const NO_RAYCAST = () => null;

export type GlassUniforms = {
  uFill: { value: number }; uRim: { value: number }; uGlow: { value: number }; uSheen: { value: number };
  uBar: { value: number }; uTopBar: { value: number }; uOpacity: { value: number };
};
export type GlassMaterial = THREE.ShaderMaterial & { uniforms: GlassUniforms & Record<string, THREE.IUniform> };

function makeGlass(): GlassMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: {
      uQuad: { value: new THREE.Vector2(1, 1) }, uSize: { value: new THREE.Vector2(1, 1) },
      uRadius: { value: 0 }, uStroke: { value: 0.002 }, uPad: { value: 0 },
      uTop: { value: new THREE.Color() }, uBottom: { value: new THREE.Color() }, uAccent: { value: new THREE.Color() },
      uFill: { value: 0.8 }, uRim: { value: 0 }, uGlow: { value: 0 }, uSheen: { value: 0 },
      uBar: { value: 0 }, uBarGeo: { value: new THREE.Vector3(0.012, 0.0025, 0.01) }, uTopBar: { value: 0 }, uOpacity: { value: 1 },
      uChamfer: { value: 0 },
    },
    transparent: true,
    premultipliedAlpha: true,
    depthWrite: false,
    toneMapped: false,
  }) as GlassMaterial;
}

export type GlassProps = {
  w: number; h: number;
  /** corner radius (clamped to half the short side) */
  r?: number;
  /** 45° corner cut, the app's chamfer (see --btn-cut). Combines with `r`; use one or the other. */
  chamfer?: number;
  /** room around the shape for the glow, each side */
  pad?: number;
  /** fill gradient top/bottom (bottom defaults to top) */
  top: THREE.ColorRepresentation; bottom?: THREE.ColorRepresentation;
  accent: THREE.ColorRepresentation;
  stroke?: number;
  /** [centre inset from the left edge, half width, half height] */
  barGeo?: [number, number, number];
  position?: [number, number, number];
  renderOrder?: number;
  /** keep the panel hittable so rays stop on it (cards, chips) */
  interactive?: boolean;
  /* Animatable levels: pass a value to set it from props, or omit and drive
   * material.uniforms from a frame loop (see the ref). */
  fill?: number; rim?: number; glow?: number; sheen?: number; bar?: number; topBar?: number; opacity?: number;
};

export const GlassRect = forwardRef<GlassMaterial, GlassProps>(function GlassRect(p, ref) {
  const mat = useMemo(makeGlass, []);
  useImperativeHandle(ref, () => mat, [mat]);
  useEffect(() => () => mat.dispose(), [mat]);
  const pad = p.pad ?? 0;
  useLayoutEffect(() => {
    const u = mat.uniforms;
    u.uQuad.value.set(p.w + pad * 2, p.h + pad * 2);
    u.uSize.value.set(p.w, p.h);
    u.uRadius.value = Math.min(p.r ?? 0, p.w / 2, p.h / 2);
    u.uChamfer.value = Math.min(p.chamfer ?? 0, p.w / 2, p.h / 2);
    u.uPad.value = pad;
    u.uStroke.value = p.stroke ?? 0.002;
    u.uTop.value.set(p.top);
    u.uBottom.value.set(p.bottom ?? p.top);
    u.uAccent.value.set(p.accent);
    if (p.barGeo) u.uBarGeo.value.set(...p.barGeo);
    if (p.fill !== undefined) u.uFill.value = p.fill;
    if (p.rim !== undefined) u.uRim.value = p.rim;
    if (p.glow !== undefined) u.uGlow.value = p.glow;
    if (p.sheen !== undefined) u.uSheen.value = p.sheen;
    if (p.bar !== undefined) u.uBar.value = p.bar;
    if (p.topBar !== undefined) u.uTopBar.value = p.topBar;
    if (p.opacity !== undefined) u.uOpacity.value = p.opacity;
  });
  return (
    <mesh
      geometry={UNIT_PLANE}
      material={mat}
      scale={[p.w + pad * 2, p.h + pad * 2, 1]}
      position={p.position}
      renderOrder={p.renderOrder}
      {...(p.interactive ? {} : { raycast: NO_RAYCAST })}
    />
  );
});
