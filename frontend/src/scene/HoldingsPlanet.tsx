/* The holdings planet: a Solana-banded world out in space that *is* the user's
 * wallet. Every tokenized-stock position is a shop on its surface — the
 * company's logo over the door, bigger premises the more the position is worth
 * — so the skyline is the portfolio, and a stock the user has just bought is
 * built the first time they see it. The cash-like balances (USDC, SOL) stay
 * little balls in orbit. "Show me my holdings" flies the camera here (desktop)
 * or swaps it in for Earth (headset); see travel in CameraRig. */
import { Line, Text } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useXR } from "@react-three/xr";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { COMPANY_BY_ID } from "@shared/registry";
import { logoUrl } from "@/market/logos";
import { C, fmtUsd } from "@/theme";
import { useMarket } from "@/state/market";
import { useWorld } from "@/state/world";
import { FONT_BOLD } from "./fonts";
import { HoloLabel } from "./HoloLabel";
import { PLANET_POS, XR_PLANET_POS, XR_PLANET_SCALE, travel } from "./CameraRig";
import { clamp, damp, nearestAngle } from "./geo";
import { useLogoTexture } from "./logoTexture";
import { feel } from "./xrFeedback";

/** An orbiting balance (cash-like: USDC, SOL). */
type Ball = { id: string; title: string; subtitle: string; color: string; size: number };
/** A stock position, open for business on the planet. */
type Shop = {
  id: string;            // token mint — the deed to the plot
  companyId: string;
  title: string;
  subtitle: string;
  dir: THREE.Vector3;    // unit surface normal of its plot
  width: number;
  depth: number;
  height: number;
  /** Big holdings get premises with a flat roof and a rooftop sign, not a gable. */
  tower: boolean;
  floors: number;
  accent: string;
  icon?: string;
  label: boolean;
  /** How far up the screen its chip floats — staggered so neighbours don't stack. */
  lift: number;
};

const UP = new THREE.Vector3(0, 1, 0);
/** Slow sway: the planet keeps breathing without carrying the town out of view. */
const SWAY = 0.09;
const RISE_S = 1.15;            // how long a new shop takes to build
/** The most shops the town holds — the ring keeps a couple of plots spare for
 * hash collisions. Past this the smallest positions are left to the panel. */
const MAX_SHOPS = 18;
/** A headset pays for every draw call: fewer premises, and the panel has the rest. */
const XR_SHOPS = 12;

/* Fixed lattice of plots. The town rings the face the flight parks in front of
 * the viewer, 29°–66° off it: dead ahead a shop shows nothing but its roof, and
 * past ~75° it is lost on the limb, while in that band every building is seen
 * in three-quarter view, the way you'd look down a street. Plots are handed out
 * by mint, so a stock always rebuilds on its own spot and a new buy takes a
 * free plot instead of shuffling the town around. */
const PLOTS = 20;
/* The point of the planet, in its own frame, that ends up facing the viewer —
 * measured against the desktop flight; the headset lands within a few degrees
 * of it. Everything below is laid out around this direction. */
const FACE = new THREE.Vector3(Math.sin(-0.1) * Math.cos(0.62), Math.sin(0.62), Math.cos(-0.1) * Math.cos(0.62));
const FACE_EAST = new THREE.Vector3().crossVectors(UP, FACE).normalize();
const FACE_NORTH = new THREE.Vector3().crossVectors(FACE, FACE_EAST);
const PLOT_DIRS: THREE.Vector3[] = Array.from({ length: PLOTS }, (_, i) => {
  /* Swept right around the face, with the distance out jittered by the golden
   * ratio so neighbours in the sweep never end up on the same doorstep. */
  const rho = 0.5 + 0.65 * ((i * 0.6180339887) % 1);
  const th = 2 * Math.PI * ((i + 0.5) / PLOTS);
  return FACE.clone().multiplyScalar(Math.cos(rho))
    .addScaledVector(FACE_EAST, Math.sin(rho) * Math.cos(th))
    .addScaledVector(FACE_NORTH, Math.sin(rho) * Math.sin(th));
});

/** cos of the smallest angle between two chipped plots (~32° apart on the globe). */
const CHIP_SPACING = Math.cos(0.56);

/** Shop colours: one per company, off the app's own palette so the town stays
 * cyan-on-void rather than turning into a paint chart. */
const SHOP_COLORS = [C.solGreen, C.cyan, C.violet, C.sol, C.cyanDeep] as const;

/** Orbit planes for the cash balances, tipped apart so they read as two orbits. */
const BALL_TILTS: [number, number, number][] = [[0.14, 0, -0.1], [-0.24, 0, 0.16]];

/** FNV-1a: a mint always hashes to the same plot, in this session and the next. */
function hash32(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/** mint → plot index, collisions probed in a stable (sorted) order. */
function assignPlots(mints: string[]): Map<string, number> {
  const taken = new Set<number>();
  const out = new Map<string, number>();
  for (const mint of [...mints].sort()) {
    let i = hash32(mint) % PLOTS;
    while (taken.has(i)) i = (i + 1) % PLOTS;
    taken.add(i);
    out.set(mint, i);
  }
  return out;
}

/* Horizontal Solana bands (purple → teal → green) with soft turbulence. */
function useBandTexture() {
  const tex = useMemo(() => {
    const c = document.createElement("canvas");
    c.width = 16; c.height = 512;
    const ctx = c.getContext("2d")!;
    const g = ctx.createLinearGradient(0, 0, 0, 512);
    const stops: [number, string][] = [[0, "#1a0b33"], [0.14, "#5a1fb8"], [0.26, "#9945ff"], [0.36, "#3b1a7a"], [0.47, "#1b6c8a"], [0.53, "#3fe0ff"], [0.6, "#14315a"], [0.7, "#0f8f6a"], [0.78, "#14f195"], [0.88, "#3b1a7a"], [1, "#12071f"]];
    for (const [o, col] of stops) g.addColorStop(o, col);
    ctx.fillStyle = g; ctx.fillRect(0, 0, 16, 512);
    let seed = 7;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
    for (let i = 0; i < 90; i++) { ctx.fillStyle = `rgba(${rnd() > 0.5 ? "5,6,13" : "232,244,255"},${0.05 + rnd() * 0.1})`; ctx.fillRect(0, rnd() * 512, 16, 1 + rnd() * 5); }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }, []);
  useEffect(() => () => tex.dispose(), [tex]);
  return tex;
}

/* Two tiny canvases the whole town shares: the render (pale walls, windows lit
 * or dark) and the same windows again on black, so only they glow. Both are
 * painted from the same seed, so the lit windows line up. Built on first use
 * and kept for the app's lifetime. */
let WALLS: THREE.Texture | null = null;
let GLOW: THREE.Texture | null = null;
function paintWall(wall: string, dark: string, lit: (a: number) => string): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = 32; c.height = 32;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = wall; ctx.fillRect(0, 0, 32, 32);
  let seed = 13;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 4; col++) {
      const on = rnd();
      ctx.fillStyle = on < 0.25 ? dark : lit(0.55 + on * 0.45);   // a few floors are out
      ctx.fillRect(3 + col * 7, 4 + row * 8, 4, 5);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
function wallTextures(): [THREE.Texture, THREE.Texture] {
  WALLS ??= paintWall("#e7edf9", "#33446b", (a) => `rgba(255,209,140,${a})`);
  GLOW ??= paintWall("#000000", "#000000", (a) => `rgba(255,216,158,${a})`);
  return [WALLS, GLOW];
}

/** The shared wall canvases, tiled to this building's floor count. */
function useFloors(floors: number) {
  const tex = useMemo(() => wallTextures().map((base) => {
    const t = base.clone();
    t.needsUpdate = true;
    t.repeat.set(1, floors);
    return t;
  }), [floors]);
  useEffect(() => () => tex.forEach((t) => t.dispose()), [tex]);
  return tex;
}

function circlePoints(r: number, n = 96): [number, number, number][] {
  return Array.from({ length: n + 1 }, (_, i) => { const a = (i / n) * Math.PI * 2; return [Math.cos(a) * r, 0, Math.sin(a) * r] as [number, number, number]; });
}

/* Cash-like balances keep the old moon treatment: a small glowing ball on a
 * drawn orbit, with its amount on a chip. */
function OrbitingBall({ ball, index, radius, tilt }: { ball: Ball; index: number; radius: number; tilt: [number, number, number] }) {
  const pivot = useRef<THREE.Group>(null);
  const body = useRef<THREE.Mesh>(null);
  const phase = index * 2.399; // golden angle keeps neighbours apart
  const speed = 0.16 / (1 + index * 0.35);
  useFrame((s) => {
    const t = s.clock.elapsedTime;
    if (pivot.current) pivot.current.rotation.y = phase + t * speed;
    if (body.current) body.current.rotation.y = t * 0.6;
  });
  const ring = useMemo(() => circlePoints(radius), [radius]);
  return (
    <group rotation={tilt}>
      <Line points={ring} color={ball.color} lineWidth={1} transparent opacity={0.22} toneMapped={false} />
      <group ref={pivot}>
        <group position={[radius, 0, 0]}>
          <mesh ref={body}>
            <sphereGeometry args={[ball.size, 24, 16]} />
            <meshStandardMaterial color={new THREE.Color(ball.color).multiplyScalar(0.35)} emissive={ball.color} emissiveIntensity={1.1} roughness={0.35} />
          </mesh>
          <mesh scale={1.35}>
            <sphereGeometry args={[ball.size, 16, 12]} />
            <meshBasicMaterial color={ball.color} transparent opacity={0.14} blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} />
          </mesh>
          <HoloLabel position={[0, ball.size + 0.34, 0]} title={ball.title} subtitle={ball.subtitle} accent={ball.color} scale={1.05} />
        </group>
      </group>
    </group>
  );
}

const _p = new THREE.Vector3();
const _n = new THREE.Vector3();
const _v = new THREE.Vector3();
const _cam = new THREE.Vector3();
const _up = new THREE.Vector3();
const _q = new THREE.Quaternion();

/* One stock position, open on its plot: lit windows, a shopfront under a
 * canopy and the company's logo on the sign above it. The premises turn on
 * their plot to keep that sign toward the viewer as the planet rotates.
 * `rise` is the delay in seconds before it is built (null = already standing);
 * building only starts once the planet is on screen, so a buy made back at
 * Earth is still shown going up on arrival. */
function Storefront({ b, rise, inXR, onBuilt }: { b: Shop; rise: number | null; inXR: boolean; onBuilt: (id: string) => void }) {
  const focusCompany = useWorld((s) => s.focusCompany);
  const camera = useThree((s) => s.camera);
  const [walls, glow] = useFloors(b.floors);
  const logo = useLogoTexture(b.icon);
  const quat = useMemo(() => new THREE.Quaternion().setFromUnitVectors(UP, b.dir), [b.dir]);
  const pos = useMemo(() => b.dir.clone().multiplyScalar(0.98), [b.dir]);

  const root = useRef<THREE.Group>(null);
  const face = useRef<THREE.Group>(null);
  const riser = useRef<THREE.Group>(null);
  const chip = useRef<THREE.Group>(null);
  const beacon = useRef<THREE.Mesh>(null);
  /* Build progress, the wait before it starts and the sign's heading, kept out
   * of React so a portfolio refresh mid-animation never restarts any of it. */
  const built = useRef(rise == null ? 1 : 0);
  const wait = useRef(rise ?? 0);
  const facing = useRef(0);
  const yaw = useRef(0);

  const open = useCallback(() => focusCompany(b.companyId, "user"), [focusCompany, b.companyId]);

  const w = b.width;
  const d = b.depth;
  const h = b.height;
  const sill = Math.min(0.055, h * 0.3);    // shopfront glass
  const sign = w * 0.52;                    // the board over the door

  useFrame((s, dt) => {
    const g = root.current;
    if (!g || travel.k <= 0.002) return;
    if (built.current < 1 && travel.k > 0.25) {
      if (wait.current > 0) wait.current -= dt;
      else {
        built.current = Math.min(1, built.current + dt / RISE_S);
        if (built.current >= 1) onBuilt(b.id);
      }
    }
    const k = built.current;
    const ease = 1 - Math.pow(1 - k, 3);
    if (riser.current) riser.current.scale.set(1, Math.max(0.001, ease * (1 + 0.1 * Math.sin(Math.PI * k))), 1);

    g.updateWorldMatrix(true, false);
    _p.setFromMatrixPosition(g.matrixWorld);
    _n.copy(UP).transformDirection(g.matrixWorld);
    camera.getWorldPosition(_cam);
    _v.subVectors(_cam, _p).normalize();
    const front = _n.dot(_v);
    g.getWorldQuaternion(_q).invert();

    /* Turn the premises on their plot so the sign faces the viewer. */
    _v.applyQuaternion(_q);
    yaw.current = damp(yaw.current, nearestAngle(Math.atan2(_v.x, _v.z), yaw.current), 3, dt);
    if (face.current) face.current.rotation.y = yaw.current;

    /* A chip only where the planet is turned toward the viewer — near the limb
     * a whole district projects into the same few pixels — faded in by scale,
     * which needs no per-frame React state. */
    const want = b.label ? clamp((front - 0.3) / 0.25, 0, 1) * ease : 0;
    facing.current = damp(facing.current, want, 6, dt);
    if (chip.current) {
      const show = facing.current > 0.02;
      chip.current.visible = show;
      if (show) {
        /* Screen-up in this plot's frame: a shop pointing straight at the
         * camera would otherwise wear its own chip as a mask. */
        _up.setFromMatrixColumn(camera.matrixWorld, 1).applyQuaternion(_q).normalize();
        chip.current.position.set(0, (h + sign) * ease + 0.04, 0).addScaledVector(_up, b.lift);
        chip.current.scale.setScalar(facing.current);
      }
    }
    if (beacon.current) (beacon.current.material as THREE.MeshBasicMaterial).opacity = 0.5 + 0.35 * Math.sin(s.clock.elapsedTime * 2.2 + b.dir.x * 6);
  });

  return (
    <group ref={root} position={pos} quaternion={quat}>
      {/* the plot: paved and lit before anything stands on it */}
      <mesh position={[0, 0.014, 0]}>
        <cylinderGeometry args={[w * 0.72, w * 0.78, 0.028, 20]} />
        <meshStandardMaterial color="#0a1226" emissive={b.accent} emissiveIntensity={0.14} roughness={0.7} />
      </mesh>
      <group ref={face}>
        <group ref={riser}>
          {/* the premises: lit windows on every floor */}
          <mesh position={[0, h / 2, 0]} onClick={(e) => { e.stopPropagation(); feel.press(e); open(); }} onPointerOver={(e) => feel.hover(e)}>
            <boxGeometry args={[w, h, d]} />
            <meshStandardMaterial map={walls} emissive="#ffd7a0" emissiveMap={glow} emissiveIntensity={1.15} roughness={0.72} />
          </mesh>
          {/* shopfront: warm glass at street level, with a canopy over it */}
          <mesh position={[0, sill / 2 + 0.008, d / 2 + 0.003]}>
            <boxGeometry args={[w * 0.68, sill, 0.012]} />
            <meshStandardMaterial color="#13223d" emissive="#ffd9a0" emissiveIntensity={0.45} roughness={0.35} />
          </mesh>
          {inXR ? null : (
            <mesh position={[0, sill + 0.032, d / 2 + 0.024]} rotation={[-0.42, 0, 0]}>
              <boxGeometry args={[w * 0.98, 0.012, 0.054]} />
              <meshStandardMaterial color={b.accent} emissive={b.accent} emissiveIntensity={0.5} roughness={0.6} />
            </mesh>
          )}
          {/* roof: a gable over a shop, a parapet and a mast over head office */}
          {b.tower ? (
            <>
              <mesh position={[0, h + 0.012, 0]}>
                <boxGeometry args={[w * 1.08, 0.024, d * 1.08]} />
                <meshStandardMaterial color={b.accent} emissive={b.accent} emissiveIntensity={0.45} roughness={0.6} />
              </mesh>
              {inXR ? null : (
                <mesh position={[0, h + 0.044, 0]}>
                  <boxGeometry args={[w * 0.4, 0.04, d * 0.4]} />
                  <meshStandardMaterial color="#0b1428" emissive={b.accent} emissiveIntensity={0.45} roughness={0.5} />
                </mesh>
              )}
              <mesh ref={beacon} position={[0, h + 0.088, 0]}>
                <octahedronGeometry args={[w * 0.12, 0]} />
                <meshBasicMaterial color={C.white} transparent opacity={0.8} toneMapped={false} />
              </mesh>
            </>
          ) : (
            <group position={[0, h, 0]} scale={[1, 0.6, 1]}>
              <mesh rotation={[0, 0, Math.PI / 4]}>
                <boxGeometry args={[w * 0.72, w * 0.72, d * 1.06]} />
                <meshStandardMaterial color={b.accent} emissive={b.accent} emissiveIntensity={0.4} roughness={0.65} />
              </mesh>
            </group>
          )}
          {/* the sign over the door: the company's own mark, or its ticker */}
          <group position={[0, h + (b.tower ? sign * 0.42 : sign * 0.26), d / 2 + 0.006]}>
            <mesh position={[0, 0, -0.002]}>
              <boxGeometry args={[sign * 1.24, sign * 1.14, 0.012]} />
              <meshStandardMaterial color={b.accent} emissive={b.accent} emissiveIntensity={0.45} roughness={0.6} />
            </mesh>
            <mesh position={[0, 0, 0.005]}>
              <boxGeometry args={[sign * 1.08, sign, 0.012]} />
              <meshStandardMaterial color="#f4f8ff" emissive="#dce9ff" emissiveIntensity={0.25} roughness={0.6} />
            </mesh>
            {logo ? (
              <mesh position={[0, 0, 0.012]}>
                <planeGeometry args={[sign * 0.78, sign * 0.78]} />
                <meshBasicMaterial map={logo} transparent toneMapped={false} />
              </mesh>
            ) : (
              <Text font={FONT_BOLD} position={[0, 0, 0.012]} fontSize={sign * 0.32} color="#0b1428" anchorX="center" anchorY="middle" letterSpacing={0.02} maxWidth={sign}>
                {b.title}
              </Text>
            )}
          </group>
        </group>
      </group>
      <group ref={chip} visible={false}>
        <HoloLabel position={[0, 0, 0]} title={b.title} subtitle={b.subtitle} accent={b.accent} scale={inXR ? 0.95 : 0.72} icon={b.icon} onClick={open} />
      </group>
    </group>
  );
}

export function HoldingsPlanet() {
  const inXR = useXR((s) => s.mode) != null;
  const portfolio = useMarket((s) => s.portfolio);
  const vault = useWorld((s) => s.vault);
  const bands = useBandTexture();
  const root = useRef<THREE.Group>(null);
  const spin = useRef<THREE.Group>(null);
  const ringRef = useRef<THREE.Mesh>(null);

  /* Refresh balances whenever the user comes here. */
  useEffect(() => { if (vault) void useMarket.getState().loadPortfolio(); }, [vault]);

  const balls = useMemo<Ball[]>(() => {
    if (!portfolio) return [];
    const share = portfolio.totalValueUsd > 0 ? clamp(portfolio.usdcBalance / portfolio.totalValueUsd, 0, 1) : 0;
    return [
      { id: "usdc", title: "USDC", subtitle: fmtUsd(portfolio.usdcBalance), color: "#2775ca", size: 0.085 + 0.05 * Math.sqrt(share) },
      { id: "sol", title: "SOL", subtitle: `${portfolio.solBalance.toFixed(4)} SOL`, color: C.sol, size: 0.095 },
    ];
  }, [portfolio]);

  const shops = useMemo<Shop[]>(() => {
    if (!portfolio) return [];
    const stocks = [...portfolio.positions].sort((a, b) => (b.valueUsd ?? 0) - (a.valueUsd ?? 0)).slice(0, inXR ? XR_SHOPS : MAX_SHOPS);
    const plots = assignPlots(stocks.map((p) => p.mint));
    const maxUsd = Math.max(1, ...stocks.map((p) => p.valueUsd ?? 0));
    /* Chips go to the biggest holdings, and only one per neighbourhood: two
     * shops a few degrees apart would wear each other's labels. Every shop
     * still carries its own sign, and the panel lists them all. */
    const cap = inXR ? 2 : 3;
    const chipped: THREE.Vector3[] = [];
    /* A crowded district builds smaller premises so the plots still fit. */
    const room = 1 - 0.22 * clamp((stocks.length - 6) / 14, 0, 1);
    return stocks.map((p, i) => {
      const rel = Math.sqrt(clamp((p.valueUsd ?? 0) / maxUsd, 0, 1));
      const shape = hash32(p.companyId);
      const width = (0.135 + 0.065 * rel) * room;
      const height = (0.16 + 0.2 * rel) * room;
      const dir = PLOT_DIRS[plots.get(p.mint) ?? i % PLOTS];
      const label = chipped.length < cap && chipped.every((d) => d.dot(dir) < CHIP_SPACING);
      if (label) chipped.push(dir);
      return {
        id: p.mint,
        companyId: p.companyId,
        title: COMPANY_BY_ID[p.companyId]?.ticker ?? p.symbol,
        subtitle: `${p.amountUi.toFixed(p.amountUi < 1 ? 4 : 2)} ${p.symbol} · ${fmtUsd(p.valueUsd)}`,
        dir,
        width,
        /* A little variety in the footprints, fixed per company. */
        depth: width * (0.82 + (shape % 3) * 0.12),
        height,
        tower: rel > 0.62,
        /* Floors sized off the footprint so the windows stay square-ish. */
        floors: clamp(Math.round(height / (width * 0.75)), 1, 4),
        accent: SHOP_COLORS[shape % SHOP_COLORS.length],
        icon: logoUrl(p.companyId),
        label,
        lift: 0.12 + (i % 3) * 0.07,
      };
    });
  }, [portfolio, inXR]);

  /* Which shops still have to be built, and how long each waits first: the whole
   * town goes up (staggered) the first time the user sees it, and a stock
   * bought later is built on its own. */
  const [rising, setRising] = useState<Map<string, number>>(() => new Map());
  const known = useRef<Set<string> | null>(null);
  /* A different wallet is a different town: forget what was already standing. */
  useEffect(() => { known.current = null; setRising((prev) => (prev.size ? new Map() : prev)); }, [portfolio?.wallet]);
  useEffect(() => {
    if (!portfolio) return;
    const mints = portfolio.positions.map((p) => p.mint);
    const first = known.current == null;
    const seen = (known.current ??= new Set<string>());
    const fresh = mints.filter((m) => !seen.has(m));
    for (const m of mints) seen.add(m);
    if (!fresh.length) return;
    setRising((prev) => {
      const next = new Map(prev);
      fresh.forEach((m, i) => next.set(m, first ? 0.25 + i * 0.09 : 0.2));
      return next;
    });
  }, [portfolio]);
  const onBuilt = useCallback((id: string) => setRising((prev) => {
    if (!prev.has(id)) return prev;
    const next = new Map(prev);
    next.delete(id);
    return next;
  }), []);

  useFrame((s) => {
    const g = root.current;
    if (!g) return;
    const k = travel.k;
    g.visible = k > 0.002;
    if (!g.visible) return;
    if (inXR) {
      g.position.copy(XR_PLANET_POS);
      /* grows in with a slight overshoot */
      const pop = k < 1 ? k * (1 + 0.18 * Math.sin(Math.PI * k)) : 1;
      g.scale.setScalar(XR_PLANET_SCALE * pop);
    } else {
      g.position.copy(PLANET_POS);
      g.scale.setScalar(1);
    }
    if (spin.current) spin.current.rotation.y = Math.sin(s.clock.elapsedTime * 0.07) * SWAY;
    if (ringRef.current) ringRef.current.rotation.z = s.clock.elapsedTime * 0.02;
  });

  const stocksUsd = portfolio?.positions.reduce((s, p) => s + (p.valueUsd ?? 0), 0) ?? 0;
  const headline = !portfolio
    ? "Sign in to see your wallet"
    : portfolio.positions.length === 0
      ? `${fmtUsd(portfolio.totalValueUsd)} · no stocks yet — buy one to build here`
      : `${fmtUsd(portfolio.totalValueUsd)} · ${portfolio.positions.length} stock${portfolio.positions.length === 1 ? "" : "s"} ${fmtUsd(stocksUsd)}`;

  return (
    <group ref={root} visible={false}>
      <group rotation={[0.42, 0, -0.1]}>
        {/* the planet and everything built on it turn together */}
        <group ref={spin}>
          <mesh>
            <sphereGeometry args={[1, 64, 48]} />
            <meshStandardMaterial map={bands} emissiveMap={bands} emissive="#ffffff" emissiveIntensity={0.55} roughness={0.8} />
          </mesh>
          {shops.map((b) => <Storefront key={b.id} b={b} rise={rising.get(b.id) ?? null} inXR={inXR} onBuilt={onBuilt} />)}
        </group>
        {/* atmosphere */}
        <mesh scale={1.08}>
          <sphereGeometry args={[1, 32, 24]} />
          <meshBasicMaterial color={C.sol} transparent opacity={0.12} side={THREE.BackSide} blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} />
        </mesh>
        {/* ring */}
        <mesh ref={ringRef} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[1.28, 1.52, 96]} />
          <meshBasicMaterial color={C.cyan} transparent opacity={0.16} side={THREE.DoubleSide} depthWrite={false} toneMapped={false} />
        </mesh>
        {balls.map((b, i) => <OrbitingBall key={b.id} ball={b} index={i} radius={1.58 + i * 0.26} tilt={BALL_TILTS[i % BALL_TILTS.length]} />)}
      </group>
      <HoloLabel position={[0, 1.95, 0]} title="Your holdings" subtitle={headline} accent={C.solGreen} scale={1.35} />
    </group>
  );
}
