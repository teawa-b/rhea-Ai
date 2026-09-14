/* Sign-in in its own tab. The gate panels open /?signin, a standalone page
 * that runs Privy's login; when it succeeds it signals this tab, which picks
 * the session up (reloading if Privy didn't notice on its own) and resumes the
 * trade that asked for sign-in. */
import { useEffect } from "react";
import type { RheaAuth } from "./Auth";
import { useMarket, type LoginPrompt } from "@/state/market";

export const SIGNIN_QUERY = "signin";
const CHANNEL = "rhea-auth";
const SIGNAL_KEY = "rhea:signed-in";
const RESUME_KEY = "rhea:resume-login";

export const isSignInPage = () => new URLSearchParams(window.location.search).has(SIGNIN_QUERY);

/** Opens the sign-in tab; falls back to the in-page modal if popups are blocked.
 * Call from a click handler so the browser treats it as user-initiated. */
export const signInUrl = () => `${window.location.origin}${window.location.pathname}?${SIGNIN_QUERY}=1`;

export function openSignInTab(auth: RheaAuth): boolean {
  const tab = window.open(signInUrl(), "rhea-signin");
  if (tab) { tab.focus?.(); return true; }
  auth.login();
  return false;
}

/** Called by the sign-in page once the user is authenticated. */
export function announceSignedIn() {
  try { new BroadcastChannel(CHANNEL).postMessage({ type: "signed-in", at: Date.now() }); } catch { /* unsupported */ }
  try { localStorage.setItem(SIGNAL_KEY, String(Date.now())); } catch { /* storage blocked */ }
}

/** Main app: react to a sign-in that happened in the other tab. */
export function useSignInTabSync(auth: RheaAuth) {
  /* Restore a login prompt carried across a reload so its trade resumes. */
  useEffect(() => {
    try {
      const raw = localStorage.getItem(RESUME_KEY);
      if (!raw) return;
      localStorage.removeItem(RESUME_KEY);
      useMarket.getState().setLoginPrompt(JSON.parse(raw) as LoginPrompt);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    if (auth.authenticated) return;
    let pending = false;
    let timer: number | undefined;
    const settle = () => {
      if (!pending || document.visibilityState !== "visible") return;
      window.clearTimeout(timer);
      /* Give Privy a moment to see the new session; reload if it doesn't. */
      timer = window.setTimeout(() => {
        const prompt = useMarket.getState().loginPrompt;
        try { if (prompt) localStorage.setItem(RESUME_KEY, JSON.stringify(prompt)); } catch { /* ignore */ }
        window.location.reload();
      }, 1200);
    };
    const onSignal = () => { pending = true; settle(); };
    let bc: BroadcastChannel | null = null;
    try { bc = new BroadcastChannel(CHANNEL); bc.onmessage = (e) => { if ((e.data as { type?: string })?.type === "signed-in") onSignal(); }; } catch { /* unsupported */ }
    const onStorage = (e: StorageEvent) => { if (e.key === SIGNAL_KEY) onSignal(); };
    window.addEventListener("storage", onStorage);
    document.addEventListener("visibilitychange", settle);
    return () => {
      bc?.close();
      window.removeEventListener("storage", onStorage);
      document.removeEventListener("visibilitychange", settle);
      window.clearTimeout(timer);
    };
  }, [auth.authenticated]);
}
