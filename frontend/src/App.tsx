import { useEffect } from "react";
import { useStore } from "zustand";
import { RheaAuthProvider, useAuth } from "@/auth/Auth";
import { useSignInTabSync } from "@/auth/signinTab";
import { useVoice, wireContextUpdates } from "@/ai/voice";
import { analyticsSummary, track, wireAnalytics } from "@/analytics";
import { RheaScene, enterImmersive, xrStore } from "@/scene/RheaScene";
import { xrGlobe } from "@/scene/CameraRig";
import { rig } from "@/scene/rig";
import { describeIntent, resumeIntent } from "@/solana/trade";
import { useMarket } from "@/state/market";
import { useWorld } from "@/state/world";
import { ErrorBoundary } from "@/ui/ErrorBoundary";
import { Hud } from "@/ui/Hud";

function Boot() {
  const loadOverview = useMarket((s) => s.loadOverview);
  const loadStatus = useMarket((s) => s.loadStatus);
  useEffect(() => {
    void loadStatus();
    void loadOverview();
    wireContextUpdates();
    wireAnalytics();
    const h = setInterval(() => void loadOverview(), 5 * 60_000);
    /* dev handle for poking the world from the console */
    (window as unknown as { rhea: unknown }).rhea = { world: useWorld, market: useMarket, rig, xrGlobe, voice: useVoice, analytics: analyticsSummary, enterImmersive, xrStore };
    return () => clearInterval(h);
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

  useEffect(() => {
    if (!auth.authenticated || !auth.address || !loginPrompt) return;
    const { resume } = loginPrompt;
    useMarket.getState().setLoginPrompt(null);
    const who = firstName ? ` as ${firstName}` : "";
    const v = useVoice.getState();
    if (!resume) { v.announce(`The user just signed in${who}. Welcome them briefly and carry on.`); return; }
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
    if (!depositPrompt || !portfolio || portfolio.usdcBalance < depositPrompt.neededUsd) return;
    const { resume } = depositPrompt;
    useMarket.getState().setDepositPrompt(null);
    const v = useVoice.getState();
    const landed = `The deposit arrived: the wallet now holds ${portfolio.usdcBalance.toFixed(2)} USDC.`;
    if (!resume) { v.announce(`${landed} Tell the user briefly.`); return; }
    void resumeIntent(auth, resume).then((r) => v.announce(r.ok ? `${landed} Their request to ${describeIntent(resume)} is ready on the panel — ask them to press Confirm.` : `${landed} ${r.error ?? ""}`));
  }, [depositPrompt, portfolio, auth]);
  return null;
}

/* Hide the DOM HUD while an immersive session is running (XRPanels takes
 * over) and switch the mic to hold-to-speak: in a headset the user holds the
 * controller's A button (or the talk pill) to talk, so Rhea never hears room
 * noise and can be interrupted cleanly. */
function HudGate() {
  const mode = useStore(xrStore, (s) => s.mode);
  useEffect(() => {
    if (mode) track("webxr_entered", mode);
    useVoice.getState().setPushToTalk(mode != null);
  }, [mode]);
  return mode == null ? <Hud /> : null;
}

export function App() {
  return (
    <RheaAuthProvider>
      <div className="app">
        <Boot />
        <IntentResumer />
        <ErrorBoundary><RheaScene /></ErrorBoundary>
        <HudGate />
      </div>
    </RheaAuthProvider>
  );
}

export { xrStore };
