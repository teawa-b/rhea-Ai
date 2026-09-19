/* The holdings planet: a Solana-banded gas giant out in space whose moons are
 * the user's wallet — USDC, SOL and one moon per tokenized-stock position,
 * sized by value and labelled with amounts. "Show me my holdings" flies the
 * camera here (desktop) or swaps it in for Earth (headset); see travel in
 * CameraRig. */
import { Line } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useXR } from "@react-three/xr";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { COMPANY_BY_ID } from "@shared/registry";
import { logoUrl } from "@/market/logos";
import { C, fmtUsd } from "@/theme";
import { useMarket } from "@/state/market";
import { useWorld } from "@/state/world";
import { HoloLabel } from "./HoloLabel";
import { PLANET_POS, XR_PLANET_POS, XR_PLANET_SCALE, travel } from "./CameraRig";

type Moon = { id: string; title: string; subtitle: string; color: string; size: number; icon?: string; onClick?: () => void };

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

function circlePoints(r: number, n = 96): [number, number, number][] {
  return Array.from({ length: n + 1 }, (_, i) => { const a = (i / n) * Math.PI * 2; return [Math.cos(a) * r, 0, Math.sin(a) * r] as [number, number, number]; });
}

function OrbitingMoon({ moon, index, radius }: { moon: Moon; index: number; radius: number }) {
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
    <group>
      <Line points={ring} color={moon.color} lineWidth={1} transparent opacity={0.22} toneMapped={false} />
      <group ref={pivot}>
        <group position={[radius, 0, 0]}>
          <mesh ref={body} onClick={moon.onClick ? (e) => { e.stopPropagation(); moon.onClick!(); } : undefined}>
            <sphereGeometry args={[moon.size, 24, 16]} />
            <meshStandardMaterial color={new THREE.Color(moon.color).multiplyScalar(0.35)} emissive={moon.color} emissiveIntensity={1.1} roughness={0.35} />
          </mesh>
          <mesh scale={1.35}>
            <sphereGeometry args={[moon.size, 16, 12]} />
            <meshBasicMaterial color={moon.color} transparent opacity={0.14} blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} />
          </mesh>
          <HoloLabel position={[0, moon.size + 0.34, 0]} title={moon.title} subtitle={moon.subtitle} accent={moon.color} scale={1.05} icon={moon.icon} onClick={moon.onClick} />
        </group>
      </group>
    </group>
  );
}

export function HoldingsPlanet() {
  const inXR = useXR((s) => s.mode) != null;
  const portfolio = useMarket((s) => s.portfolio);
  const vault = useWorld((s) => s.vault);
  const focusCompany = useWorld((s) => s.focusCompany);
  const bands = useBandTexture();
  const root = useRef<THREE.Group>(null);
  const planet = useRef<THREE.Mesh>(null);
  const ringRef = useRef<THREE.Mesh>(null);

  /* Refresh balances whenever the user comes here. */
  useEffect(() => { if (vault) void useMarket.getState().loadPortfolio(); }, [vault]);

  useFrame((s, dt) => {
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
    if (planet.current) planet.current.rotation.y += dt * 0.08;
    if (ringRef.current) ringRef.current.rotation.z = s.clock.elapsedTime * 0.02;
  });

  const moons = useMemo<Moon[]>(() => {
    if (!portfolio) return [];
    const stocks = [...portfolio.positions].sort((a, b) => (b.valueUsd ?? 0) - (a.valueUsd ?? 0));
    const maxUsd = Math.max(1, portfolio.usdcBalance, ...stocks.map((p) => p.valueUsd ?? 0));
    const sizeFor = (usd: number) => 0.09 + 0.12 * Math.sqrt(Math.max(0, usd) / maxUsd);
    return [
      { id: "usdc", title: "USDC", subtitle: fmtUsd(portfolio.usdcBalance), color: "#2775ca", size: sizeFor(portfolio.usdcBalance) },
      { id: "sol", title: "SOL", subtitle: `${portfolio.solBalance.toFixed(4)} SOL`, color: C.sol, size: 0.11 },
      ...stocks.map((p) => ({
        id: p.mint,
        title: COMPANY_BY_ID[p.companyId]?.ticker ?? p.symbol,
        subtitle: `${p.amountUi.toFixed(p.amountUi < 1 ? 4 : 2)} ${p.symbol} · ${fmtUsd(p.valueUsd)}`,
        color: C.solGreen,
        size: sizeFor(p.valueUsd ?? 0),
        icon: logoUrl(p.companyId),
        onClick: () => focusCompany(p.companyId, "user"),
      })),
    ];
  }, [portfolio, focusCompany]);

  const stocksUsd = portfolio?.positions.reduce((s, p) => s + (p.valueUsd ?? 0), 0) ?? 0;
  const headline = portfolio
    ? `${fmtUsd(portfolio.totalValueUsd)} · ${portfolio.positions.length} stock${portfolio.positions.length === 1 ? "" : "s"} ${fmtUsd(stocksUsd)}`
    : "Sign in to see your wallet";

  return (
    <group ref={root} visible={false}>
      <group rotation={[0.42, 0, -0.1]}>
        <mesh ref={planet}>
          <sphereGeometry args={[1, 64, 48]} />
          <meshStandardMaterial map={bands} emissiveMap={bands} emissive="#ffffff" emissiveIntensity={0.55} roughness={0.8} />
        </mesh>
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
        {moons.map((m, i) => <OrbitingMoon key={m.id} moon={m} index={i} radius={1.75 + i * Math.min(0.4, 1.9 / Math.max(1, moons.length - 1))} />)}
      </group>
      <HoloLabel position={[0, 1.85, 0]} title="Your holdings" subtitle={headline} accent={C.solGreen} scale={1.35} />
    </group>
  );
}
