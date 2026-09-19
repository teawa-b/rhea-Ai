/* HoloLabel — a billboarded holographic chip that works in both desktop and
 * immersive XR (troika text, no DOM). Optional second line and accent bar. */
import { Billboard, Text } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { C } from "@/theme";
import { FONT_BODY, FONT_BOLD } from "./fonts";
import { GlassRect } from "./glass";
import { useLogoTexture } from "./logoTexture";
import { DIST, rig } from "./rig";
import { feel } from "./xrFeedback";

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
  /** Optional square logo shown left of the text (must be CORS-enabled). */
  icon?: string;
};

const CHAR_W = 0.074; // approx bold uppercase advance at fontSize 0.1, until troika reports the real width

/** Laid-out width of a troika text block, once it has synced. */
function useTextWidth() {
  const [width, setWidth] = useState<number | null>(null);
  const onSync = (mesh: { textRenderInfo?: { blockBounds: number[] } }) => {
    const b = mesh.textRenderInfo?.blockBounds;
    if (b) setWidth(b[2] - b[0]);
  };
  return [width, onSync] as const;
}

export function HoloLabel({ position, title, subtitle, accent = C.cyan, scale = 1, dim = false, onClick, opacity = 1, icon }: Props) {
  const logo = useLogoTexture(icon);
  const h = subtitle ? 0.26 : 0.17;
  /* Room for the logo tile on the left when one is loaded. */
  const iconW = logo ? h - 0.04 + 0.03 : 0;
  const [titleW, onTitleSync] = useTextWidth();
  const [subW, onSubSync] = useTextWidth();
  const estimate = useMemo(() => Math.max(title.length * CHAR_W, (subtitle?.length ?? 0) * CHAR_W * 0.62), [title, subtitle]);
  const w = Math.max(titleW ?? estimate, subtitle ? subW ?? 0 : 0) + 0.16 + iconW;
  const tx = 0.01 + iconW / 2;
  const bgOpacity = (dim ? 0.55 : 0.82) * opacity;
  const inner = useRef<THREE.Group>(null);
  useFrame(() => {
    /* ~constant on-screen size: scale linearly with camera distance. */
    if (inner.current) inner.current.scale.setScalar(scale * Math.pow(rig.dist / DIST.world, 0.9));
  });
  return (
    <Billboard position={position} follow lockX={false} lockY={false} lockZ={false}>
      <group ref={inner} scale={scale} onClick={onClick ? (e) => { e.stopPropagation(); feel.press(e); onClick(); } : undefined} onPointerOver={onClick ? (e) => feel.hover(e) : undefined}>
        {/* Backing, border and accent bar in one draw (was a plane, 1px line segments and a bar). */}
        <GlassRect position={[0, 0, -0.002]} w={w} h={h} r={0.022} top={C.panel} accent={accent} interactive
          fill={bgOpacity} rim={(dim ? 0.35 : 0.9) * opacity} stroke={0.006} bar={(dim ? 0.4 : 1) * opacity} barGeo={[0.018, 0.006, (h - 0.03) / 2]} glow={0} sheen={0} topBar={0} />
        {logo ? (
          <group position={[-w / 2 + 0.03 + (h - 0.04) / 2, 0, 0.0005]}>
            <mesh position={[0, 0, -0.0003]}>
              <planeGeometry args={[h - 0.02, h - 0.02]} />
              <meshBasicMaterial color="#ffffff" transparent opacity={0.95 * opacity} toneMapped={false} />
            </mesh>
            <mesh>
              <planeGeometry args={[h - 0.04, h - 0.04]} />
              <meshBasicMaterial map={logo} transparent opacity={opacity} toneMapped={false} />
            </mesh>
          </group>
        ) : null}
        <Text
          font={FONT_BOLD}
          position={[tx, subtitle ? 0.045 : 0, 0.001]}
          fontSize={0.1}
          color={dim ? "#9fb3c8" : C.white}
          anchorX="center"
          anchorY="middle"
          letterSpacing={0.06}
          fillOpacity={opacity}
          outlineWidth={0.004}
          outlineColor={accent}
          outlineOpacity={0.35 * opacity}
          onSync={onTitleSync}
        >
          {title.toUpperCase()}
        </Text>
        {subtitle ? (
          <Text font={FONT_BODY} position={[tx, -0.07, 0.001]} fontSize={0.068} color={accent} anchorX="center" anchorY="middle" letterSpacing={0.08} fillOpacity={opacity} onSync={onSubSync}>
            {subtitle}
          </Text>
        ) : null}
      </group>
    </Billboard>
  );
}
