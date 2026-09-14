/* Desktop / mobile HUD over the globe. In immersive XR the DOM is hidden and
 * XRPanels renders the equivalent in-world. */
import { useEffect, useRef, useState } from "react";
import { COMPANY_BY_ID, COUNTRIES } from "@shared/registry";
import { useAuth } from "@/auth/Auth";
import { useVoice } from "@/ai/voice";
import { useMarket } from "@/state/market";
import { useWorld } from "@/state/world";
import { fmtPct, fmtUsd } from "@/theme";
import { CompanyPanel } from "./CompanyPanel";
import { CountryPanel } from "./CountryPanel";
import { ChevronLeftIcon, GlobeIcon, MicIcon, MicOffIcon } from "./icons";
import { NewsCards, ImpactCard } from "./NewsCards";
import { RegionPanel } from "./RegionPanel";
import { REGION_BY_ID } from "@/state/regions";
import { DepositPanel, LoginPanel, OrderPanel, TradePanel } from "./TradePanel";
import { XrLaunch } from "./XrLaunch";

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
  const [xrMode, setXrMode] = useState<"immersive-ar" | "immersive-vr" | null>(null);
  const [showPortfolio, setShowPortfolio] = useState(false);
  const capRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    /* Feature-detect passthrough first (Meta: immersive-ar), then plain VR. */
    const xr = navigator.xr;
    if (!xr) return;
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

  const onOrb = () => {
    if (!live) void connect(auth);
    else if (textMode) { if (voiceState !== "connecting") void switchToVoice(auth); }
    else toggleMute();
  };
  const orbTitle = !live ? "Start voice" : textMode ? "Use the microphone" : muted ? "Unmute" : "Mute";
  const voiceTitle = voiceState === "off" ? "Rhea" : muted && !textMode ? "Muted" : textMode && voiceState === "idle" ? "Ready" : STATE_LABEL[voiceState];
  const voiceSub = voiceState === "off" ? STATE_LABEL.off
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
    <div className="hud">
      {/* ---------- top bar ---------- */}
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
              <button className="chip clickable" onClick={() => setShowPortfolio((v) => !v)} title={auth.address ?? ""}>
                <i className="dot on" />{portfolio ? fmtUsd(portfolio.totalValueUsd) : "…"} · {auth.displayName}
              </button>
              <button className="btn ghost sm" onClick={() => void auth.logout()}>Sign out</button>
            </>
          ) : (
            <button className="btn primary sm" onClick={auth.login} disabled={!auth.ready}>{auth.mode === "guest" ? "Sign in (needs Privy)" : "Sign in"}</button>
          )}
        </div>
      </div>

      {xrMode ? <XrLaunch mode={xrMode} /> : null}

      {/* ---------- stage ---------- */}
      <div className={`stage ${showPanel ? "" : "no-panel"}`}>
        <div className="left">
          {view !== "world" || comparison ? (
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
            </nav>
          ) : null}
          <div className="captions scroll" ref={capRef} style={{ maxHeight: "34vh" }}>
            {captions.map((c) => (
              <div key={c.id} className={`caption ${c.role}`}>
                <span className="who">{c.role === "user" ? "You" : "Rhea"}</span>
                {c.text}
              </div>
            ))}
          </div>
        </div>

        {showPanel ? (
          <div className="right">
            {pendingTrade ? <TradePanel /> : null}
            {pendingOrder ? <OrderPanel /> : null}
            {gatePanel ? (depositPrompt ? <DepositPanel /> : <LoginPanel />) : null}
            {!pendingTrade && !pendingOrder && !gatePanel && showPortfolio ? <PortfolioPanel onClose={() => setShowPortfolio(false)} /> : null}
            {!pendingTrade && !pendingOrder && !gatePanel && !showPortfolio && comparison ? (
              <div className="panel clickable">
                <div className="panel-head"><div><h2>Compare</h2><div className="sub">token price · 24h · underlying</div></div><button className="btn ghost sm" onClick={() => resetGlobe(false)}>✕</button></div>
                <div className="panel-body">
                  <div className="list">
                    {comparison.companyIds.map((id) => {
                      const co = COMPANY_BY_ID[id]; const p = prices[id]; const ch = p?.change24hPct ?? null;
                      return (
                        <div key={id} className="item" onClick={() => focusCompany(id)}>
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
                  {heatEntries.length ? <dl className="kv" style={{ marginBottom: 10 }}>{heatEntries.map(([k, v]) => <><dt key={`${k}d`}>{COUNTRIES[k as keyof typeof COUNTRIES]?.name ?? k}</dt><dd key={`${k}v`}>{((v ?? 0) * 100).toFixed(0)}%</dd></>)}</dl> : null}
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
          <button type="button" className={`orb ${voiceState}${muted && !textMode ? " off" : ""}${!live ? " invite" : ""}`} onClick={onOrb} title={orbTitle} aria-label={orbTitle}>
            {(muted && !textMode) || textMode ? <MicOffIcon size={20} /> : <MicIcon size={20} />}
          </button>
          <div className={`label${!live || textMode ? " tappable" : ""}`} onClick={!live || textMode ? onOrb : undefined}>
            <b>{voiceTitle}</b>
            {voiceSub}
          </div>
          {voiceState !== "off" && voiceState !== "connecting" ? <button className="btn ghost sm" onClick={disconnect}>End</button> : null}
        </div>
        <form className="row clickable ask" onSubmit={(e) => { e.preventDefault(); const q = text.trim(); if (!q) return; sendText(q, auth); setText(""); }}>
          <input className="chip ask-input" placeholder={`Ask Rhea… e.g. "What's happening in China?"`} value={text} onChange={(e) => setText(e.target.value)} enterKeyHint="send" />
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
  const auth = useAuth();
  useEffect(() => { void loadPortfolio(); }, [loadPortfolio]);
  const byCountry = new Map<string, number>();
  for (const p of portfolio?.positions ?? []) { const cc = COMPANY_BY_ID[p.companyId].countryCode; byCountry.set(cc, (byCountry.get(cc) ?? 0) + (p.valueUsd ?? 0)); }
  const total = portfolio?.totalValueUsd || 1;
  return (
    <div className="panel clickable">
      <div className="panel-head">
        <div><h2>Portfolio</h2><div className="sub">{auth.address ? `${auth.address.slice(0, 6)}…${auth.address.slice(-6)}` : ""} · Solana</div></div>
        <div className="row"><button className="btn ghost sm" onClick={() => setCountryHeat(Object.fromEntries([...byCountry].map(([k, v]) => [k, v / total])))}>Show on globe</button><button className="btn ghost sm" onClick={onClose}>✕</button></div>
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
              <div className="grow"><div className="name">{COMPANY_BY_ID[p.companyId].name}</div><div className="meta">{p.amountUi.toFixed(4)} {p.symbol}</div></div>
              <div className="mono">{fmtUsd(p.valueUsd)}</div>
            </div>
          ))}
          {portfolio && !portfolio.positions.length ? <div className="hint">No tokenized stocks yet. Fund the wallet with USDC on Solana, then ask Rhea to buy.</div> : null}
        </div>
        {byCountry.size ? (<><div className="divider" /><div className="hint">GEOGRAPHY</div><dl className="kv">{[...byCountry].map(([k, v]) => <><dt key={k}>{COUNTRIES[k as keyof typeof COUNTRIES].name}</dt><dd key={`${k}v`}>{((v / total) * 100).toFixed(0)}%</dd></>)}</dl></>) : null}
        {orders.filter((o) => o.status === "active").length ? (<><div className="divider" /><div className="hint">ACTIVE RULES</div>{orders.filter((o) => o.status === "active").map((o) => <div key={o.id} className="hint" style={{ color: "#ffd24a" }}>◉ {COMPANY_BY_ID[o.companyId].tokenSymbol}: {o.action.side} {o.action.side === "buy" ? fmtUsd(o.action.amount) : o.action.amount} when {o.condition.kind === "price_below" ? "≤" : "≥"} {fmtUsd(o.condition.priceUsd)}{o.simulated ? " (simulated)" : ""}</div>)}</>) : null}
        {trades.length ? (<><div className="divider" /><div className="hint">ORDER HISTORY</div>{trades.slice(0, 6).map((t) => <div key={t.id} className="hint">{t.side} {t.amount} {t.currency} {COMPANY_BY_ID[t.companyId].tokenSymbol} · {t.status}</div>)}</>) : null}
      </div>
    </div>
  );
}
