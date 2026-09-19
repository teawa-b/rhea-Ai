/* Desktop / mobile HUD over the globe. In immersive XR the DOM is hidden and
 * XRPanels renders the equivalent in-world. */
import { Fragment, useEffect, useRef, useState } from "react";
import { COMPANY_BY_ID, COUNTRIES } from "@shared/registry";
import { useAuth } from "@/auth/Auth";
import { useVoice } from "@/ai/voice";
import { VERIFIED_ON_MAINNET } from "@/demo/verified";
import { enterHandheld, exitHandheld, recenterHandheld, useHandheld } from "@/scene/handheld";
import { DEMO_WALLET, sessionPill, startSessionPolling, useMarket } from "@/state/market";
import { useWorld } from "@/state/world";
import { fmtEt, fmtPct, fmtUsd, solscanTx } from "@/theme";
import { CompanyPanel } from "./CompanyPanel";
import { CoLogo } from "./CoLogo";
import { CountryPanel } from "./CountryPanel";
import { ArIcon, ChevronLeftIcon, GlobeIcon, MicIcon, MicOffIcon, RecenterIcon } from "./icons";
import { NewsCards, ImpactCard } from "./NewsCards";
import { RegionPanel } from "./RegionPanel";
import { REGION_BY_ID } from "@/state/regions";
import { DepositPanel, LoginPanel, OrderPanel, TradePanel } from "./TradePanel";
import { XrLaunch, xrLaunchAllowed } from "./XrLaunch";

function SolanaMark() {
  /* Solana's three-bar mark, gradient purple → green. */
  return (
    <svg viewBox="0 0 397 311" width="16" height="13" aria-hidden>
      <defs><linearGradient id="solg" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stopColor="#9945FF" /><stop offset="1" stopColor="#14F195" /></linearGradient></defs>
      <path fill="url(#solg)" d="M64.6 237.9c2.4-2.4 5.7-3.8 9.2-3.8h317.4c5.8 0 8.7 7 4.6 11.1l-62.7 62.7c-2.4 2.4-5.7 3.8-9.2 3.8H6.5c-5.8 0-8.7-7-4.6-11.1l62.7-62.7zM64.6 3.8C67.1 1.4 70.4 0 73.8 0h317.4c5.8 0 8.7 7 4.6 11.1l-62.7 62.7c-2.4 2.4-5.7 3.8-9.2 3.8H6.5c-5.8 0-8.7-7-4.6-11.1L64.6 3.8zM333.1 120.1c-2.4-2.4-5.7-3.8-9.2-3.8H6.5c-5.8 0-8.7 7-4.6 11.1l62.7 62.7c2.4 2.4 5.7 3.8 9.2 3.8h317.4c5.8 0 8.7-7 4.6-11.1l-62.7-62.7z" />
    </svg>
  );
}

function Logo() {
  return (
    <svg viewBox="0 0 64 64" aria-hidden>
      <circle cx="32" cy="32" r="18" fill="none" stroke="#3fe0ff" strokeWidth="2.5" />
      <ellipse cx="32" cy="32" rx="18" ry="7" fill="none" stroke="#3fe0ff" strokeWidth="1.5" opacity=".6" />
      <line x1="14" y1="32" x2="50" y2="32" stroke="#3fe0ff" strokeWidth="1.5" opacity=".6" />
      <circle cx="40" cy="24" r="3.5" fill="#3fe0ff" />
    </svg>
  );
}

/* "Regular session closed · opens in 11h 20m · Solana: open". Ticks every 30 s so the countdown stays honest
 * between the store's 60 s polls; hidden until the first answer rather than guessing from the local clock. */
function SessionPill() {
  const session = useMarket((s) => s.session);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { startSessionPolling(); const h = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(h); }, []);
  if (!session) return null;
  const pill = sessionPill(session, now);
  return (
    <span className="chip" role="status" title="xStocks trade 24/5 on Solana through Jupiter; the US regular session is 09:30–16:00 ET" style={{ alignSelf: "flex-start", maxWidth: "100%", padding: "5px 11px", borderRadius: 999, fontSize: 11, gap: 7, borderColor: pill.open ? "rgba(20,241,149,0.4)" : "rgba(255,178,32,0.4)" }}>
      <i className={`dot ${pill.open ? "on" : "warn"}`} style={{ width: 7, height: 7 }} />
      <span className="long">{pill.long}</span>
      <span className="short">{pill.short}</span>
    </span>
  );
}

/* "Verified on mainnet (N) ↗": the committed snapshot of real transactions (demo/verified.ts), readable with no
 * login. Renders nothing while the list is empty. */
function VerifiedOnMainnet() {
  const [open, setOpen] = useState(false);
  if (!VERIFIED_ON_MAINNET.length) return null;
  return (
    <div className="clickable" style={{ alignSelf: "flex-start", maxWidth: "100%" }}>
      <button type="button" className="chip" aria-expanded={open} onClick={() => setOpen(!open)} style={{ cursor: "pointer", padding: "5px 11px", borderRadius: 999, fontSize: 11, gap: 7, borderColor: "rgba(20,241,149,0.4)" }}>
        <i className="dot on" style={{ width: 7, height: 7 }} />Verified on mainnet ({VERIFIED_ON_MAINNET.length}) ↗
      </button>
      {open ? (
        <div className="panel" style={{ marginTop: 6, padding: "8px 12px", width: "min(380px, calc(100vw - 24px))" }}>
          <div className="hint">Snapshot of real Rhea transactions on Solana mainnet</div>
          {VERIFIED_ON_MAINNET.map((t) => (
            <div key={t.signature} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "6px 0", borderTop: "1px solid rgba(63,224,255,0.12)", fontSize: 12 }}>
              <div style={{ minWidth: 0 }}><div>{t.label}</div><div className="hint">{fmtEt(t.at)} · {t.session}</div></div>
              <a href={solscanTx(t.signature)} target="_blank" rel="noreferrer" title={t.signature} style={{ whiteSpace: "nowrap" }}>Solscan ↗</a>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/* Matches the phone breakpoint in styles.css (max-width: 600px). */
function useNarrow() {
  const q = "(max-width: 600px)";
  const [narrow, setNarrow] = useState(() => window.matchMedia(q).matches);
  useEffect(() => { const mq = window.matchMedia(q); const on = () => setNarrow(mq.matches); mq.addEventListener("change", on); return () => mq.removeEventListener("change", on); }, []);
  return narrow;
}

/* Tap-to-ask starters; the first is the evening habit Rhea is built around. */
const SUGGESTIONS = ["What changed while the market was closed?", "Why is Nvidia moving?"];

const STATE_LABEL: Record<string, string> = { off: "Tap to talk to Rhea", connecting: "Connecting…", idle: "Listening", listening: "Hearing you…", thinking: "Researching…", speaking: "Speaking", error: "Voice error" };

export function Hud() {
  const auth = useAuth();
  const status = useMarket((s) => s.status);
  const overview = useMarket((s) => s.overview);
  const portfolio = useMarket((s) => s.portfolio);
  const lastError = useMarket((s) => s.lastError);
  const setError = useMarket((s) => s.setError);
  const pendingTrade = useMarket((s) => s.pendingTrade);
  const pendingOrder = useMarket((s) => s.pendingOrder);
  const loginPrompt = useMarket((s) => s.loginPrompt);
  const depositPrompt = useMarket((s) => s.depositPrompt);
  const prices = useMarket((s) => s.prices);
  const demoMode = useMarket((s) => s.demoMode);

  const view = useWorld((s) => s.view);
  const focusedRegion = useWorld((s) => s.focusedRegion);
  const focusedCountry = useWorld((s) => s.focusedCountry);
  const focusedCompany = useWorld((s) => s.focusedCompany);
  const comparison = useWorld((s) => s.comparison);
  const news = useWorld((s) => s.news);
  const impact = useWorld((s) => s.impact);
  const countryHeat = useWorld((s) => s.countryHeat);
  const resetGlobe = useWorld((s) => s.resetGlobe);
  const focusCompany = useWorld((s) => s.focusCompany);
  const focusCountry = useWorld((s) => s.focusCountry);
  const panelReady = useWorld((s) => s.panelReady);
  /* The portfolio panel rides along with the holdings planet. */
  const showPortfolio = useWorld((s) => s.vault);
  const showHoldings = useWorld((s) => s.showHoldings);

  const voiceState = useVoice((s) => s.state);
  const inputMode = useVoice((s) => s.inputMode);
  const captions = useVoice((s) => s.captions);
  const voiceError = useVoice((s) => s.error);
  const voiceNotice = useVoice((s) => s.notice);
  const muted = useVoice((s) => s.muted);
  const lastTool = useVoice((s) => s.lastTool);
  const connect = useVoice((s) => s.connect);
  const switchToVoice = useVoice((s) => s.switchToVoice);
  const disconnect = useVoice((s) => s.disconnect);
  const toggleMute = useVoice((s) => s.toggleMute);
  const sendText = useVoice((s) => s.sendText);
  const live = voiceState !== "off" && voiceState !== "error";
  const textMode = live && inputMode === "text";

  const [text, setText] = useState("");
  const narrow = useNarrow();
  const showCrumbs = view !== "world" || Boolean(comparison) || showPortfolio;
  /* Phone AR. `ar` is the running mode; `arSupport` decides whether the button exists at all (never on desktop). */
  const ar = useHandheld((s) => s.active);
  const arSupport = useHandheld((s) => s.support);
  const arEntering = useHandheld((s) => s.entering);
  const arGyro = useHandheld((s) => s.gyro);
  const arTracked = ar === "webxr" || (ar === "camera" && arGyro);
  const [xrMode, setXrMode] = useState<"immersive-ar" | "immersive-vr" | null>(null);
  const capRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    /* Feature-detect passthrough first (Meta: immersive-ar), then plain VR; only where the launcher makes sense. */
    const xr = navigator.xr;
    if (!xr || !xrLaunchAllowed()) return;
    void xr.isSessionSupported("immersive-ar").then((ar) => {
      if (ar) { setXrMode("immersive-ar"); return; }
      return xr.isSessionSupported("immersive-vr").then((vr) => setXrMode(vr ? "immersive-vr" : null));
    }).catch(() => setXrMode(null));
  }, []);
  useEffect(() => { capRef.current?.scrollTo({ top: 1e6, behavior: "smooth" }); }, [captions]);
  useEffect(() => {
    if (!lastError && !voiceError) return;
    const h = setTimeout(() => { setError(null); useVoice.setState({ error: null }); }, 7000);
    return () => clearTimeout(h);
  }, [lastError, voiceError, setError]);
  useEffect(() => {
    if (!voiceNotice) return;
    const h = setTimeout(() => useVoice.setState({ notice: null }), 10000);
    return () => clearTimeout(h);
  }, [voiceNotice]);

  /* Signed-out visitors: switch to ?demo=1 in place (no reload, so the tap still counts as the gesture that starts
   * audio, and a tab that was already greeted still hears it) and ask the briefing question; get_briefing reads the store wallet. */
  const showDemoChip = Boolean(DEMO_WALLET) && auth.ready && !auth.authenticated && !demoMode;
  const hearDemo = () => {
    try { const u = new URL(window.location.href); u.searchParams.set("demo", "1"); window.history.replaceState(window.history.state, "", u); } catch { /* ignore */ }
    /* Worded as the demo so Rhea never presents a public wallet as the visitor's own. */
    if (useMarket.getState().enterDemo()) sendText("What changed in the demo portfolio while the market was closed?", auth);
  };

  const onOrb = () => {
    if (!live) void connect(auth);
    else if (textMode) { if (voiceState !== "connecting") void switchToVoice(auth); }
    else toggleMute();
  };
  const orbTitle = !live ? "Start voice" : textMode ? "Use the microphone" : muted ? "Unmute" : "Mute";
  const voiceTitle = voiceState === "off" ? "Rhea" : muted && !textMode ? "Muted" : textMode && voiceState === "idle" ? "Ready" : STATE_LABEL[voiceState];
  const voiceSub = voiceState === "off" ? (demoMode ? "Tap to hear the demo portfolio briefing" : STATE_LABEL.off)
    : voiceState === "thinking" && lastTool ? lastTool.replace(/_/g, " ")
    : voiceState === "error" ? (voiceError ?? "error")
    : textMode ? "Text mode · tap to use mic"
    : "Full-duplex · interrupt any time";

  /* A focused place's panel waits until the camera has arrived (panelReady). */
  const placePanel = panelReady && (focusedCompany || focusedCountry || focusedRegion);
  const gatePanel = !pendingTrade && !pendingOrder && (depositPrompt || loginPrompt);
  const showPanel = pendingTrade || pendingOrder || gatePanel || placePanel || comparison || showPortfolio || (news && !focusedCompany && !focusedCountry && !focusedRegion) || Object.keys(countryHeat).length > 0;
  const goBack = () => { if (focusedCompany && focusedCountry) focusCountry(focusedCountry); else resetGlobe(false); };
  const heatEntries = Object.entries(countryHeat).filter(([, v]) => (v ?? 0) > 0).sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0));

  return (
    <div className={`hud${ar ? " ar" : ""}`}>
      {/* ---------- top bar ---------- */}
      {ar ? (
        /* AR: the brand, market chip and account row step aside; one slim bar with the way out (and recenter on tracked devices). */
        <div className="arbar">
          <button className="btn sm ar-exit" onClick={exitHandheld} title="Back to the flat view"><ChevronLeftIcon size={14} />Exit AR</button>
          <span className="chip dim ar-mode" title={ar === "webxr" ? "Tracked AR: the globe is fixed in your room; walk around it" : arGyro ? "Anchored by the motion sensor: turn to look around (position isn't tracked without WebXR)" : "Camera view: no motion sensor, the globe follows the phone"}>
            <i className={`dot ${arTracked ? "on" : "warn"}`} />{ar === "webxr" ? "AR" : arGyro ? "AR · gyro" : "Camera view"}
          </span>
          {arTracked ? <button className="btn ghost sm" onClick={() => { resetGlobe(false); recenterHandheld(); }} title="Re-place the globe in front of you" aria-label="Recenter"><RecenterIcon size={15} /></button> : null}
        </div>
      ) : (
      <div className="topbar">
        <div className="brand">
          <div className="brand-mark"><Logo /></div>
          <div><h1>Rhea</h1><small>AI-native spatial markets · Solana</small></div>
        </div>
        <div className="topbar-right">
          <span className="chip sol" title={overview?.source}>
            <SolanaMark />
            {overview ? (
              <>
                <span className="long">{overview.assets.length} tokenized stocks · {overview.countries.length} countries · Solana</span>
                <span className="short">{overview.assets.length} stocks · {overview.countries.length} countries</span>
              </>
            ) : "loading market…"}
          </span>
          {status && !status.openai ? <span className="chip dim" title="Set OPENAI_API_KEY on the server"><i className="dot err" />voice offline</span> : null}
          {auth.authenticated ? (
            <>
              <button className="chip clickable" onClick={() => (showPortfolio ? resetGlobe(false) : showHoldings())} title={showPortfolio ? "Back to Earth" : "Fly to your holdings"}>
                <i className="dot on" />{portfolio ? fmtUsd(portfolio.totalValueUsd) : "…"} · {auth.displayName}
              </button>
              <button className="btn ghost sm" onClick={() => void auth.logout()}>Sign out</button>
            </>
          ) : (
            <>
              {demoMode ? (
                <button className="chip clickable" onClick={() => (showPortfolio ? resetGlobe(false) : showHoldings())} title={`Public demo wallet ${DEMO_WALLET?.slice(0, 4)}…${DEMO_WALLET?.slice(-4)}. Read-only: sign in to trade your own wallet.`} style={{ borderColor: "rgba(255,178,32,0.5)" }}>
                  <i className="dot warn" />Demo portfolio · read-only{portfolio ? ` · ${fmtUsd(portfolio.totalValueUsd)}` : ""}
                </button>
              ) : null}
              <button className="btn primary sm" onClick={auth.login} disabled={!auth.ready}>{auth.mode === "guest" ? "Sign in (needs Privy)" : "Sign in"}</button>
            </>
          )}
        </div>
      </div>
      )}

      {xrMode && !ar ? <XrLaunch mode={xrMode} /> : null}

      {/* ---------- stage ---------- */}
      <div className={`stage ${showPanel ? "" : "no-panel"}`}>
        <div className="left">
          {/* Phones: the rising panel covers the second row, so the trail wins there (the panel repeats the session). */}
          {!(narrow && showCrumbs) && !ar ? <SessionPill /> : null}
          {!(narrow && showCrumbs) && !ar ? <VerifiedOnMainnet /> : null}
          {showCrumbs ? (
            <nav className="crumbs clickable" aria-label="Where you are">
              <button className="crumb-back" onClick={goBack} title="Back" aria-label="Back"><ChevronLeftIcon size={16} /></button>
              <button className="crumb" onClick={() => resetGlobe(false)}><GlobeIcon size={14} />World</button>
              {focusedRegion ? (<><span className="crumb-sep" aria-hidden>›</span><span className="crumb current" aria-current="page">{REGION_BY_ID[focusedRegion]?.name}</span></>) : null}
              {focusedCountry ? (
                <>
                  <span className="crumb-sep" aria-hidden>›</span>
                  {focusedCompany
                    ? <button className="crumb" onClick={() => focusCountry(focusedCountry)}>{COUNTRIES[focusedCountry].name}</button>
                    : <span className="crumb current" aria-current="page">{COUNTRIES[focusedCountry].name}</span>}
                </>
              ) : null}
              {focusedCompany ? (<><span className="crumb-sep" aria-hidden>›</span><span className="crumb current" aria-current="page">{COMPANY_BY_ID[focusedCompany]?.name}</span></>) : null}
              {comparison ? (<><span className="crumb-sep" aria-hidden>›</span><span className="crumb current" aria-current="page">Compare</span></>) : null}
              {showPortfolio ? (<><span className="crumb-sep" aria-hidden>›</span><span className="crumb current" aria-current="page">Holdings</span></>) : null}
            </nav>
          ) : null}
          <div className="captions scroll" ref={capRef} style={{ maxHeight: ar ? "24vh" : "34vh" }}>
            {captions.map((c) => (
              <div key={c.id} className={`caption ${c.role}`}>
                <span className="who">{c.role === "user" ? "You" : "Rhea"}</span>
                {c.text}
              </div>
            ))}
          </div>
          {!captions.length ? (
            <div className="row clickable" style={{ gap: 6, flexWrap: "wrap" }}>
              {showDemoChip ? <button type="button" className="chip" onClick={hearDemo} title="A public wallet's real portfolio, read-only, no sign-in" style={{ cursor: "pointer", padding: "6px 11px", borderRadius: 999, fontSize: 11.5, whiteSpace: "normal", textAlign: "left", borderColor: "rgba(20,241,149,0.45)" }}>▶ Hear the demo portfolio briefing</button> : null}
              {SUGGESTIONS.map((q) => (
                <button key={q} type="button" className="chip" onClick={() => sendText(q, auth)} style={{ cursor: "pointer", padding: "6px 11px", borderRadius: 999, fontSize: 11.5, whiteSpace: "normal", textAlign: "left" }}>{q}</button>
              ))}
            </div>
          ) : null}
        </div>

        {showPanel ? (
          <div className="right">
            {pendingTrade ? <TradePanel /> : null}
            {pendingOrder ? <OrderPanel /> : null}
            {gatePanel ? (depositPrompt ? <DepositPanel /> : <LoginPanel />) : null}
            {!pendingTrade && !pendingOrder && !gatePanel && showPortfolio ? <PortfolioPanel onClose={() => resetGlobe(false)} /> : null}
            {!pendingTrade && !pendingOrder && !gatePanel && !showPortfolio && comparison ? (
              <div className="panel clickable">
                <div className="panel-head"><div><h2>Compare</h2><div className="sub">token price · 24h · underlying</div></div><button className="btn ghost sm" onClick={() => resetGlobe(false)}>✕</button></div>
                <div className="panel-body">
                  <div className="list">
                    {comparison.companyIds.map((id) => {
                      const co = COMPANY_BY_ID[id]; const p = prices[id]; const ch = p?.change24hPct ?? null;
                      return (
                        <div key={id} className="item" onClick={() => focusCompany(id)}>
                          <CoLogo id={id} />
                          <div className="grow"><div className="name">{co.name} <span className="muted">{co.ticker}</span></div><div className="meta">{co.sector} · {COUNTRIES[co.countryCode].name}</div></div>
                          <div style={{ textAlign: "right" }}><div className="mono">{fmtUsd(p?.tokenPriceUsd)}</div><div className={`mono ${ch == null ? "" : ch >= 0 ? "pos" : "neg"}`} style={{ fontSize: 11 }}>{fmtPct(ch)}</div><div className="hint">stock {fmtUsd(p?.underlyingPriceUsd)}</div></div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            ) : null}
            {!pendingTrade && !pendingOrder && !gatePanel && !showPortfolio && !comparison && panelReady && focusedCompany ? <CompanyPanel key={focusedCompany} companyId={focusedCompany} /> : null}
            {!pendingTrade && !pendingOrder && !gatePanel && !showPortfolio && !comparison && panelReady && !focusedCompany && focusedCountry ? <CountryPanel key={focusedCountry} code={focusedCountry} /> : null}
            {!pendingTrade && !pendingOrder && !gatePanel && !showPortfolio && !comparison && panelReady && focusedRegion ? <RegionPanel key={focusedRegion} id={focusedRegion} /> : null}
            {!pendingTrade && !pendingOrder && !gatePanel && !showPortfolio && !comparison && !focusedCompany && !focusedCountry && !focusedRegion && (news || impact || heatEntries.length) ? (
              <div className="panel clickable">
                <div className="panel-head"><div><h2>{heatEntries.length ? "Portfolio geography" : news?.target ?? "Research"}</h2><div className="sub">{heatEntries.length ? "exposure by country" : "sources"}</div></div><button className="btn ghost sm" onClick={() => resetGlobe(true)}>✕</button></div>
                <div className="panel-body scroll">
                  {heatEntries.length ? <dl className="kv" style={{ marginBottom: 10 }}>{heatEntries.map(([k, v]) => <Fragment key={k}><dt>{COUNTRIES[k as keyof typeof COUNTRIES]?.name ?? k}</dt><dd>{((v ?? 0) * 100).toFixed(0)}%</dd></Fragment>)}</dl> : null}
                  {impact ? <ImpactCard impact={impact} /> : null}
                  {news ? <NewsCards items={news.items} /> : null}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      {/* ---------- bottom bar ---------- */}
      <div className="bottombar">
        <div className="voice clickable">
          <button type="button" className={`orb ${voiceState}${muted && !textMode ? " off" : ""}${!live ? " invite" : ""}${live && !textMode && !muted && voiceState !== "connecting" ? " mic-hot" : ""}`} onClick={onOrb} title={orbTitle} aria-label={orbTitle}>
            {(muted && !textMode) || textMode ? <MicOffIcon size={20} /> : <MicIcon size={20} />}
          </button>
          <div className={`label${!live || textMode ? " tappable" : ""}`} onClick={!live || textMode ? onOrb : undefined}>
            <b>{voiceTitle}</b>
            {voiceSub}
          </div>
          {voiceState !== "off" && voiceState !== "connecting" ? <button className="btn ghost sm" onClick={disconnect}>End</button> : null}
          {arSupport && !ar ? (
            <button className="btn ghost sm ar-btn" onClick={() => void enterHandheld()} disabled={arEntering} title={arSupport === "webxr" ? "Put the globe in your room (AR)" : "Show the globe over your camera"} aria-label="Enter AR">
              <ArIcon size={16} />{arEntering ? "Starting…" : "AR"}
            </button>
          ) : null}
        </div>
        <form className="row clickable ask" onSubmit={(e) => { e.preventDefault(); const q = text.trim(); if (!q) return; sendText(q, auth); setText(""); }}>
          <input className="chip ask-input" placeholder={`Ask Rhea… e.g. "Why is Nvidia moving?"`} value={text} onChange={(e) => setText(e.target.value)} enterKeyHint="send" />
          <button className="btn sm" type="submit">Ask</button>
        </form>
      </div>

      {lastError || voiceError ? <div className="toast"><span className="chip"><i className="dot err" />{lastError ?? voiceError}</span></div>
        : voiceNotice ? <div className="toast"><span className="chip notice"><i className="dot warn" />{voiceNotice}</span></div> : null}
    </div>
  );
}

function PortfolioPanel({ onClose }: { onClose: () => void }) {
  const portfolio = useMarket((s) => s.portfolio);
  const orders = useMarket((s) => s.orders);
  const trades = useMarket((s) => s.trades);
  const loadPortfolio = useMarket((s) => s.loadPortfolio);
  const focusCompany = useWorld((s) => s.focusCompany);
  const setCountryHeat = useWorld((s) => s.setCountryHeat);
  /* The store wallet, not auth.address: in ?demo=1 it is the read-only demo wallet. */
  const wallet = useMarket((s) => s.wallet);
  const demoMode = useMarket((s) => s.demoMode);
  useEffect(() => { void loadPortfolio(); }, [loadPortfolio]);
  const byCountry = new Map<string, number>();
  for (const p of portfolio?.positions ?? []) { const cc = COMPANY_BY_ID[p.companyId].countryCode; byCountry.set(cc, (byCountry.get(cc) ?? 0) + (p.valueUsd ?? 0)); }
  const total = portfolio?.totalValueUsd || 1;
  return (
    <div className="panel clickable">
      <div className="panel-head">
        <div><h2>{demoMode ? "Demo portfolio" : "Portfolio"}</h2><div className="sub">{wallet ? `${wallet.slice(0, 6)}…${wallet.slice(-6)}` : ""} · Solana{demoMode ? " · read-only" : ""}</div></div>
        <div className="row"><button className="btn ghost sm" onClick={() => { setCountryHeat(Object.fromEntries([...byCountry].map(([k, v]) => [k, v / total]))); useWorld.getState().resetGlobe(false); }}>Show on Earth</button><button className="btn ghost sm" onClick={onClose}>✕</button></div>
      </div>
      <div className="panel-body scroll">
        <div className="big">{fmtUsd(portfolio?.totalValueUsd)}</div>
        <dl className="kv" style={{ marginTop: 6 }}>
          <dt>USDC</dt><dd>{fmtUsd(portfolio?.usdcBalance)}</dd>
          <dt>SOL</dt><dd>{portfolio?.solBalance.toFixed(4) ?? "—"}</dd>
        </dl>
        <div className="divider" />
        <div className="list">
          {(portfolio?.positions ?? []).map((p) => (
            <div key={p.mint} className="item" onClick={() => focusCompany(p.companyId)}>
              <CoLogo id={p.companyId} />
              <div className="grow"><div className="name">{COMPANY_BY_ID[p.companyId].name}</div><div className="meta">{p.amountUi.toFixed(4)} {p.symbol}</div></div>
              <div className="mono">{fmtUsd(p.valueUsd)}</div>
            </div>
          ))}
          {portfolio && !portfolio.positions.length && !demoMode ? <div className="hint">No tokenized stocks yet. Fund the wallet with USDC on Solana, then ask Rhea to buy.</div> : null}
        </div>
        {byCountry.size ? (<><div className="divider" /><div className="hint">GEOGRAPHY</div><dl className="kv">{[...byCountry].map(([k, v]) => <Fragment key={k}><dt>{COUNTRIES[k as keyof typeof COUNTRIES].name}</dt><dd>{((v / total) * 100).toFixed(0)}%</dd></Fragment>)}</dl></>) : null}
        {orders.filter((o) => o.status === "active").length ? (<><div className="divider" /><div className="hint">ACTIVE RULES</div>{orders.filter((o) => o.status === "active").map((o) => <div key={o.id} className="hint" style={{ color: "#ffd24a" }}>◉ {COMPANY_BY_ID[o.companyId].tokenSymbol}: {o.action.side} {o.action.side === "buy" ? fmtUsd(o.action.amount) : o.action.amount} when {o.condition.kind === "price_below" ? "≤" : "≥"} {fmtUsd(o.condition.priceUsd)}{o.simulated ? " (simulated)" : ""}</div>)}</>) : null}
        {trades.length ? (<><div className="divider" /><div className="hint">ORDER HISTORY</div>{trades.slice(0, 6).map((t) => <div key={t.id} className="hint">{t.side} {t.amount} {t.currency} {COMPANY_BY_ID[t.companyId].tokenSymbol} · {t.status}</div>)}</>) : null}
      </div>
    </div>
  );
}
