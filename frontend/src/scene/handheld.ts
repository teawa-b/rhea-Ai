/* Handheld AR — the phone/tablet path, distinct from the headset path.
 *
 * Two ways in, picked by feature detection:
 *   "webxr"  Android Chrome: a real `immersive-ar` WebXR session (ARCore
 *            tracking, camera passthrough) with the DOM HUD kept on screen
 *            through the `dom-overlay` feature. Move the phone to look around.
 *   "camera" iOS Safari and anything else without WebXR: the rear camera is
 *            shown behind the transparent canvas. Not tracked, so the UI calls
 *            it a camera view, never "AR". Drag / pinch still drive the globe.
 *
 * The headset never comes through here (HudGate hides the DOM HUD and XRPanels
 * takes over there); `active === "webxr"` is what tells the scene a WebXR
 * session is a phone in someone's hand rather than a headset on their head. */
import { create } from "zustand";
import { track } from "@/analytics";
import { useVoice } from "@/ai/voice";
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
};

export const useHandheld = create<HandheldState>(() => ({ support: undefined, active: null, entering: false, stream: null }));

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
      notice("Move your phone to look around. Drag to spin the globe, pinch to zoom.");
      return true;
    }
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
    useHandheld.setState({ active: "camera", stream });
    track("webxr_entered", "handheld-camera");
    notice("Camera view: the globe floats over your camera. Drag to spin, pinch to zoom.");
    return true;
  } catch (e) {
    const msg = (e as Error)?.message ?? String(e);
    console.warn("[ar] enter failed", e);
    useHandheld.setState({ active: null, stream: null });
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
  useHandheld.setState({ active: null, stream: null });
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
  if (prev.session && !s.session && useHandheld.getState().active === "webxr") useHandheld.setState({ active: null });
});
useHandheld.subscribe((s, prev) => {
  if (s.stream && s.stream !== prev.stream) {
    for (const t of s.stream.getVideoTracks()) t.addEventListener("ended", () => { if (useHandheld.getState().stream === s.stream) exitHandheld(); });
  }
});
