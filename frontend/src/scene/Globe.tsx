/* The planet: dot-matrix Earth, live highlight overlay, fresnel atmosphere,
 * outer halo, holographic orbit rings and drag-to-rotate input. */
import { useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { CountryCode } from "@shared/types";
import { COUNTRIES } from "@shared/registry";
import { C } from "@/theme";
import { useWorld } from "@/state/world";
import { useMarket } from "@/state/market";
import { buildBaseMap, buildHighlightMap } from "./globeTexture";
import { R, latLngToVec3 } from "./geo";
import { DIST, rig, userNudge, userZoom } from "./rig";

/* ---------------- Fresnel shaders ---------------- */

const RIM_VERT = /* glsl */ `
  varying vec3 vNormal; varying vec3 vView;
  void main() {
    vNormal = normalize(normalMatrix * normal);
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vView = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }`;
const RIM_FRAG = /* glsl */ `
  uniform vec3 color; uniform float power; uniform float intensity; uniform float inner;
  varying vec3 vNormal; varying vec3 vView;
  void main() {
    float d = dot(vNormal, vView);
    float f = inner > 0.5 ? pow(1.0 - clamp(d, 0.0, 1.0), power) : pow(clamp(0.78 - d, 0.0, 1.0), power);
    gl_FragColor = vec4(color, f * intensity);
  }`;

function useRimMaterial(color: string, power: number, intensity: number, inner: boolean, side: THREE.Side) {
  return useMemo(() => new THREE.ShaderMaterial({
    vertexShader: RIM_VERT,
    fragmentShader: RIM_FRAG,
    uniforms: { color: { value: new THREE.Color(color) }, power: { value: power }, intensity: { value: intensity }, inner: { value: inner ? 1 : 0 } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side,
  }), [color, power, intensity, inner, side]);
}

/* ---------------- Globe ---------------- */

export function Globe() {
  const overview = useMarket((s) => s.overview);
  /* Asset share per country drives the purple depth (Solana branding). */
  const intensityKey = overview?.countries.map((c) => `${c.code}:${c.assetCount}`).join(",") ?? "";
  const base = useMemo(() => {
    const m = new Map<CountryCode, number>();
    if (intensityKey) {
      const entries = intensityKey.split(",").map((e) => { const [code, n] = e.split(":"); return [code as CountryCode, Number(n)] as const; });
      const max = Math.max(1, ...entries.map((e) => e[1]));
      for (const [code, n] of entries) m.set(code, Math.log1p(n) / Math.log1p(max));
    }
    return buildBaseMap(m);
  }, [intensityKey]);
  const hl = useMemo(() => buildHighlightMap(), []);
  useEffect(() => () => { base.texture.dispose(); }, [base]);
  useEffect(() => () => { hl.texture.dispose(); }, [hl]);

  const focused = useWorld((s) => s.focusedCountry);
  const highlighted = useWorld((s) => s.highlightedCountries);
  const heat = useWorld((s) => s.countryHeat);
  const hlRef = useRef({ focused, highlighted, heat, lastDraw: 0, key: "" });
  hlRef.current.focused = focused; hlRef.current.highlighted = highlighted; hlRef.current.heat = heat;

  /* Atmosphere: a crisp cyan rim on the planet, then a faint purple haze that
   * falls off quickly — a hint of Solana, not a band. */
  const rimInner = useRimMaterial(C.cyan, 3.6, 0.6, true, THREE.FrontSide);
  const halo = useRimMaterial(C.solDeep, 5.5, 0.22, false, THREE.BackSide);
  const halo2 = useRimMaterial(C.sol, 7.0, 0.08, false, THREE.BackSide);

  const ringsRef = useRef<THREE.Group>(null);
  const { gl } = useThree();

  /* Pointer drag → rotate. Works with mouse, touch and XR controller rays. */
  const drag = useRef({ on: false, id: -1, x: 0, y: 0, moved: 0, t: 0 });
  const onDown = (e: ThreeEvent<PointerEvent>) => {
    drag.current = { on: true, id: e.pointerId, x: e.nativeEvent.clientX ?? 0, y: e.nativeEvent.clientY ?? 0, moved: 0, t: performance.now() };
    rig.dragging = true; rig.vy = 0; rig.vp = 0; rig.tweening = false;
    (e.target as Element | undefined)?.setPointerCapture?.(e.pointerId);
  };
  const onMove = (e: ThreeEvent<PointerEvent>) => {
    const d = drag.current;
    if (!d.on || e.pointerId !== d.id) return;
    const x = e.nativeEvent.clientX ?? 0, y = e.nativeEvent.clientY ?? 0;
    const dx = x - d.x, dy = y - d.y;
    d.x = x; d.y = y; d.moved += Math.abs(dx) + Math.abs(dy);
    const k = 0.0062 * (rig.dist / DIST.world);
    userNudge(dx * k, dy * k);
    rig.vy = dx * k * 14; rig.vp = dy * k * 14;
  };
  const onUp = (e: ThreeEvent<PointerEvent>) => {
    const d = drag.current;
    if (!d.on || e.pointerId !== d.id) return;
    d.on = false; rig.dragging = false; rig.idleT = 0;
    (e.target as Element | undefined)?.releasePointerCapture?.(e.pointerId);
  };

  useEffect(() => {
    const el = gl.domElement;
    const onWheel = (ev: WheelEvent) => { ev.preventDefault(); userZoom(ev.deltaY > 0 ? 1.12 : 0.89); };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [gl]);

  useFrame((state, dt) => {
    /* Highlight overlay: redraw when the set changes, and at ~10fps while a
     * country is focused so its outline can pulse. */
    const h = hlRef.current;
    const key = `${h.focused}|${h.highlighted.join(",")}|${Object.entries(h.heat).map(([k, v]) => `${k}:${(v ?? 0).toFixed(2)}`).join(",")}`;
    const t = state.clock.elapsedTime;
    if (key !== h.key || (h.focused && t - h.lastDraw > 0.1)) {
      h.key = key; h.lastDraw = t;
      hl.draw({ focused: h.focused, highlighted: h.highlighted, heat: h.heat, pulse: (t * 0.6) % 1 });
    }
    if (ringsRef.current) {
      ringsRef.current.children[0].rotation.z += dt * 0.05;
      ringsRef.current.children[1].rotation.z -= dt * 0.035;
    }
  });

  /* Countries without polygons in the 110m set (Hong Kong) get a glow disc. */
  const tinyMarkers = useMemo(() => {
    const out: { code: CountryCode; pos: THREE.Vector3 }[] = [];
    for (const code of ["HK", "SG"] as CountryCode[]) {
      const cd = COUNTRIES[code];
      out.push({ code, pos: latLngToVec3(cd.lat, cd.lng, R * 1.004) });
    }
    return out;
  }, []);

  return (
    <group>
      {/* Planet */}
      <mesh onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onPointerLeave={onUp}>
        <sphereGeometry args={[R, 96, 64]} />
        <meshStandardMaterial
          map={base.texture}
          emissiveMap={base.texture}
          emissive={new THREE.Color("#ffffff")}
          emissiveIntensity={0.62}
          roughness={0.85}
          metalness={0.15}
        />
      </mesh>

      {/* Live highlight overlay (additive) */}
      <mesh scale={1.003}>
        <sphereGeometry args={[R, 96, 64]} />
        <meshBasicMaterial map={hl.texture} transparent blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} />
      </mesh>

      {tinyMarkers.map((m) => {
        const active = focused === m.code || highlighted.includes(m.code) || (heat[m.code] ?? 0) > 0;
        return active ? (
          <mesh key={m.code} position={m.pos} quaternion={new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), m.pos.clone().normalize())}>
            <circleGeometry args={[0.03, 24]} />
            <meshBasicMaterial color={C.cyan} transparent opacity={0.8} blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} />
          </mesh>
        ) : null;
      })}

      {/* Atmosphere: inner rim + two back-side halos */}
      <mesh scale={1.012} material={rimInner}><sphereGeometry args={[R, 64, 48]} /></mesh>
      <mesh scale={1.07} material={halo}><sphereGeometry args={[R, 48, 32]} /></mesh>
      <mesh scale={1.16} material={halo2}><sphereGeometry args={[R, 48, 32]} /></mesh>

      {/* Holographic orbit rings */}
      <group ref={ringsRef}>
        <mesh rotation={[Math.PI / 2 + 0.35, 0.1, 0]}>
          <ringGeometry args={[R * 1.42, R * 1.428, 180]} />
          <meshBasicMaterial color={C.sol} transparent opacity={0.34} side={THREE.DoubleSide} blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} />
        </mesh>
        <mesh rotation={[Math.PI / 2 - 0.55, -0.4, 0]}>
          <ringGeometry args={[R * 1.62, R * 1.624, 180]} />
          <meshBasicMaterial color={C.solGreen} transparent opacity={0.16} side={THREE.DoubleSide} blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} />
        </mesh>
      </group>
    </group>
  );
}

/* ---------------- Stars ---------------- */

export function Stars({ count = 2200 }: { count?: number }) {
  const { positions, sizes } = useMemo(() => {
    const positions = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    let seed = 1337;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
    for (let i = 0; i < count; i++) {
      const u = rnd() * 2 - 1, a = rnd() * Math.PI * 2;
      const r = Math.sqrt(1 - u * u), rad = 26 + rnd() * 18;
      positions[i * 3] = Math.cos(a) * r * rad;
      positions[i * 3 + 1] = u * rad;
      positions[i * 3 + 2] = Math.sin(a) * r * rad;
      sizes[i] = 0.08 + Math.pow(rnd(), 3) * 0.32;
    }
    return { positions, sizes };
  }, [count]);
  const geom = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    g.setAttribute("size", new THREE.BufferAttribute(sizes, 1));
    return g;
  }, [positions, sizes]);
  const mat = useMemo(() => new THREE.ShaderMaterial({
    uniforms: { color: { value: new THREE.Color(C.frost) }, time: { value: 0 } },
    vertexShader: /* glsl */ `
      attribute float size; varying float vA; uniform float time;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        float tw = 0.75 + 0.25 * sin(time * 1.7 + position.x * 3.1 + position.y * 2.3);
        vA = tw;
        gl_PointSize = size * tw * (300.0 / -mv.z);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 color; varying float vA;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        float a = smoothstep(0.5, 0.05, d) * vA;
        gl_FragColor = vec4(color, a);
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  }), []);
  useFrame((s) => { mat.uniforms.time.value = s.clock.elapsedTime; });
  return <points geometry={geom} material={mat} frustumCulled={false} />;
}
