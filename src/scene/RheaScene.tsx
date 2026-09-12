/* The Canvas: lights, stars, the globe rig and its children, XR wrapper. */
import { Canvas } from "@react-three/fiber";
import { XR, createXRStore } from "@react-three/xr";
import { Suspense } from "react";
import * as THREE from "three";
import { C } from "@/theme";
import { CameraRig } from "./CameraRig";
import { CompanyMarkers } from "./CompanyMarkers";
import { Connections } from "./Connections";
import { CountryPins } from "./CountryPins";
import { Globe, Stars } from "./Globe";
import { XRPanels } from "./XRPanels";

/* One XR store for the app. Hands + controllers; no AR features needed. */
export const xrStore = createXRStore({
  hand: true,
  controller: true,
  frameBufferScaling: "high",
  foveation: 0.5,
  anchors: false,
  hitTest: false,
  planeDetection: false,
  meshDetection: false,
});

export function RheaScene() {
  return (
    <Canvas
      camera={{ position: [0, 0, 3.4], fov: 38, near: 0.05, far: 120 }}
      dpr={[1, 2]}
      gl={{ antialias: true, alpha: false, powerPreference: "high-performance", toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.1 }}
      style={{ position: "absolute", inset: 0 }}
    >
      <color attach="background" args={[C.void]} />
      <fog attach="fog" args={[C.void, 8, 60]} />
      <XR store={xrStore}>
        <hemisphereLight args={["#bfe6ff", "#05060d", 0.7]} />
        <directionalLight position={[-2.4, 1.8, 3.2]} intensity={2.0} color="#f4f9ff" />
        <directionalLight position={[2.6, -1.2, 0.8]} intensity={0.9} color={C.cyan} />
        <Stars />
        <Suspense fallback={null}>
          <CameraRig>
            <Globe />
            <CountryPins />
            <CompanyMarkers />
            <Connections />
          </CameraRig>
          <XRPanels />
        </Suspense>
      </XR>
    </Canvas>
  );
}
