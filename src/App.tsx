/* Temporary shell — globe only. Replaced by the full HUD next. */
import { useEffect } from "react";
import { RheaScene } from "@/scene/RheaScene";
import { ErrorBoundary } from "@/ui/ErrorBoundary";
import { useMarket } from "@/state/market";
import { useWorld } from "@/state/world";
import { rig } from "@/scene/rig";

export function App() {
  const loadOverview = useMarket((s) => s.loadOverview);
  useEffect(() => { void loadOverview(); }, [loadOverview]);
  useEffect(() => {
    // dev handle for poking the world from the console
    (window as unknown as { rhea: unknown }).rhea = { world: useWorld, market: useMarket, rig };
  }, []);
  return (
    <div className="app">
      <ErrorBoundary><RheaScene /></ErrorBoundary>
    </div>
  );
}
