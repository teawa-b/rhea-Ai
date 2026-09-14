/* Standalone sign-in tab (/?signin). Opens Privy's login straight away, then
 * tells the Rhea tab it can carry on and offers to close itself. */
import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/auth/Auth";
import { announceSignedIn } from "@/auth/signinTab";

function Mark() {
  return (
    <svg viewBox="0 0 64 64" aria-hidden>
      <circle cx="32" cy="32" r="18" fill="none" stroke="#3fe0ff" strokeWidth="2.5" />
      <ellipse cx="32" cy="32" rx="18" ry="7" fill="none" stroke="#3fe0ff" strokeWidth="1.5" opacity=".6" />
      <line x1="14" y1="32" x2="50" y2="32" stroke="#3fe0ff" strokeWidth="1.5" opacity=".6" />
      <circle cx="40" cy="24" r="3.5" fill="#3fe0ff" />
    </svg>
  );
}

export function SignInPage() {
  const auth = useAuth();
  const opened = useRef(false);
  const [closeFailed, setCloseFailed] = useState(false);

  useEffect(() => { document.title = "Sign in · Rhea"; }, []);
  /* Pop the login as soon as Privy is ready; the button stays as a fallback. */
  useEffect(() => {
    if (!auth.ready || auth.authenticated || auth.mode !== "privy" || opened.current) return;
    opened.current = true;
    auth.login();
  }, [auth]);
  useEffect(() => { if (auth.authenticated && auth.address) announceSignedIn(); }, [auth.authenticated, auth.address]);

  const done = auth.authenticated;
  const goBack = () => {
    window.close();
    /* Tabs the user opened by hand can't close themselves. */
    window.setTimeout(() => setCloseFailed(true), 250);
  };

  return (
    <div className="signin">
      <div className="signin-grid" aria-hidden />
      <div className="panel signin-card">
        <i className="xr-corner tl" aria-hidden /><i className="xr-corner tr" aria-hidden />
        <i className="xr-corner bl" aria-hidden /><i className="xr-corner br" aria-hidden />
        <div className="signin-brand">
          <div className="brand-mark"><Mark /></div>
          <div><b>RHEA</b><small>AI-native spatial markets · Solana</small></div>
        </div>
        <div className="xr-modal-kicker">{done ? "Link established" : "Secure sign-in · Privy"}</div>
        <h1 className={done ? "ok" : ""}>{done ? "You're signed in" : "Sign in to trade"}</h1>

        {done ? (
          <>
            <p className="signin-copy">
              {auth.displayName ? <>Welcome, <b>{auth.displayName}</b>. </> : null}
              Head back to your Rhea tab or headset — anything you asked to trade picks up automatically.
            </p>
            {auth.address ? (
              <div className="signin-wallet">
                <span>Solana wallet</span>
                <code>{auth.address.slice(0, 6)}…{auth.address.slice(-6)}</code>
              </div>
            ) : <div className="signin-wallet"><span>Solana wallet</span><code>creating…</code></div>}
            <div className="signin-actions">
              <button className="btn sol" onClick={goBack}>Return to Rhea</button>
              {closeFailed ? <p className="hint">Close this tab and switch back to Rhea.</p> : null}
            </div>
          </>
        ) : (
          <>
            <p className="signin-copy">
              Use Google, email or a Solana wallet. New accounts get an embedded Solana wallet in seconds — Rhea never holds your keys.
            </p>
            <ul className="signin-steps">
              <li><span>01</span>Sign in here</li>
              <li><span>02</span>Return to your Rhea tab</li>
              <li><span>03</span>Your trade continues</li>
            </ul>
            <div className="signin-actions">
              <button className="btn sol" onClick={auth.login} disabled={!auth.ready || auth.mode !== "privy"}>
                {!auth.ready ? "Connecting…" : auth.mode !== "privy" ? "Sign-in unavailable" : "Continue"}
              </button>
              {auth.mode !== "privy" ? <p className="hint">Sign-in needs VITE_PRIVY_APP_ID on this deployment.</p> : null}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
