/* Handheld AR — the phone/tablet path, distinct from the headset path.
 *
 * Two ways in, picked by feature detection:
 *   "webxr"  Android Chrome: a real `immersive-ar` WebXR session (ARCore
 *            tracking, camera passthrough) with the DOM HUD kept on screen
 *            through the `dom-overlay` feature. Move the phone to look around.
 *   "camera" iOS Safari and anything else without WebXR: the rear camera is
 *            shown behind the transparent canvas and the gyroscope drives the
 *            camera, so the globe is anchored to a direction in the room
 *            (rotation-tracked only). Without a usable sensor it degrades to
 *            a plain camera view and the UI says so.
 *
 * The headset never comes through here (HudGate hides the DOM HUD and XRPanels
 * takes over there); `active === "webxr"` is what tells the scene a WebXR
 * session is a phone in someone's hand rather than a headset on their head. */
import { create } from "zustand";
import { track } from "@/analytics";
import { useVoice } from "@/ai/voice";
import { resetAnchor } from "./arPlace";
import { gyro, startGyro, stopGyro } from "./gyro";
import { recenterXR } from "./CameraRig";
import { xrStore } from "./xrStore";

export { arOverlayRoot } from "./xrStore";

export type HandheldPath = "webxr" | "camera";

type HandheldState = {
  /** What this device can do; `undefined` until detection has run, `null` when nothing fits. */
  support: HandheldPath | null | undefined;
  /** The mode currently running. */
  active: HandheldPath | null;
  /** While entering (the WebXR prompt or the camera permission is up). */
  entering: boolean;
  stream: MediaStream | null;
  /** Camera path only: whether the gyroscope is anchoring the globe. */
  gyro: boolean;
};

export const useHandheld = create<HandheldState>(() => ({ support: undefined, active: null, entering: false, stream: null, gyro: false }));

/** Phones and tablets only: a coarse primary pointer plus touch. Never the Quest browser (it has its own launcher);
 * `?ar=1` forces the button on for QA (pairs with the localhost IWER emulator for the WebXR path). */
export function isHandheldDevice(): boolean {
  try {
    if (navigator.userAgent.includes("OculusBrowser")) return false;
    if (new URLSearchParams(window.location.search).get("ar") === "1") return true;
    return navigator.maxTouchPoints > 0 && window.matchMedia("(pointer: coarse)").matches;
  } catch { return false; }
}

let detecting: Promise<HandheldPath | null> | null = null;
/** Runs once; result lands in `support`. */
export function detectHandheld(): Promise<HandheldPath | null> {
  if (detecting) return detecting;
  detecting = (async () => {
    let path: HandheldPath | null = null;
    if (isHandheldDevice()) {
      const xr = navigator.xr;
      const ar = xr ? await xr.isSessionSupported("immersive-ar").catch(() => false) : false;
      if (ar) path = "webxr";
      else if (typeof navigator.mediaDevices?.getUserMedia === "function" && window.isSecureContext) path = "camera";
    }
    useHandheld.setState({ support: path });
    return path;
  })();
  return detecting;
}

const notice = (text: string) => useVoice.setState({ notice: text });

/** Starts handheld AR. Must run inside a user gesture (camera permission, WebXR prompt). */
export async function enterHandheld(): Promise<boolean> {
  const { support, active, entering } = useHandheld.getState();
  if (active || entering || !support) return false;
  useHandheld.setState({ entering: true });
  try {
    if (support === "webxr") {
      /* Flip first so the HUD is already inside the overlay root when the session's first frame shows it. */
      useHandheld.setState({ active: "webxr" });
      const session = await xrStore.enterAR();
      if (!session) throw new Error("The browser did not start an AR session.");
      const overlay = (session as XRSession & { domOverlayState?: { type: string } | null }).domOverlayState;
      if (!overlay) console.warn("[ar] session has no DOM overlay; the HUD will not be visible until you exit");
      track("webxr_entered", "handheld-ar");
      notice("Point at a floor or table and tap to place the globe. Drag to spin it, pinch to zoom.");
      return true;
    }
    /* Sensor permission first (it needs the tap's activation), then the camera. */
    const tracked = await startGyro();
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
    useHandheld.setState({ active: "camera", stream, gyro: tracked });
    track("webxr_entered", tracked ? "handheld-gyro" : "handheld-camera");
    notice(tracked
      ? "Tap anywhere to move the globe there. It stays put as you turn; drag it to spin, pinch to zoom."
      : "Camera view: no motion sensor here, so the globe follows the phone. Drag to spin, pinch to zoom.");
    return true;
  } catch (e) {
    const msg = (e as Error)?.message ?? String(e);
    console.warn("[ar] enter failed", e);
    stopGyro();
    useHandheld.setState({ active: null, stream: null, gyro: false });
    notice(/denied|permission|NotAllowed/i.test(msg) ? "Camera access was blocked. Allow it in the site settings to use AR." : `Couldn't start AR: ${msg}`);
    return false;
  } finally {
    useHandheld.setState({ entering: false });
  }
}

export function exitHandheld() {
  const { active, stream } = useHandheld.getState();
  if (!active) return;
  if (active === "webxr") {
    /* The store subscription below clears `active` once the session is really gone. */
    xrStore.getState().session?.end().catch(() => undefined);
    return;
  }
  stream?.getTracks().forEach((t) => t.stop());
  stopGyro();
  resetAnchor();
  useHandheld.setState({ active: null, stream: null, gyro: false });
}

/** Puts the globe back in front of the phone: drops any tapped placement and re-seats the anchor. */
export function recenterHandheld() {
  const { active } = useHandheld.getState();
  resetAnchor();
  if (active === "webxr") recenterXR();
  else if (active === "camera") gyro.recalibrate = true;
}

/** Leaves a WebXR handheld session before something that opens a DOM modal outside the overlay (Privy's
 * sign-in / signing prompts), which the session would otherwise hide. Resolves once the session has ended. */
export async function leaveHandheldForDom(): Promise<void> {
  if (useHandheld.getState().active !== "webxr") return;
  const session = xrStore.getState().session;
  exitHandheld();
  if (!session) return;
  await new Promise<void>((resolve) => {
    const t = setTimeout(resolve, 1500);
    const unsub = xrStore.subscribe((s) => { if (s.session == null) { clearTimeout(t); unsub(); resolve(); } });
  });
  notice("Left AR so you can finish in the wallet. Tap AR to go back in.");
}

/* A WebXR session ending for any reason (Exit AR, the browser's own close button, a tab switch) drops back to the
 * flat view. Camera streams that lose their track (another app grabbed the camera) do the same. */
xrStore.subscribe((s, prev) => {
  if (prev.session && !s.session && useHandheld.getState().active === "webxr") { resetAnchor(); useHandheld.setState({ active: null }); }
});
useHandheld.subscribe((s, prev) => {
  if (s.stream && s.stream !== prev.stream) {
    for (const t of s.stream.getVideoTracks()) t.addEventListener("ended", () => { if (useHandheld.getState().stream === s.stream) exitHandheld(); });
  }
});
