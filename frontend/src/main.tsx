import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { RheaAuthProvider } from "./auth/Auth";
import { isSignInPage } from "./auth/signinTab";
import { SignInPage } from "./ui/SignInPage";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {/* /?signin is the standalone sign-in tab opened from the "Sign in to trade" gate. */}
    {isSignInPage() ? <RheaAuthProvider><SignInPage /></RheaAuthProvider> : <App />}
  </StrictMode>,
);
