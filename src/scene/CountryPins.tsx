/* One glowing pin per supported country, with a live "N assets" chip.
 * Counts come from the market overview (Jupiter), never hardcoded. */
import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import type { CountrySummary } from "@shared/types";
import { C } from "@/theme";
import { useMarket } from "@/state/market";
import { useWorld } from "@/state/world";
import { HoloLabel } from "./HoloLabel";
import { R, latLngToVec3 } from "./geo";

const UP = new THREE.Vector3(0, 1, 0);

function Pin({ cs }: { cs: CountrySummary }) {
  const focusedCountry = useWorld((s) => s.focusedCountry);
  const highlighted = useWorld((s) => s.highlightedCountries);
  const view = useWorld((s) => s.view);
  const heat = useWorld((s) => s.countryHeat[cs.code] ?? 0);
  const focusCountry = useWorld((s) => s.focusCountry);
  const orders = useMarket((s) => s.orders);
  const overview = useMarket((s) => s.overview);

  const isFocused = focusedCountry === cs.code;
  const isHot = highlighted.includes(cs.code) || heat > 0;
  const accent = heat > 0 ? C.amber : isFocused ? C.white : C.cyan;
  const activeRules = useMemo(() => {
    const ids = new Set(cs.companies);
    return orders.filter((o) => o.status === "active" && ids.has(o.companyId)).length;
  }, [orders, cs.companies]);

  const pos = useMemo(() => latLngToVec3(cs.lat, cs.lng, R), [cs.lat, cs.lng]);
  const quat = useMemo(() => new THREE.Quaternion().setFromUnitVectors(UP, pos.clone().normalize()), [pos]);
  const beadRef = useRef<THREE.Mesh>(null);
  const ringRef = useRef<THREE.Mesh>(null);

  useFrame((s) => {
    const t = s.clock.elapsedTime;
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
  const tradableNote = cs.tradableCount < cs.assetCount ? ` · ${cs.tradableCount} live` : "";
  const labelScale = 0.5;
  const noTradable = cs.tradableCount === 0;

  const pinScale = view === "world" ? 1 : 0.3;
  return (
    <group position={pos} quaternion={quat} scale={pinScale}>
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
      {showLabel ? (
        <HoloLabel
          position={[0, 0.36, 0]}
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

const EMPTY: CountrySummary[] = [];

export function CountryPins() {
  const countries = useMarket((s) => s.overview?.countries ?? EMPTY);
  return <>{countries.map((cs) => <Pin key={cs.code} cs={cs} />)}</>;
}
