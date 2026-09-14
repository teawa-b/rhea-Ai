/* Holographic company towers at headquarters. Shown for the focused country
 * (all its companies with a live asset) and for any highlighted/compared
 * companies anywhere on the globe. Live price chips come from the market
 * store. Active conditional orders render an "AGENT WATCHING" beacon. */
import { useFrame } from "@react-three/fiber";
import { useXR } from "@react-three/xr";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { COMPANY_BY_ID, COUNTRIES } from "@shared/registry";
import { logoUrl } from "@/market/logos";
import type { Company } from "@shared/types";
import { C, fmtPct, fmtUsd } from "@/theme";
import { useMarket } from "@/state/market";
import { useWorld } from "@/state/world";
import { HoloLabel } from "./HoloLabel";
import { R, latLngToVec3 } from "./geo";
import { DIST, rig } from "./rig";

const UP = new THREE.Vector3(0, 1, 0);

type Placed = { co: Company; mode: "hero" | "minor"; lat: number; lng: number };

/* Companies sharing a metro (Bay Area, Beijing, Central HK…) would stack on
 * one point; fan each cluster out on a small ring so every tower is legible. */
function spreadClusters(list: { co: Company; mode: "hero" | "minor" }[]): Placed[] {
  const groups = new Map<string, { co: Company; mode: "hero" | "minor" }[]>();
  for (const item of list) {
    const hq = item.co.headquarters ?? COUNTRIES[item.co.countryCode];
    const key = `${Math.round(hq.lat / 1.2)}:${Math.round(hq.lng / 1.2)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(item);
  }
  const out: Placed[] = [];
  for (const items of groups.values()) {
    if (items.length === 1) {
      const hq = items[0].co.headquarters ?? COUNTRIES[items[0].co.countryCode];
      out.push({ ...items[0], lat: hq.lat, lng: hq.lng });
      continue;
    }
    const cLat = items.reduce((a, i) => a + (i.co.headquarters ?? COUNTRIES[i.co.countryCode]).lat, 0) / items.length;
    const cLng = items.reduce((a, i) => a + (i.co.headquarters ?? COUNTRIES[i.co.countryCode]).lng, 0) / items.length;
    const radius = 0.9 + items.length * 0.22; // degrees
    items.sort((a, b) => (a.mode === b.mode ? a.co.name.localeCompare(b.co.name) : a.mode === "hero" ? -1 : 1));
    items.forEach((item, i) => {
      const a = (i / items.length) * Math.PI * 2 - Math.PI / 2;
      out.push({ ...item, lat: cLat + Math.sin(a) * radius, lng: cLng + Math.cos(a) * radius / Math.max(0.3, Math.cos(cLat * Math.PI / 180)) });
    });
  }
  return out;
}

function Tower({ co, mode, lat, lng }: Placed) {
  const focusedCompany = useWorld((s) => s.focusedCompany);
  const highlighted = useWorld((s) => s.highlightedCompanies);
  const focusCompany = useWorld((s) => s.focusCompany);
  const price = useMarket((s) => s.prices[co.id]);
  const orders = useMarket((s) => s.orders);
  const activeOrders = orders.filter((o) => o.companyId === co.id && o.status === "active");
  const isFocused = focusedCompany === co.id;
  const isHot = highlighted.includes(co.id);

  const pos = useMemo(() => latLngToVec3(lat, lng, R), [lat, lng]);
  const quat = useMemo(() => new THREE.Quaternion().setFromUnitVectors(UP, pos.clone().normalize()), [pos]);

  const change = price?.change24hPct ?? null;
  const accent = isFocused ? C.white : change == null ? C.cyan : change >= 0 ? C.green : C.magenta;
  const height = mode === "hero" ? 0.075 : 0.045;
  const towerRef = useRef<THREE.Mesh>(null);
  const haloRef = useRef<THREE.Mesh>(null);
  const beaconRef = useRef<THREE.Group>(null);
  const rootRef = useRef<THREE.Group>(null);

  useFrame((s) => {
    const t = s.clock.elapsedTime;
    /* Markers shrink as the camera closes in so they never dominate the view. */
    if (rootRef.current) rootRef.current.scale.setScalar(Math.max(0.42, Math.pow(rig.dist / DIST.world, 0.75)));
    if (towerRef.current) {
      const m = towerRef.current.material as THREE.MeshBasicMaterial;
      const k = (isFocused ? 1.35 : isHot ? 1.15 : 0.9) + Math.sin(t * 2.4 + pos.x * 7) * 0.12;
      m.color.set(accent).multiplyScalar(k);
    }
    if (haloRef.current) haloRef.current.rotation.z = t * (isFocused ? 1.2 : 0.4);
    if (beaconRef.current) {
      beaconRef.current.rotation.y = t * 1.5;
      beaconRef.current.position.y = height + 0.09 + Math.sin(t * 2) * 0.01;
    }
  });

  const labelScale = mode === "hero" ? 0.34 : 0.26;
  const shortName = co.name.length > 16 ? co.name.slice(0, 15) + "…" : co.name;
  const sub = price?.tokenPriceUsd != null && price.tokenPriceUsd > 0 ? `${co.tokenSymbol}  ${fmtUsd(price.tokenPriceUsd)}  ${fmtPct(change)}` : `${co.tokenSymbol} · listed`;
  /* Chips only where they matter: focused/highlighted always; other hero
   * companies in country view; nothing else (company view stays clean). */
  const view = useWorld((s) => s.view);
  const showLabel = isFocused || isHot || (mode === "hero" && view !== "company");

  return (
    <group ref={rootRef} position={pos} quaternion={quat}>
      {/* spire: a thin luminous column with a soft additive sheath */}
      <mesh ref={towerRef} position={[0, height / 2, 0]} onClick={(e) => { e.stopPropagation(); focusCompany(co.id); }}>
        <cylinderGeometry args={[0.005, 0.009, height, 8]} />
        <meshBasicMaterial color={accent} toneMapped={false} />
      </mesh>
      <mesh position={[0, height / 2, 0]}>
        <cylinderGeometry args={[0.012, 0.02, height, 12, 1, true]} />
        <meshBasicMaterial color={accent} transparent opacity={isFocused ? 0.28 : 0.14} blending={THREE.AdditiveBlending} depthWrite={false} side={THREE.DoubleSide} toneMapped={false} />
      </mesh>
      {/* cap */}
      <mesh position={[0, height + 0.014, 0]}>
        <octahedronGeometry args={[mode === "hero" ? 0.02 : 0.013, 0]} />
        <meshBasicMaterial color={isFocused ? "#ffffff" : accent} toneMapped={false} />
      </mesh>
      {/* landing pad + slow-turning tick ring */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.002, 0]}>
        <ringGeometry args={[0.022, 0.034, 32]} />
        <meshBasicMaterial color={accent} transparent opacity={isFocused || isHot ? 0.85 : 0.45} side={THREE.DoubleSide} depthWrite={false} toneMapped={false} />
      </mesh>
      <mesh ref={haloRef} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.003, 0]}>
        <ringGeometry args={[0.04, 0.046, 4, 1, 0, Math.PI * 0.5]} />
        <meshBasicMaterial color={accent} transparent opacity={0.7} side={THREE.DoubleSide} depthWrite={false} toneMapped={false} />
      </mesh>
      {/* AGENT WATCHING beacon */}
      {activeOrders.length ? (
        <group ref={beaconRef} position={[0, height + 0.09, 0]}>
          <mesh>
            <torusGeometry args={[0.03, 0.004, 8, 24]} />
            <meshBasicMaterial color={C.amber} transparent opacity={0.9} toneMapped={false} />
          </mesh>
          <mesh rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[0.03, 0.003, 8, 24]} />
            <meshBasicMaterial color={C.gold} transparent opacity={0.7} toneMapped={false} />
          </mesh>
          <pointLight color={C.amber} intensity={0.4} distance={0.4} />
        </group>
      ) : null}
      {/* hit target */}
      <mesh position={[0, height / 2, 0]} onClick={(e) => { e.stopPropagation(); focusCompany(co.id); }}>
        <sphereGeometry args={[0.07, 8, 6]} />
        <meshBasicMaterial visible={false} />
      </mesh>
      {showLabel ? (
        <HoloLabel
          position={[0, height + (activeOrders.length ? 0.2 : 0.12), 0]}
          title={shortName}
          icon={logoUrl(co.id)}
          subtitle={activeOrders.length ? `◉ AGENT WATCHING · ${sub}` : sub}
          accent={activeOrders.length ? C.amber : accent}
          scale={labelScale}
          onClick={() => focusCompany(co.id)}
        />
      ) : null}
    </group>
  );
}

export function CompanyMarkers() {
  const inXR = useXR((s) => s.mode) != null;
  const view = useWorld((s) => s.view);
  const focusedCountry = useWorld((s) => s.focusedCountry);
  const focusedCompany = useWorld((s) => s.focusedCompany);
  const highlighted = useWorld((s) => s.highlightedCompanies);
  const comparison = useWorld((s) => s.comparison);
  const overview = useMarket((s) => s.overview);
  const orders = useMarket((s) => s.orders);
  const loadPrices = useMarket((s) => s.loadPrices);

  const visible = useMemo(() => {
    const ids = new Set<string>();
    if (!overview) return [] as Placed[];
    const withAsset = new Set(overview.assets.map((a) => a.companyId));
    if ((view === "country" || view === "company") && focusedCountry) {
      for (const id of overview.countries.find((c) => c.code === focusedCountry)?.companies ?? []) {
        const co = COMPANY_BY_ID[id];
        if (co?.headquarters) ids.add(id);
      }
    }
    for (const id of highlighted) if (withAsset.has(id)) ids.add(id);
    for (const id of comparison?.companyIds ?? []) ids.add(id);
    for (const o of orders) if (o.status === "active") ids.add(o.companyId);
    if (focusedCompany) ids.add(focusedCompany);
    const list = [...ids].map((id) => COMPANY_BY_ID[id]).filter(Boolean);
    /* In country view show every company with HQ; hero = featured or focused. */
    const placed = list.map((co) => ({ co, mode: (co.featured || co.id === focusedCompany || highlighted.includes(co.id)) ? "hero" as const : "minor" as const }));
    /* Quest draw-call budget: skip minor towers inside a headset session. */
    return spreadClusters(inXR ? placed.filter((p) => p.mode === "hero") : placed);
  }, [view, focusedCountry, focusedCompany, highlighted, comparison, overview, orders, inXR]);

  /* Keep chips live: poll prices for visible companies. */
  const idsKey = visible.map((v) => v.co.id).join(",");
  useEffect(() => {
    if (!idsKey) return;
    const ids = idsKey.split(",");
    void loadPrices(ids);
    const h = setInterval(() => void loadPrices(ids), 12_000);
    return () => clearInterval(h);
  }, [idsKey, loadPrices]);

  return <>{visible.map((v) => <Tower key={v.co.id} {...v} />)}</>;
}
