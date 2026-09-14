/* One glowing pin per supported country, with a live "N assets" chip.
 * Counts come from the market overview (Jupiter), never hardcoded. */
import { Line } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { COMPANY_BY_ID } from "@shared/registry";
import type { CountrySummary } from "@shared/types";
import { C, assetTint, fmtPct, fmtUsd } from "@/theme";
import { useMarket } from "@/state/market";
import { REGION_BY_ID } from "@/state/regions";
import { useWorld } from "@/state/world";
import { HoloLabel } from "./HoloLabel";
import { R, latLngToVec3 } from "./geo";
import { DIST, rig } from "./rig";

const UP = new THREE.Vector3(0, 1, 0);

function Pin({ cs, rank }: { cs: CountrySummary; rank: number }) {
  /* Neighbouring countries fan their chips out sideways (tangent plane) with
   * a leader line, so Europe / HK-TW stay legible from any angle. */
  const off = useMemo(() => {
    if (!rank) return { x: 0, y: 0.36, z: 0 };
    const a = rank * 2.4;
    return { x: Math.cos(a) * 0.5, y: 0.36 + 0.06 * rank, z: Math.sin(a) * 0.5 };
  }, [rank]);
  const focusedCountry = useWorld((s) => s.focusedCountry);
  const highlighted = useWorld((s) => s.highlightedCountries);
  const view = useWorld((s) => s.view);
  const heat = useWorld((s) => s.countryHeat[cs.code] ?? 0);
  const focusCountry = useWorld((s) => s.focusCountry);
  const orders = useMarket((s) => s.orders);
  const overview = useMarket((s) => s.overview);

  const isFocused = focusedCountry === cs.code;
  const isHot = highlighted.includes(cs.code) || heat > 0;
  const maxAssets = useMarket((s) => s.overview?.countries[0]?.assetCount ?? 1);
  const share = Math.log1p(cs.assetCount) / Math.log1p(Math.max(1, maxAssets));
  const accent = heat > 0 ? C.amber : isFocused ? C.white : assetTint(share);
  const activeRules = useMemo(() => {
    const ids = new Set(cs.companies);
    return orders.filter((o) => o.status === "active" && ids.has(o.companyId)).length;
  }, [orders, cs.companies]);

  const pos = useMemo(() => latLngToVec3(cs.lat, cs.lng, R), [cs.lat, cs.lng]);
  const quat = useMemo(() => new THREE.Quaternion().setFromUnitVectors(UP, pos.clone().normalize()), [pos]);
  const beadRef = useRef<THREE.Mesh>(null);
  const ringRef = useRef<THREE.Mesh>(null);
  const rootRef = useRef<THREE.Group>(null);

  useFrame((s) => {
    const t = s.clock.elapsedTime;
    if (rootRef.current) rootRef.current.scale.setScalar((view === "world" ? 1 : 0.55) * Math.max(0.35, Math.pow(rig.dist / DIST.world, 0.8)));
    if (beadRef.current) {
      const m = beadRef.current.material as THREE.MeshStandardMaterial;
      m.emissiveIntensity = (isFocused ? 2.2 : isHot ? 1.7 : 1.1) + Math.sin(t * 3 + pos.x * 5) * 0.25;
    }
    if (ringRef.current) {
      const p = (t * 0.7 + pos.y) % 1;
      ringRef.current.scale.setScalar(1 + p * 1.6);
      (ringRef.current.material as THREE.MeshBasicMaterial).opacity = (1 - p) * (isFocused || isHot ? 0.8 : 0.45);
    }
  });

  /* Chips on the far side are hidden by the planet's depth test. */
  /* In country/company view the HUD names the place; chips would collide with towers. */
  const showLabel = view === "world";
  /* Region view ("show me Europe"): each pin fans out its stocks' tickers. */
  const focusedRegion = useWorld((s) => s.focusedRegion);
  const inRegion = view === "region" && Boolean(focusedRegion && REGION_BY_ID[focusedRegion]?.countries.includes(cs.code));
  const tradableNote = cs.tradableCount < cs.assetCount ? ` · ${cs.tradableCount} live` : "";
  const labelScale = 0.5;
  const noTradable = cs.tradableCount === 0;

  return (
    <group ref={rootRef} position={pos} quaternion={quat}>
      {/* mast */}
      <mesh position={[0, 0.09, 0]}>
        <cylinderGeometry args={[0.006, 0.012, 0.18, 8]} />
        <meshStandardMaterial color={accent} emissive={accent} emissiveIntensity={0.9} roughness={0.4} />
      </mesh>
      {/* bead */}
      <mesh ref={beadRef} position={[0, 0.2, 0]}>
        <sphereGeometry args={[0.028, 16, 12]} />
        <meshStandardMaterial color={new THREE.Color(accent).multiplyScalar(0.35)} emissive={accent} emissiveIntensity={1.2} roughness={0.3} />
      </mesh>
      {/* ground ring + expanding pulse */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.003, 0]}>
        <ringGeometry args={[0.035, 0.05, 32]} />
        <meshBasicMaterial color={accent} transparent opacity={0.75} side={THREE.DoubleSide} depthWrite={false} toneMapped={false} />
      </mesh>
      <mesh ref={ringRef} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.004, 0]}>
        <ringGeometry args={[0.05, 0.058, 32]} />
        <meshBasicMaterial color={accent} transparent opacity={0.5} side={THREE.DoubleSide} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
      </mesh>
      {/* generous invisible hit target */}
      <mesh position={[0, 0.14, 0]} onClick={(e) => { e.stopPropagation(); focusCountry(cs.code); }}>
        <sphereGeometry args={[0.13, 10, 8]} />
        <meshBasicMaterial visible={false} />
      </mesh>
      {rank > 0 && showLabel ? (
        <Line points={[[0, 0.22, 0], [off.x, off.y - 0.08, off.z]]} color={accent} lineWidth={1} transparent opacity={0.6} toneMapped={false} />
      ) : null}
      {inRegion && focusedRegion ? <TickerCallouts cs={cs} rank={rank} pos={pos} quat={quat} center={REGION_BY_ID[focusedRegion]} /> : null}
      {showLabel ? (
        <HoloLabel
          position={[off.x, off.y, off.z]}
          title={cs.name}
          subtitle={`${cs.assetCount} asset${cs.assetCount === 1 ? "" : "s"}${tradableNote}${activeRules ? ` · ${activeRules} agent${activeRules === 1 ? "" : "s"}` : ""}`}
          accent={accent}
          scale={labelScale}
          dim={noTradable && !isFocused}
          onClick={() => focusCountry(cs.code)}
          opacity={overview ? 1 : 0}
        />
      ) : null}
    </group>
  );
}

/* Per-country cap so dense regions (Asia) stay legible; tradable stocks first. */
const MAX_TICKERS = 3;

/** Ticker chips on leader lines radiating from a pin's bead. Neighbouring
 * pins start their fan at different angles (by rank) so chips don't collide. */
function TickerCallouts({ cs, rank, pos, quat, center }: { cs: CountrySummary; rank: number; pos: THREE.Vector3; quat: THREE.Quaternion; center: { lat: number; lng: number } }) {
  /* Fan direction: away from the region's centre, in the pin's local tangent
   * plane, so neighbouring countries point their chips apart. */
  const baseAngle = useMemo(() => {
    const n = pos.clone().normalize();
    const out = pos.clone().sub(latLngToVec3(center.lat, center.lng, R));
    out.addScaledVector(n, -out.dot(n));
    if (out.lengthSq() < 1e-6) return rank * 2.4;
    out.normalize().applyQuaternion(quat.clone().invert());
    return Math.atan2(out.z, out.x);
  }, [pos, quat, center.lat, center.lng, rank]);
  const prices = useMarket((s) => s.prices);
  const loadPrices = useMarket((s) => s.loadPrices);
  const focusCompany = useWorld((s) => s.focusCompany);
  const idsKey = cs.companies.join(",");
  useEffect(() => { if (idsKey) void loadPrices(idsKey.split(",")); }, [idsKey, loadPrices]);

  const picks = [...cs.companies]
    .filter((id) => COMPANY_BY_ID[id])
    .sort((a, b) => Number((prices[b]?.tokenPriceUsd ?? 0) > 0) - Number((prices[a]?.tokenPriceUsd ?? 0) > 0)
      || Number(Boolean(COMPANY_BY_ID[b].featured)) - Number(Boolean(COMPANY_BY_ID[a].featured)))
    .slice(0, MAX_TICKERS);
  if (!picks.length) return null;

  const BEAD: [number, number, number] = [0, 0.2, 0];
  return (
    <>
      {picks.map((id, i) => {
        const co = COMPANY_BY_ID[id];
        const p = prices[id];
        const live = (p?.tokenPriceUsd ?? 0) > 0;
        const ch = p?.change24hPct ?? null;
        const accent = !live || ch == null ? C.cyan : ch >= 0 ? C.green : C.magenta;
        /* Spread in a ~70° arc around the outward direction, alternating reach. */
        /* Neighbours (rank > 0) step out further and higher so their chips clear the leader's. */
        const a = baseAngle + (i - (picks.length - 1) / 2) * 0.62 + rank * 0.5;
        const reach = 0.9 + (i % 2) * 0.28 + rank * 0.12;
        const tip: [number, number, number] = [Math.cos(a) * reach, 0.5 + i * 0.12 + rank * 0.1, Math.sin(a) * reach];
        return (
          <group key={id}>
            <Line points={[BEAD, tip]} color={accent} lineWidth={1.2} transparent opacity={0.75} toneMapped={false} />
            <mesh position={tip}>
              <sphereGeometry args={[0.02, 8, 6]} />
              <meshBasicMaterial color={accent} toneMapped={false} />
            </mesh>
            <HoloLabel
              position={[tip[0], tip[1] + 0.15, tip[2]]}
              title={co.ticker}
              subtitle={live ? `${fmtUsd(p?.tokenPriceUsd)} ${fmtPct(ch)}` : "listed"}
              accent={accent}
              scale={0.95}
              dim={!live}
              onClick={() => focusCompany(id)}
            />
          </group>
        );
      })}
    </>
  );
}

const EMPTY: CountrySummary[] = [];

export function CountryPins() {
  const countries = useMarket((s) => s.overview?.countries ?? EMPTY);
  /* Rank countries inside each ~14° neighbourhood; rank picks the fan-out slot. */
  const ranks = useMemo(() => {
    const out: Record<string, number> = {};
    const sorted = [...countries].sort((a, b) => b.assetCount - a.assetCount);
    sorted.forEach((cs, i) => {
      let rank = 0;
      for (let j = 0; j < i; j++) {
        const o = sorted[j];
        const d = Math.hypot(o.lat - cs.lat, (o.lng - cs.lng) * Math.cos((cs.lat * Math.PI) / 180));
        if (d < 20) rank++;
      }
      out[cs.code] = rank;
    });
    return out;
  }, [countries]);
  return <>{countries.map((cs) => <Pin key={cs.code} cs={cs} rank={ranks[cs.code] ?? 0} />)}</>;
}
