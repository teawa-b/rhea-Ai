/* HoloLabel — a billboarded holographic chip that works in both desktop and
 * immersive XR (troika text, no DOM). Optional second line and accent bar. */
import { Billboard, Text } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { C } from "@/theme";
import { DIST, rig } from "./rig";

type Props = {
  position: THREE.Vector3 | [number, number, number];
  title: string;
  subtitle?: string;
  accent?: string;
  /** base scale; multiplied per-frame by a camera-distance factor so chips
   *  keep a readable on-screen size while the AI zooms the globe */
  scale?: number;
  dim?: boolean;
  onClick?: () => void;
  /** 0..1 fade */
  opacity?: number;
};

const CHAR_W = 0.058; // approx glyph advance at fontSize 0.1

export function HoloLabel({ position, title, subtitle, accent = C.cyan, scale = 1, dim = false, onClick, opacity = 1 }: Props) {
  const w = useMemo(() => Math.max(title.length * CHAR_W, (subtitle?.length ?? 0) * CHAR_W * 0.7) + 0.16, [title, subtitle]);
  const h = subtitle ? 0.26 : 0.17;
  const bgOpacity = (dim ? 0.55 : 0.82) * opacity;
  const inner = useRef<THREE.Group>(null);
  useFrame(() => {
    /* ~constant on-screen size: scale linearly with camera distance. */
    if (inner.current) inner.current.scale.setScalar(scale * Math.pow(rig.dist / DIST.world, 0.9));
  });
  return (
    <Billboard position={position} follow lockX={false} lockY={false} lockZ={false}>
      <group ref={inner} scale={scale} onClick={onClick ? (e) => { e.stopPropagation(); onClick(); } : undefined}>
        {/* Backing */}
        <mesh position={[0, 0, -0.002]}>
          <planeGeometry args={[w, h]} />
          <meshBasicMaterial color={C.panel} transparent opacity={bgOpacity} depthWrite={false} toneMapped={false} />
        </mesh>
        {/* Border */}
        <lineSegments position={[0, 0, -0.001]}>
          <edgesGeometry args={[new THREE.PlaneGeometry(w, h)]} />
          <lineBasicMaterial color={accent} transparent opacity={(dim ? 0.35 : 0.9) * opacity} toneMapped={false} />
        </lineSegments>
        {/* Accent bar */}
        <mesh position={[-w / 2 + 0.012, 0, 0]}>
          <planeGeometry args={[0.012, h - 0.03]} />
          <meshBasicMaterial color={accent} transparent opacity={(dim ? 0.4 : 1) * opacity} toneMapped={false} />
        </mesh>
        <Text
          position={[0.01, subtitle ? 0.045 : 0, 0.001]}
          fontSize={0.1}
          color={dim ? "#9fb3c8" : C.white}
          anchorX="center"
          anchorY="middle"
          letterSpacing={0.06}
          fillOpacity={opacity}
          outlineWidth={0.004}
          outlineColor={accent}
          outlineOpacity={0.35 * opacity}
        >
          {title.toUpperCase()}
        </Text>
        {subtitle ? (
          <Text position={[0.01, -0.07, 0.001]} fontSize={0.068} color={accent} anchorX="center" anchorY="middle" letterSpacing={0.08} fillOpacity={opacity}>
            {subtitle}
          </Text>
        ) : null}
      </group>
    </Billboard>
  );
}
