/* Animated arcs between places — the "CHINA ───── NVIDIA" relationship lines.
 * Each arc grows in over ~0.8 s, then a bright pulse travels along it. */
import { Line } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { C } from "@/theme";
import { useWorld, type Connection } from "@/state/world";
import { HoloLabel } from "./HoloLabel";
import { arcPoints, latLngToVec3 } from "./geo";

const COLOR: Record<Connection["sentiment"], string> = { negative: C.magenta, positive: C.green, neutral: C.cyan };

function Arc({ conn }: { conn: Connection }) {
  const color = COLOR[conn.sentiment];
  const pts = useMemo(() => arcPoints(latLngToVec3(conn.from.lat, conn.from.lng), latLngToVec3(conn.to.lat, conn.to.lng), 64), [conn]);
  const mid = pts[Math.floor(pts.length / 2)];
  const lineRef = useRef<any>(null); // eslint-disable-line @typescript-eslint/no-explicit-any
  const pulseRef = useRef<THREE.Mesh>(null);
  const born = conn.createdAt;

  useFrame(() => {
    const age = (Date.now() - born) / 1000;
    const grow = THREE.MathUtils.clamp(age / 0.8, 0, 1);
    const mat = lineRef.current?.material as (THREE.ShaderMaterial & { dashOffset: number; dashSize: number; gapSize: number; opacity: number }) | undefined;
    if (mat) {
      /* Grow-in: reveal via dash, then keep a slow marching dash. */
      mat.dashSize = grow < 1 ? grow * 4 : 0.22;
      mat.gapSize = grow < 1 ? 4 : 0.08;
      mat.dashOffset = -age * 0.5;
      mat.opacity = 0.55 + 0.45 * grow;
    }
    if (pulseRef.current) {
      const t = grow < 1 ? 0 : ((age - 0.8) * 0.45) % 1;
      const i = Math.min(pts.length - 1, Math.floor(t * (pts.length - 1)));
      pulseRef.current.position.copy(pts[i]);
      pulseRef.current.visible = grow >= 1;
    }
  });

  return (
    <group>
      <Line ref={lineRef} points={pts} color={color} lineWidth={2.2} dashed dashSize={0.22} gapSize={0.08} transparent opacity={0.9} toneMapped={false} />
      {/* soft under-glow */}
      <Line points={pts} color={color} lineWidth={7} transparent opacity={0.12} toneMapped={false} depthWrite={false} />
      <mesh ref={pulseRef}>
        <sphereGeometry args={[0.018, 10, 8]} />
        <meshBasicMaterial color="#ffffff" toneMapped={false} />
      </mesh>
      {conn.label ? (
        <HoloLabel position={mid.clone().multiplyScalar(1.06)} title={conn.label} accent={color} scale={0.34} />
      ) : null}
    </group>
  );
}

export function Connections() {
  const connections = useWorld((s) => s.connections);
  return <>{connections.map((c) => <Arc key={c.id} conn={c} />)}</>;
}
