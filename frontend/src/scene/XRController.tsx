/* Controllers in the headset: the stock model + pointers, plus small holo
 * tags pinned to the right controller's A and B buttons so nobody has to
 * guess how to talk to Rhea ("hold A"). The tags are anchored to the button
 * nodes of the loaded controller model (XRControllerComponent), so they sit
 * on the real button whatever Touch controller the Quest reports. */
import { Billboard, Text } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { DefaultXRController, XRControllerComponent, useXRInputSourceStateContext } from "@react-three/xr";
import { useRef } from "react";
import * as THREE from "three";
import { useVoice } from "@/ai/voice";
import { C } from "@/theme";

/* A and B sit ~1.5 cm apart on a Touch controller, so the two tags are
 * stacked at different heights: the talk tag rides high, the B tag stays low
 * and small. */
function ButtonTag({ title, sub, accent, active, faded, lift, size = 1 }: { title: string; sub?: string; accent: string; active?: boolean; faded?: boolean; /** metres above the button face */ lift: number; size?: number }) {
  const ref = useRef<THREE.Group>(null);
  useFrame((s) => {
    /* Gentle bob until it has been used; then it settles. */
    if (!ref.current) return;
    ref.current.position.y = lift + (faded ? 0 : Math.sin(s.clock.elapsedTime * 2.4) * 0.003);
  });
  const w = (0.052 + Math.max(title.length, (sub?.length ?? 0) * 0.85) * 0.0045) * size;
  const h = (sub ? 0.03 : 0.018) * size;
  const opacity = faded ? 0.5 : 1;
  return (
    <group>
      {/* Leader line from the button up to the tag */}
      <mesh position={[0, lift / 2, 0]}>
        <boxGeometry args={[0.0008, lift - h / 2, 0.0008]} />
        <meshBasicMaterial color={accent} transparent opacity={0.8 * opacity} toneMapped={false} />
      </mesh>
      <group ref={ref} position={[0, lift, 0]}>
        <Billboard follow lockX={false} lockY={false} lockZ={false}>
          <mesh position={[0, 0, -0.001]}>
            <planeGeometry args={[w, h]} />
            <meshBasicMaterial color={active ? accent : "#0b0f1c"} transparent opacity={(active ? 0.55 : 0.78) * opacity} toneMapped={false} depthWrite={false} />
          </mesh>
          <lineSegments position={[0, 0, -0.0005]}>
            <edgesGeometry args={[new THREE.PlaneGeometry(w, h)]} />
            <lineBasicMaterial color={accent} transparent opacity={opacity} toneMapped={false} />
          </lineSegments>
          <Text position={[0, sub ? 0.006 * size : 0, 0]} fontSize={0.0085 * size} color="#ffffff" anchorX="center" anchorY="middle" letterSpacing={0.12} fillOpacity={opacity} outlineWidth={0.0012} outlineColor="#05060d">
            {title}
          </Text>
          {sub ? (
            <Text position={[0, -0.007 * size, 0]} fontSize={0.006 * size} color={accent} anchorX="center" anchorY="middle" letterSpacing={0.1} fillOpacity={opacity}>
              {sub}
            </Text>
          ) : null}
        </Billboard>
      </group>
    </group>
  );
}

/** Right-hand button tags; the left controller just gets the default model. */
function RightHandTags() {
  const holding = useVoice((s) => s.holding);
  const state = useVoice((s) => s.state);
  const uses = useRef(0);
  const wasHolding = useRef(false);
  if (holding && !wasHolding.current) uses.current += 1;
  wasHolding.current = holding;
  const faded = uses.current >= 3 && !holding;
  return (
    <>
      <XRControllerComponent id="a-button">
        <ButtonTag
          title={holding ? "LISTENING" : "HOLD  A"}
          sub={holding ? "release when done" : state === "speaking" ? "to interrupt" : "to speak"}
          accent={holding ? C.violet : C.sol}
          active={holding}
          faded={faded}
          lift={0.055}
        />
      </XRControllerComponent>
      <XRControllerComponent id="b-button">
        <ButtonTag title="B · WORLD" accent={C.frost} faded={faded} lift={0.018} size={0.8} />
      </XRControllerComponent>
    </>
  );
}

export function RheaController() {
  const state = useXRInputSourceStateContext("controller");
  const right = state.inputSource.handedness === "right";
  return (
    <>
      <DefaultXRController />
      {right ? <RightHandTags /> : null}
    </>
  );
}
