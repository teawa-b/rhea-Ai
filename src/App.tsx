import { useEffect } from "react";
import { useStore } from "zustand";
import { RheaAuthProvider } from "@/auth/Auth";
import { wireContextUpdates } from "@/ai/voice";
import { analyticsSummary, track, wireAnalytics } from "@/analytics";
import { RheaScene, enterImmersive, xrStore } from "@/scene/RheaScene";
import { rig } from "@/scene/rig";
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
    (window as unknown as { rhea: unknown }).rhea = { world: useWorld, market: useMarket, rig, analytics: analyticsSummary, enterImmersive, xrStore };
    return () => clearInterval(h);
  }, [loadOverview, loadStatus]);
  return null;
}

/* Hide the DOM HUD while an immersive session is running (XRPanels takes over). */
function HudGate() {
  const mode = useStore(xrStore, (s) => s.mode);
  useEffect(() => { if (mode) track("webxr_entered", mode); }, [mode]);
  return mode == null ? <Hud /> : null;
}

export function App() {
  return (
    <RheaAuthProvider>
      <div className="app">
        <Boot />
        <ErrorBoundary><RheaScene /></ErrorBoundary>
        <HudGate />
      </div>
    </RheaAuthProvider>
  );
}

export { xrStore };
