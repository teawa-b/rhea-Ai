/* The holdings planet: a Solana-banded world out in space that *is* the user's
 * wallet. Every tokenized-stock position stands on its surface as a holographic
 * tower — taller the more it is worth — so the skyline is the portfolio, and a
 * stock the user has just bought rises out of the ground the first time they
 * see it. The cash-like balances (USDC, SOL) stay little balls in orbit.
 * "Show me my holdings" flies the camera here (desktop) or swaps it in for
 * Earth (headset); see travel in CameraRig. */
import { Line } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useXR } from "@react-three/xr";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { COMPANY_BY_ID } from "@shared/registry";
import { logoUrl } from "@/market/logos";
import { C, fmtUsd } from "@/theme";
import { useMarket } from "@/state/market";
import { useWorld } from "@/state/world";
import { HoloLabel } from "./HoloLabel";
import { PLANET_POS, XR_PLANET_POS, XR_PLANET_SCALE, travel } from "./CameraRig";
import { clamp, damp } from "./geo";
import { feel } from "./xrFeedback";

/** An orbiting balance (cash-like: USDC, SOL). */
type Ball = { id: string; title: string; subtitle: string; color: string; size: number };
/** A stock position, built on the planet. */
type Building = {
  id: string;            // token mint — the plot deed
  companyId: string;
  title: string;
  subtitle: string;
  dir: THREE.Vector3;    // unit surface normal of its plot
  height: number;
  width: number;
  /** Height of the narrower tier on top (0 on the smaller holdings). */
  setback: number;
  floors: number;
  icon?: string;
  label: boolean;
  /** How far up the screen its chip floats — staggered so neighbours don't stack. */
  lift: number;
};

const UP = new THREE.Vector3(0, 1, 0);
/* rad/s — slow enough that the skyline you arrive at stays put long enough to read. */
const SPIN = 0.035;
/* The planet's own longitude that arrives facing the viewer just left of the
 * disc's centre (measured against the desktop flight; the headset places the
 * planet within a few degrees of it). The biggest holding is parked there, off
 * centre on purpose: dead ahead a tower shows the viewer its roof, not its
 * face, and its chip has nowhere to sit. */
const HERO_AZIMUTH = -0.55;
const RISE_S = 1.15;            // how long a new tower takes to build
/** Beyond this the skyline stops being readable and the frame budget matters. */
const MAX_BUILDINGS = 40;

/* Fixed lattice of building sites, evenly spread by a Fibonacci spiral over the
 * band the planet's tilt turns toward the viewer — nothing is built at the
 * poles or on the far south, where it could never be read. Plots are handed out
 * by mint, so a stock always rebuilds on its own spot and a new buy takes a
 * free one instead of shuffling the skyline. */
const PLOTS = 96;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const PLOT_DIRS: THREE.Vector3[] = Array.from({ length: PLOTS }, (_, i) => {
  const y = 0.48 + 0.44 * (1 - (2 * i + 1) / PLOTS);
  const r = Math.sqrt(Math.max(0, 1 - y * y));
  const a = i * GOLDEN_ANGLE;
  return new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r);
});

/** cos of the smallest angle between two chipped plots (~32° apart on the globe). */
const CHIP_SPACING = Math.cos(0.56);

/** Orbit planes for the cash balances, tipped apart so they read as two orbits. */
const BALL_TILTS: [number, number, number][] = [[0.14, 0, -0.1], [-0.24, 0, 0.16]];

/** FNV-1a: a mint always hashes to the same plot, in this session and the next. */
function hashMint(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/** mint → plot index, collisions probed in a stable (sorted) order. */
function assignPlots(mints: string[]): Map<string, number> {
  const taken = new Set<number>();
  const out = new Map<string, number>();
  for (const mint of [...mints].sort()) {
    let i = hashMint(mint) % PLOTS;
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

/* One tiny canvas of lit windows for the whole city: four floors that tile up
 * each tower. Built on first use and kept for the app's lifetime. */
let WINDOWS: THREE.Texture | null = null;
function windowTexture(): THREE.Texture {
  if (WINDOWS) return WINDOWS;
  const c = document.createElement("canvas");
  c.width = 32; c.height = 32;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#04060f"; ctx.fillRect(0, 0, 32, 32);
  let seed = 13;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 4; col++) {
      const lit = rnd();
      if (lit < 0.22) continue; // a few dark floors so it reads as windows
      ctx.fillStyle = `rgba(255,255,255,${0.4 + lit * 0.6})`;
      ctx.fillRect(3 + col * 7, 4 + row * 8, 4, 4);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  WINDOWS = t;
  return t;
}

/** The shared window canvas, tiled to this tower's floor count. */
function useFloors(floors: number) {
  const tex = useMemo(() => {
    const t = windowTexture().clone();
    t.needsUpdate = true;
    t.repeat.set(1, floors);
    return t;
  }, [floors]);
  useEffect(() => () => tex.dispose(), [tex]);
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

/* One stock position, standing on its plot. `rise` is the delay in seconds
 * before it builds itself (null = it is already up); building only starts once
 * the planet is actually on screen, so a buy made back at Earth is still shown
 * going up on arrival. */
function Tower({ b, rise, inXR, onBuilt }: { b: Building; rise: number | null; inXR: boolean; onBuilt: (id: string) => void }) {
  const focusCompany = useWorld((s) => s.focusCompany);
  const camera = useThree((s) => s.camera);
  const floors = useFloors(b.floors);
  const quat = useMemo(() => new THREE.Quaternion().setFromUnitVectors(UP, b.dir), [b.dir]);
  const pos = useMemo(() => b.dir.clone().multiplyScalar(0.985), [b.dir]);

  const root = useRef<THREE.Group>(null);
  const body = useRef<THREE.Group>(null);
  const chip = useRef<THREE.Group>(null);
  const beacon = useRef<THREE.Mesh>(null);
  /* Build progress and the wait before it starts, kept out of React so a
   * portfolio refresh mid-animation never restarts it. */
  const built = useRef(rise == null ? 1 : 0);
  const wait = useRef(rise ?? 0);
  const facing = useRef(0);

  const open = useCallback(() => focusCompany(b.companyId), [focusCompany, b.companyId]);

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
    if (body.current) body.current.scale.set(1, Math.max(0.001, ease * (1 + 0.1 * Math.sin(Math.PI * k))), 1);

    /* A chip only where the planet is turned toward the viewer — near the limb
     * a whole district projects into the same few pixels — faded in by scale,
     * which needs no per-frame React state. */
    g.updateWorldMatrix(true, false);
    _p.setFromMatrixPosition(g.matrixWorld);
    _n.copy(UP).transformDirection(g.matrixWorld);
    camera.getWorldPosition(_cam);
    _v.subVectors(_cam, _p).normalize();
    const want = b.label ? clamp((_n.dot(_v) - 0.3) / 0.25, 0, 1) * ease : 0;
    facing.current = damp(facing.current, want, 6, dt);
    if (chip.current) {
      const show = facing.current > 0.02;
      chip.current.visible = show;
      if (show) {
        /* Screen-up in this tower's frame: a tower pointing straight at the
         * camera would otherwise wear its own chip as a mask. */
        _up.setFromMatrixColumn(camera.matrixWorld, 1);
        g.getWorldQuaternion(_q).invert();
        _up.applyQuaternion(_q).normalize();
        chip.current.position.set(0, (b.height + b.setback) * ease + 0.05, 0).addScaledVector(_up, b.lift);
        chip.current.scale.setScalar(facing.current);
      }
    }
    if (beacon.current) (beacon.current.material as THREE.MeshBasicMaterial).opacity = 0.5 + 0.35 * Math.sin(s.clock.elapsedTime * 2.2 + b.dir.x * 6);
  });

  return (
    <group ref={root} position={pos} quaternion={quat}>
      {/* the plot itself, lit before anything stands on it */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.004, 0]}>
        <ringGeometry args={[b.width * 0.72, b.width * 0.98, 18]} />
        <meshBasicMaterial color={C.solGreen} transparent opacity={0.45} side={THREE.DoubleSide} depthWrite={false} toneMapped={false} />
      </mesh>
      <group ref={body}>
        <mesh position={[0, b.height / 2, 0]} onClick={(e) => { e.stopPropagation(); feel.press(e); open(); }} onPointerOver={(e) => feel.hover(e)}>
          <boxGeometry args={[b.width, b.height, b.width]} />
          <meshStandardMaterial color="#081226" emissive={C.solGreen} emissiveMap={floors} emissiveIntensity={1.25} roughness={0.45} metalness={0.15} />
        </mesh>
        {/* holo sheath (desktop only — Quest pays for every extra transparent pass) */}
        {inXR ? null : (
          <mesh position={[0, b.height / 2, 0]} scale={[1.1, 1, 1.1]}>
            <boxGeometry args={[b.width, b.height, b.width]} />
            <meshBasicMaterial color={C.solGreen} transparent opacity={0.09} blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} />
          </mesh>
        )}
        {/* roof slab, then a setback crown on the big holdings */}
        <mesh position={[0, b.height + 0.005, 0]}>
          <boxGeometry args={[b.width * 1.16, 0.01, b.width * 1.16]} />
          <meshStandardMaterial color="#0c1a2e" emissive={C.solGreen} emissiveIntensity={0.45} roughness={0.5} />
        </mesh>
        {b.setback > 0 ? (
          <mesh position={[0, b.height + 0.01 + b.setback / 2, 0]}>
            <boxGeometry args={[b.width * 0.55, b.setback, b.width * 0.55]} />
            <meshStandardMaterial color="#081226" emissive={C.solGreen} emissiveIntensity={0.9} roughness={0.5} metalness={0.15} />
          </mesh>
        ) : null}
        <mesh ref={beacon} position={[0, b.height + b.setback + 0.038, 0]}>
          <octahedronGeometry args={[b.width * 0.3, 0]} />
          <meshBasicMaterial color={C.white} transparent opacity={0.8} toneMapped={false} />
        </mesh>
      </group>
      <group ref={chip} visible={false}>
        <HoloLabel position={[0, 0, 0]} title={b.title} subtitle={b.subtitle} accent={C.solGreen} scale={inXR ? 0.95 : 0.72} icon={b.icon} onClick={open} />
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
  const onScreen = useRef(false);

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

  const buildings = useMemo<Building[]>(() => {
    if (!portfolio) return [];
    const stocks = [...portfolio.positions].sort((a, b) => (b.valueUsd ?? 0) - (a.valueUsd ?? 0)).slice(0, MAX_BUILDINGS);
    const plots = assignPlots(stocks.map((p) => p.mint));
    const maxUsd = Math.max(1, ...stocks.map((p) => p.valueUsd ?? 0));
    /* Chips go to the biggest holdings, and only one per neighbourhood: two
     * towers a few degrees apart would wear each other's labels. The rest are
     * read from the portfolio panel, or by clicking the tower. */
    const cap = inXR ? 4 : 6;
    const chipped: THREE.Vector3[] = [];
    return stocks.map((p, i) => {
      const rel = Math.sqrt(clamp((p.valueUsd ?? 0) / maxUsd, 0, 1));
      const height = 0.13 + 0.25 * rel;
      const width = 0.095 + 0.055 * rel;
      const dir = PLOT_DIRS[plots.get(p.mint) ?? i % PLOTS];
      const label = chipped.length < cap && chipped.every((d) => d.dot(dir) < CHIP_SPACING);
      if (label) chipped.push(dir);
      return {
        id: p.mint,
        companyId: p.companyId,
        title: COMPANY_BY_ID[p.companyId]?.ticker ?? p.symbol,
        subtitle: `${p.amountUi.toFixed(p.amountUi < 1 ? 4 : 2)} ${p.symbol} · ${fmtUsd(p.valueUsd)}`,
        dir,
        height,
        width,
        setback: rel > 0.55 ? 0.05 + 0.07 * rel : 0,
        /* Floors sized off the footprint so the windows stay square-ish. */
        floors: Math.max(1, Math.round(height / (width * 1.7))),
        icon: logoUrl(p.companyId),
        label,
        lift: 0.2 + (i % 3) * 0.14,
      };
    });
  }, [portfolio, inXR]);

  /* Which towers still have to go up, and how long each waits first: the whole
   * skyline builds itself (staggered) the first time the user sees it, and a
   * stock bought later rises on its own. */
  const [rising, setRising] = useState<Map<string, number>>(() => new Map());
  const known = useRef<Set<string> | null>(null);
  /* A different wallet is a different city: forget what was already standing. */
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

  /* Turn the biggest holding toward the viewer as the planet swings into view —
   * a little off dead centre, where a tower is seen in profile and not as a roof. */
  const front = useRef(0);
  useEffect(() => { front.current = buildings.length ? HERO_AZIMUTH - Math.atan2(buildings[0].dir.x, buildings[0].dir.z) : 0; }, [buildings]);

  useFrame((s, dt) => {
    const g = root.current;
    if (!g) return;
    const k = travel.k;
    g.visible = k > 0.002;
    if (!g.visible) { onScreen.current = false; return; }
    if (!onScreen.current && spin.current) spin.current.rotation.y = front.current;
    onScreen.current = true;
    if (inXR) {
      g.position.copy(XR_PLANET_POS);
      /* grows in with a slight overshoot */
      const pop = k < 1 ? k * (1 + 0.18 * Math.sin(Math.PI * k)) : 1;
      g.scale.setScalar(XR_PLANET_SCALE * pop);
    } else {
      g.position.copy(PLANET_POS);
      g.scale.setScalar(1);
    }
    if (spin.current) spin.current.rotation.y += dt * SPIN;
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
          {buildings.map((b) => <Tower key={b.id} b={b} rise={rising.get(b.id) ?? null} inXR={inXR} onBuilt={onBuilt} />)}
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
