/* The Canvas: lights, environment, the globe rig and its children, XR wrapper.
 *
 * Mixed reality first: the XR store offers `immersive-ar` (Quest passthrough,
 * and handheld AR on Android phones — see handheld.ts). Per Meta's WebXR MR
 * guidance the content must be drawn on a transparent background, so the
 * renderer is created with alpha and the void backdrop, fog and starfield are
 * only mounted outside AR sessions and the phone camera view. */
import { Canvas, useFrame } from "@react-three/fiber";
import { XR, useXR } from "@react-three/xr";
import { Suspense, useEffect, useRef } from "react";
import * as THREE from "three";
import { C } from "@/theme";
import { CameraRig, XrHeadAnchor } from "./CameraRig";
import { CompanyMarkers } from "./CompanyMarkers";
import { Connections } from "./Connections";
import { CountryPins } from "./CountryPins";
import { Globe, Stars } from "./Globe";
import { HoldingsPlanet } from "./HoldingsPlanet";
import { useHandheld } from "./handheld";
import { XRPanels } from "./XRPanels";
import { xrStore } from "./xrStore";

export { xrStore };

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

type RateSession = XRSession & { updateTargetFrameRate?: (r: number) => Promise<void>; supportedFrameRates?: Float32Array; frameRate?: number };

/* Backdrop only outside passthrough; also bump Quest's default 72 Hz to 90,
 * stepping back down once if the app can't hold it (Meta's guidance: a missed
 * frame is synthesized by the compositor and reads as judder, so a steady 72
 * beats a stuttering 90). */
function Environment() {
  const mode = useXR((s) => s.mode);
  const session = useXR((s) => s.session);
  /* Phone camera view: the rear camera shows through the transparent canvas, so no void, fog or stars either. */
  const cameraView = useHandheld((s) => s.active === "camera");
  const passthrough = mode === "immersive-ar" || cameraView;
  const perf = useRef({ start: 0, frames: 0, slow: 0, settled: false });
  useEffect(() => {
    perf.current = { start: 0, frames: 0, slow: 0, settled: false };
    if (!session) return;
    const s = session as RateSession;
    const rates = s.supportedFrameRates ? Array.from(s.supportedFrameRates) : [];
    const target = rates.includes(90) ? 90 : rates.length ? Math.max(...rates.filter((r) => r <= 90)) : 0;
    if (target && s.updateTargetFrameRate) s.updateTargetFrameRate(target).catch(() => undefined);
  }, [session]);
  useFrame((state, dt) => {
    const p = perf.current;
    const s = session as RateSession | null;
    if (!s?.updateTargetFrameRate || !s.supportedFrameRates || p.settled) return;
    const rate = s.frameRate ?? 0;
    if (rate <= 72) return;
    const t = state.clock.elapsedTime;
    /* Ignore session start-up (shader compiles, font parsing), then judge 4 s windows. */
    if (!p.start) { p.start = t + 3; return; }
    if (t < p.start) return;
    p.frames++;
    if (dt > 1.5 / rate) p.slow++;
    if (t - p.start < 4) return;
    if (p.slow / p.frames > 0.08) {
      const lower = Array.from(s.supportedFrameRates).filter((r) => r < rate);
      if (lower.length) s.updateTargetFrameRate(Math.max(...lower)).catch(() => undefined);
      p.settled = true;
    }
    p.start = t; p.frames = 0; p.slow = 0;
  });
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
  const cameraView = useHandheld((s) => s.active === "camera");
  return (
    <Canvas
      camera={{ position: [0, 0, 3.4], fov: 38, near: 0.05, far: 120 }}
      dpr={[1, 2]}
      gl={{ antialias: true, alpha: true, premultipliedAlpha: true, powerPreference: "high-performance", toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.1 }}
      style={{ position: "absolute", inset: 0, background: cameraView ? "transparent" : C.void }}
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
