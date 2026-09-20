/* One XR store for the app: hands + controllers in the headset, passthrough
 * via immersive-ar, and the DOM overlay root for handheld AR on phones. Lives
 * in its own module so scene code and the handheld store can both import it
 * without a cycle. */
import { createXRStore } from "@react-three/xr";
import { RheaController } from "./XRController";

/** Root element for the WebXR DOM overlay (handheld AR). Created up front because the store needs it now; the
 * store shows it only while a session runs, and HudGate portals the HUD into it while handheld AR is active. */
export const arOverlayRoot: HTMLElement | null = typeof document === "undefined" ? null : (() => {
  const el = document.createElement("div");
  el.className = "ar-overlay";
  return el;
})();

export const xrStore = createXRStore({
  hand: true,
  /* Stock controller model + pointers, with "hold A to speak" tags on the right hand. */
  controller: RheaController,
  frameBufferScaling: "high",
  foveation: 0.6,
  anchors: false,
  /* Optional: phones use it to drop the globe on a real surface (see ArPlacement). */
  hitTest: true,
  planeDetection: false,
  meshDetection: false,
  /* Phones: keep the DOM HUD on screen during the session (optional feature;
   * the headset ignores it). Screen taps become transient pointers (default). */
  domOverlay: arOverlayRoot ?? true,
  /* Let Quest Browser offer the session from its own UI too. */
  offerSession: "immersive-ar",
  /* Dev emulator (localhost only, when no WebXR runtime exists): Quest 3, no
   * synthetic room — its bundled Three.js is incompatible with ours. */
  emulate: { type: "metaQuest3", syntheticEnvironment: false },
});
