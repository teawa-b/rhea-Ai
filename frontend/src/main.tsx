import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { RheaAuthProvider } from "./auth/Auth";
import { isSignInPage } from "./auth/signinTab";
import { SignInPage } from "./ui/SignInPage";
import { ErrorBoundary } from "./ui/ErrorBoundary";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {/* /?signin is the standalone sign-in tab opened from the "Sign in to trade" gate. */}
    {/* A throw anywhere above the scene — a wallet modal, a provider — used to unmount
        the whole tree and leave a black screen. Now it leaves a readable message. */}
    <ErrorBoundary>
      {isSignInPage() ? <RheaAuthProvider><SignInPage /></RheaAuthProvider> : <App />}
    </ErrorBoundary>
  </StrictMode>,
);
