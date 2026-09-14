/* The Canvas: lights, environment, the globe rig and its children, XR wrapper.
 *
 * Mixed reality first: the XR store offers `immersive-ar` (Quest passthrough).
 * Per Meta's WebXR MR guidance the content must be drawn on a transparent
 * background, so the renderer is created with alpha and the void backdrop,
 * fog and starfield are only mounted outside AR sessions. */
import { Canvas } from "@react-three/fiber";
import { XR, createXRStore, useXR } from "@react-three/xr";
import { Suspense, useEffect } from "react";
import * as THREE from "three";
import { C } from "@/theme";
import { CameraRig, XrHeadAnchor } from "./CameraRig";
import { CompanyMarkers } from "./CompanyMarkers";
import { Connections } from "./Connections";
import { CountryPins } from "./CountryPins";
import { Globe, Stars } from "./Globe";
import { HoldingsPlanet } from "./HoldingsPlanet";
import { RheaController } from "./XRController";
import { XRPanels } from "./XRPanels";

/* One XR store for the app. Hands + controllers; passthrough via immersive-ar. */
export const xrStore = createXRStore({
  hand: true,
  /* Stock controller model + pointers, with "hold A to speak" tags on the right hand. */
  controller: RheaController,
  frameBufferScaling: "high",
  foveation: 0.6,
  anchors: false,
  hitTest: false,
  planeDetection: false,
  meshDetection: false,
  /* Let Quest Browser offer the session from its own UI too. */
  offerSession: "immersive-ar",
  /* Dev emulator (localhost only, when no WebXR runtime exists): Quest 3, no
   * synthetic room — its bundled Three.js is incompatible with ours. */
  emulate: { type: "metaQuest3", syntheticEnvironment: false },
});

/** Enter passthrough MR when the device supports it, otherwise VR. */
export async function enterImmersive(): Promise<"immersive-ar" | "immersive-vr" | null> {
  const xr = navigator.xr;
  if (!xr) return null;
  const ar = await xr.isSessionSupported("immersive-ar").catch(() => false);
  if (ar) {
    try { await xrStore.enterAR(); return "immersive-ar"; } catch (e) { console.warn("[xr] enterAR failed, trying VR", e); }
  }
  const vr = await xr.isSessionSupported("immersive-vr").catch(() => false);
  if (vr) { await xrStore.enterVR(); return "immersive-vr"; }
  return null;
}

/* Backdrop only outside passthrough; also bump Quest's default 72 Hz to 90. */
function Environment() {
  const mode = useXR((s) => s.mode);
  const session = useXR((s) => s.session);
  const passthrough = mode === "immersive-ar";
  useEffect(() => {
    if (!session) return;
    const s = session as XRSession & { updateTargetFrameRate?: (r: number) => Promise<void>; supportedFrameRates?: Float32Array };
    const rates = s.supportedFrameRates ? Array.from(s.supportedFrameRates) : [];
    const target = rates.includes(90) ? 90 : rates.length ? Math.max(...rates.filter((r) => r <= 90)) : 0;
    if (target && s.updateTargetFrameRate) s.updateTargetFrameRate(target).catch(() => undefined);
  }, [session]);
  if (passthrough) return null;
  return (
    <>
      <color attach="background" args={[C.void]} />
      <fog attach="fog" args={[C.void, 8, 60]} />
      <Stars />
    </>
  );
}

export function RheaScene() {
  return (
    <Canvas
      camera={{ position: [0, 0, 3.4], fov: 38, near: 0.05, far: 120 }}
      dpr={[1, 2]}
      gl={{ antialias: true, alpha: true, premultipliedAlpha: true, powerPreference: "high-performance", toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.1 }}
      style={{ position: "absolute", inset: 0, background: C.void }}
    >
      <XR store={xrStore}>
        <Environment />
        <hemisphereLight args={["#bfe6ff", "#05060d", 0.7]} />
        <directionalLight position={[-2.4, 1.8, 3.2]} intensity={2.0} color="#f4f9ff" />
        <directionalLight position={[2.6, -1.2, 0.8]} intensity={0.9} color={C.sol} />
        <Suspense fallback={null}>
          <XrHeadAnchor>
            <CameraRig>
              <Globe />
              <CountryPins />
              <CompanyMarkers />
              <Connections />
            </CameraRig>
            <HoldingsPlanet />
            <XRPanels />
          </XrHeadAnchor>
        </Suspense>
      </XR>
    </Canvas>
  );
}
