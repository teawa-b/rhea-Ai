import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useStore } from "zustand";
import { RheaAuthProvider, useAuth } from "@/auth/Auth";
import { useSignInTabSync } from "@/auth/signinTab";
import { setVoiceAuth, useVoice, wireContextUpdates } from "@/ai/voice";
import { analyticsSummary, track, wireAnalytics } from "@/analytics";
import { RheaScene, enterImmersive, xrStore } from "@/scene/RheaScene";
import { xrGlobe } from "@/scene/CameraRig";
import { arAnchor, consumeTap, emitArTap } from "@/scene/arPlace";
import { arOverlayRoot, detectHandheld, enterHandheld, exitHandheld, useHandheld } from "@/scene/handheld";
import { rig } from "@/scene/rig";
import { describeIntent, resumeIntent } from "@/solana/trade";
import { demoRequested, useMarket } from "@/state/market";
import { useWorld } from "@/state/world";
import { ErrorBoundary } from "@/ui/ErrorBoundary";
import { useGlobeGestures } from "@/ui/gestures";
import { Hud } from "@/ui/Hud";

function Boot() {
  const loadOverview = useMarket((s) => s.loadOverview);
  const loadStatus = useMarket((s) => s.loadStatus);
  useEffect(() => {
    /* ?demo=1: the read-only demo wallet. PrivyBridge's wallet effect leaves it alone while signed out and
     * ends it once a real user turns out to be signed in (either effect order works). */
    if (demoRequested()) useMarket.getState().enterDemo();
    void loadStatus();
    void loadOverview();
    wireContextUpdates();
    wireAnalytics();
    void detectHandheld();
    /* Opening a place came from tapping a marker, so AR placement must not also move the globe. */
    const unfocus = useWorld.subscribe((s, p) => {
      if (s.focusedCompany !== p.focusedCompany || s.focusedCountry !== p.focusedCountry) consumeTap();
    });
    const h = setInterval(() => void loadOverview(), 5 * 60_000);
    /* dev handle for poking the world from the console */
    (window as unknown as { rhea: unknown }).rhea = { world: useWorld, market: useMarket, rig, xrGlobe, voice: useVoice, analytics: analyticsSummary, enterImmersive, xrStore, handheld: useHandheld, enterHandheld, exitHandheld, arAnchor };
    return () => { clearInterval(h); unfocus(); };
  }, [loadOverview, loadStatus]);
  return null;
}

/* Picks a trade back up after the gate that blocked it clears: sign-in closes
 * the login panel and re-prepares the trade (which may open the deposit
 * panel); a deposit landing closes that panel and re-prepares again. Rhea is
 * told each time so she can walk the user to Confirm. */
function IntentResumer() {
  const auth = useAuth();
  const loginPrompt = useMarket((s) => s.loginPrompt);
  const depositPrompt = useMarket((s) => s.depositPrompt);
  const portfolio = useMarket((s) => s.portfolio);
  const firstName = auth.displayName && !auth.displayName.includes("…") ? auth.displayName.split(" ")[0] : null;
  useSignInTabSync(auth);
  useEffect(() => { setVoiceAuth(auth); }, [auth]);

  useEffect(() => {
    if (!auth.authenticated || !auth.address || !loginPrompt) return;
    const { resume, after } = loginPrompt;
    useMarket.getState().setLoginPrompt(null);
    const who = firstName ? ` as ${firstName}` : "";
    const v = useVoice.getState();
    if (!resume) {
      v.announce(after
        ? `The user just signed in${who}; they're now authenticated with a wallet. They had asked for something that needed sign-in, so call ${after} now and tell them the result briefly.`
        : `The user just signed in${who}. Welcome them briefly and carry on.`);
      return;
    }
    void resumeIntent(auth, resume).then((r) => {
      if (r.ok) v.announce(`The user just signed in${who}; their request to ${describeIntent(resume)} is ready on the panel. Tell them briefly and ask them to press Confirm.`);
      else v.announce(`The user just signed in${who}. ${r.error ?? ""}`);
    });
  }, [auth, loginPrompt, firstName]);

  /* While the deposit panel is open, watch the wallet for the USDC to land. */
  useEffect(() => {
    if (!depositPrompt || !auth.authenticated) return;
    const h = setInterval(() => void useMarket.getState().loadPortfolio(), 15_000);
    return () => clearInterval(h);
  }, [depositPrompt, auth.authenticated]);
  useEffect(() => {
    /* neededUsd <= 0 is the plain "show me my address" prompt: nothing to wait for. */
    if (!depositPrompt || depositPrompt.neededUsd <= 0 || !portfolio || portfolio.usdcBalance < depositPrompt.neededUsd) return;
    const { resume } = depositPrompt;
    useMarket.getState().setDepositPrompt(null);
    const v = useVoice.getState();
    const landed = `The deposit arrived: the wallet now holds ${portfolio.usdcBalance.toFixed(2)} USDC.`;
    if (!resume) { v.announce(`${landed} Tell the user briefly.`); return; }
    void resumeIntent(auth, resume).then((r) => v.announce(r.ok ? `${landed} Their request to ${describeIntent(resume)} is ready on the panel — ask them to press Confirm.` : `${landed} ${r.error ?? ""}`));
  }, [depositPrompt, portfolio, auth]);
  return null;
}

/* Headset: hide the DOM HUD while an immersive session is running (XRPanels
 * takes over) and switch the mic to hold-to-speak, so Rhea never hears room
 * noise and can be interrupted cleanly. Phone AR: the same HUD stays up,
 * rendered into the WebXR DOM overlay root so the browser keeps showing it
 * over the camera feed. */
function HudGate() {
  const mode = useStore(xrStore, (s) => s.mode);
  const handheld = useHandheld((s) => s.active);
  const headset = mode != null && handheld !== "webxr";
  useEffect(() => {
    if (headset) track("webxr_entered", mode ?? "");
    useVoice.getState().setPushToTalk(headset);
  }, [headset, mode]);
  if (headset) return null;
  if (handheld === "webxr" && arOverlayRoot) return createPortal(<ArOverlay><Hud /></ArOverlay>, arOverlayRoot);
  return <Hud />;
}

/* Inside the WebXR overlay the canvas isn't the element under the finger, so
 * spin/pinch are read here; taps on buttons must not also "select" in the
 * scene (beforexrselect), while taps on empty screen still reach the markers. */
function ArOverlay({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useGlobeGestures(ref, { dragAnywhere: true, onTap: emitArTap });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const guard = (e: Event) => { if (e.target instanceof Element && e.target.closest(".clickable, button, a, input, select, textarea")) e.preventDefault(); };
    el.addEventListener("beforexrselect", guard);
    return () => el.removeEventListener("beforexrselect", guard);
  }, []);
  return <div ref={ref} className="ar-overlay-inner">{children}</div>;
}

/* Phone camera view (no WebXR): the rear camera behind the transparent canvas. */
function CameraBackdrop() {
  const stream = useHandheld((s) => (s.active === "camera" ? s.stream : null));
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    v.srcObject = stream;
    if (stream) v.play().catch(() => undefined);
    return () => { v.srcObject = null; };
  }, [stream]);
  if (!stream) return null;
  return <video ref={ref} className="camera-backdrop" autoPlay playsInline muted aria-hidden />;
}

export function App() {
  const appRef = useRef<HTMLDivElement>(null);
  const cameraView = useHandheld((s) => s.active === "camera");
  /* Pinch-to-zoom for every touch screen; drag-from-anywhere in the camera view (the globe is small over a
   * busy feed), where a tap on empty screen also moves the globe to where you tapped. */
  useGlobeGestures(appRef, { dragAnywhere: cameraView, onTap: cameraView ? emitArTap : undefined });
  return (
    <RheaAuthProvider>
      <div className={`app${cameraView ? " camera-view" : ""}`} ref={appRef}>
        <Boot />
        <IntentResumer />
        <CameraBackdrop />
        <ErrorBoundary><RheaScene /></ErrorBoundary>
        <HudGate />
      </div>
    </RheaAuthProvider>
  );
}

export { xrStore };
