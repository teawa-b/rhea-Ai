/* In-headset UI for mixed reality (spec §3.4, §11.1, §12.1).
 *
 * Passthrough-first: nothing here has an opaque backdrop. The live chart is a
 * transparent texture floating at eye level in front of the user; the price
 * header hovers above it and the assistant's action buttons float in a row
 * beneath it. Confirmations (trade / conditional order) use a light frosted
 * card so the numbers stay legible over a camera feed. Everything is troika
 * text + meshes; buttons are meshes with pointer events (controller rays and
 * hand pinch both work through @react-three/xr). */
import { Text } from "@react-three/drei";
import { useFrame, type ThreeEvent } from "@react-three/fiber";
import { useXR, useXRInputSourceState } from "@react-three/xr";
import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import * as THREE from "three";
import { COMPANY_BY_ID, COUNTRIES } from "@shared/registry";
import type { ChartRange } from "@shared/types";
import { useAuth } from "@/auth/Auth";
import { signInUrl } from "@/auth/signinTab";
import { useVoice } from "@/ai/voice";
import { useMarket } from "@/state/market";
import { useWorld } from "@/state/world";
import { confirmTrade, confirmTrigger, describeIntent, describeRule, isGated, prepareTrade, prepareTrigger } from "@/solana/trade";
import { recenterXR, xrGlobe } from "./CameraRig";
import { C, fmtPct, fmtUsd } from "@/theme";
import { drawChart } from "@/ui/chartDraw";

/* Chart cluster: eye level, right of the globe, turned slightly toward the user. */
const CLUSTER_POS: [number, number, number] = [0.6, 1.5, -1.3];
const CLUSTER_ROT: [number, number, number] = [0, -0.34, 0];
/* Captions + voice orb hang just under the globe and follow it as it grows,
 * shrinks and moves (see xrGlobe in CameraRig). */
const CAPTION_GAP = 0.09;
const RANGES: ChartRange[] = ["1D", "5D", "1M", "1Y"];

const OUTLINE = { outlineWidth: 0.0035, outlineColor: "#05060d", outlineOpacity: 0.9 } as const;

/** Pill button: thin luminous border, faint fill, haloed label. */
function Pill({ position, label, accent = C.cyan, w = 0.2, onClick, onHoldStart, onHoldEnd, disabled, active }: { position: [number, number, number]; label: string; accent?: string; w?: number; onClick?: () => void; /** press-and-hold (pinch or trigger held) */ onHoldStart?: () => void; onHoldEnd?: () => void; disabled?: boolean; active?: boolean }) {
  const [hover, setHover] = useState(false);
  const stop = (e: ThreeEvent<PointerEvent | MouseEvent>) => e.stopPropagation();
  const edges = useMemo(() => new THREE.EdgesGeometry(new THREE.PlaneGeometry(w, 0.066)), [w]);
  return (
    <group position={position}>
      <mesh
        onClick={(e) => { stop(e); if (!disabled) onClick?.(); }}
        onPointerDown={onHoldStart ? (e) => { stop(e); if (!disabled) onHoldStart(); } : undefined}
        onPointerUp={onHoldEnd ? (e) => { stop(e); onHoldEnd(); } : undefined}
        onPointerOver={(e) => { stop(e); setHover(true); }}
        onPointerOut={() => { setHover(false); onHoldEnd?.(); }}>
        <planeGeometry args={[w, 0.066]} />
        <meshBasicMaterial color={active ? accent : "#0b0f1c"} transparent opacity={disabled ? 0.25 : active ? 0.55 : hover ? 0.75 : 0.55} toneMapped={false} depthWrite={false} />
      </mesh>
      <lineSegments geometry={edges} position={[0, 0, 0.001]}>
        <lineBasicMaterial color={accent} transparent opacity={disabled ? 0.3 : 1} toneMapped={false} />
      </lineSegments>
      <Text position={[0, 0, 0.002]} fontSize={0.024} color={disabled ? "#7f93ab" : "#ffffff"} anchorX="center" anchorY="middle" letterSpacing={0.1} {...OUTLINE}>
        {label.toUpperCase()}
      </Text>
    </group>
  );
}

function Label({ position, text, size = 0.024, color = "#e8f4ff", anchorX = "left" as const, maxWidth }: { position: [number, number, number]; text: string; size?: number; color?: string; anchorX?: "left" | "center" | "right"; maxWidth?: number }) {
  return <Text position={position} fontSize={size} color={color} anchorX={anchorX} anchorY="middle" maxWidth={maxWidth} {...OUTLINE}>{text}</Text>;
}

/* Chart on a transparent plane, redrawn into a CanvasTexture at ~2 fps. */
function ChartPlane({ companyId, w, h }: { companyId: string; w: number; h: number }) {
  const co = COMPANY_BY_ID[companyId];
  const canvas = useMemo(() => { const c = document.createElement("canvas"); c.width = 1200; c.height = 560; return c; }, []);
  const texture = useMemo(() => { const t = new THREE.CanvasTexture(canvas); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t; }, [canvas]);
  const last = useRef(0);
  const range = useWorld((s) => s.chartRange);
  const loadHistory = useMarket((s) => s.loadHistory);
  useEffect(() => { void loadHistory(companyId, range); }, [companyId, range, loadHistory]);
  useEffect(() => () => texture.dispose(), [texture]);
  useFrame((s) => {
    if (s.clock.elapsedTime - last.current < 0.5) return;
    last.current = s.clock.elapsedTime;
    const w0 = useWorld.getState(); const m = useMarket.getState();
    const hist = m.histories[`${companyId}:${w0.chartRange}`];
    const d = m.details[companyId];
    const ctx = canvas.getContext("2d")!;
    drawChart(ctx, {
      candles: hist?.candles ?? [], range: w0.chartRange, mode: w0.chartMode,
      currentPrice: d?.price.underlyingPriceUsd ?? d?.price.tokenPriceUsd ?? null,
      marketOpen: d?.price.marketSession === "regular",
      events: w0.chartEvents.filter((e) => e.companyId === companyId), focusTs: w0.chartFocusTs,
      width: 600, height: 280, dpr: 2, ticker: co.ticker, ar: true,
      source: hist ? (hist.source === "pyth" ? "Pyth Pro" : "Yahoo (fallback)") : "—",
    });
    texture.needsUpdate = true;
  });
  return (
    <mesh>
      <planeGeometry args={[w, h]} />
      <meshBasicMaterial map={texture} transparent depthWrite={false} toneMapped={false} />
    </mesh>
  );
}

/** The floating company cluster: header · chart · stats · buttons beneath. */
function CompanyHolo({ companyId }: { companyId: string }) {
  const co = COMPANY_BY_ID[companyId];
  const auth = useAuth();
  const detail = useMarket((s) => s.details[companyId]);
  const loadDetail = useMarket((s) => s.loadDetail);
  const portfolio = useMarket((s) => s.portfolio);
  const orders = useMarket((s) => s.orders);
  const setError = useMarket((s) => s.setError);
  const impact = useWorld((s) => s.impact);
  const news = useWorld((s) => s.news);
  const range = useWorld((s) => s.chartRange);
  const setChartRange = useWorld((s) => s.setChartRange);
  const voiceState = useVoice((s) => s.state);
  const holding = useVoice((s) => s.holding);
  const setHold = useVoice((s) => s.setHold);
  useEffect(() => { void loadDetail(companyId, true); const h = setInterval(() => void loadDetail(companyId, true), 10_000); return () => clearInterval(h); }, [companyId, loadDetail]);

  const p = detail?.price;
  const pos = portfolio?.positions.find((x) => x.companyId === companyId);
  const active = orders.filter((o) => o.companyId === companyId && o.status === "active");
  const ch = p?.change24hPct ?? null;
  /* Signed-out users may still press Buy: prepareTrade opens the sign-in card. */
  const canTrade = detail?.asset?.tradable ?? false;
  /* Company headlines, else the country briefing that led here. */
  const own = (news?.items ?? []).filter((n) => n.companyIds.includes(companyId));
  const items = (own.length ? own : (news?.items ?? []).filter((n) => n.countryCodes.includes(co.countryCode))).slice(0, 2);
  const W = 1.04, H = 0.5;
  const triggerPrice = p?.tokenPriceUsd ? Math.round(p.tokenPriceUsd * 0.9) : 0;

  return (
    <group>
      {/* Header above the chart */}
      <Label position={[-W / 2, 0.42, 0]} text={co.name.toUpperCase()} size={0.056} color="#ffffff" />
      <Label position={[-W / 2, 0.36, 0]} text={`${co.ticker} · ${co.tokenSymbol} · ${co.sector} · ${COUNTRIES[co.countryCode].name}`} size={0.021} color="#b8c7da" />
      <Label position={[W / 2, 0.42, 0]} text={fmtUsd(p?.underlyingPriceUsd)} size={0.062} color="#ffffff" anchorX="right" />
      <Label position={[W / 2, 0.36, 0]} text={`token ${fmtUsd(p?.tokenPriceUsd)}  ${fmtPct(ch)}`} size={0.024} color={ch == null ? "#b8c7da" : ch >= 0 ? C.solGreen : C.magenta} anchorX="right" />

      {/* The chart itself — transparent, no backdrop */}
      <group position={[0, 0.06, 0]}><ChartPlane companyId={companyId} w={W} h={H} /></group>

      {/* Stats line under the chart */}
      <Label position={[-W / 2, -0.23, 0]} text={pos ? `Position ${pos.amountUi.toFixed(4)} ${pos.symbol} · ${fmtUsd(pos.valueUsd)}` : auth.authenticated ? "No position" : "Not signed in · Buy opens sign-in"} size={0.02} color="#dfe9f5" />
      {active[0] ? <Label position={[-W / 2, -0.265, 0]} text={`◉ AGENT WATCHING · ${describeRule(active[0])}`} size={0.02} color={C.gold} /> : null}
      {impact && impact.companyId === companyId ? (
        <Label position={[-W / 2, -0.302, 0]} text={`${impact.impact.replace("_", " ").toUpperCase()} · ${(impact.confidence * 100).toFixed(0)}% · ${impact.event}`} size={0.019} color={impact.impact === "potentially_negative" ? C.magenta : impact.impact === "potentially_positive" ? C.solGreen : C.amber} maxWidth={W} />
      ) : null}
      {items.map((n, i) => <Label key={n.id} position={[-W / 2, -0.34 - i * 0.034, 0]} text={`▸ ${n.title} — ${n.source}`} size={0.018} color="#c7d7ea" maxWidth={W} />)}

      {/* Assistant buttons floating beneath */}
      <group position={[0, -0.46, 0.01]}>
        <Pill position={[-0.36, 0, 0]} w={0.2} label={holding ? "● Listening" : voiceState === "connecting" ? "Connecting" : "Hold · Talk"} accent={holding ? C.violet : C.sol} active={holding} onHoldStart={() => setHold(true, auth)} onHoldEnd={() => setHold(false)} />
        <Pill position={[-0.135, 0, 0]} w={0.2} label="Buy $100" accent={C.solGreen} disabled={!canTrade} onClick={() => void prepareTrade(auth, companyId, "buy", 100).then((r) => { if (!r.ok && !isGated(r)) setError(r.error); })} />
        <Pill position={[0.09, 0, 0]} w={0.2} label="Sell all" accent={C.magenta} disabled={!canTrade || !pos} onClick={() => pos && void prepareTrade(auth, companyId, "sell", pos.amountUi).then((r) => { if (!r.ok && !isGated(r)) setError(r.error); })} />
        <Pill position={[0.315, 0, 0]} w={0.2} label={triggerPrice ? `Buy ≤ $${triggerPrice}` : "Trigger"} accent={C.amber} disabled={!canTrade || !triggerPrice} onClick={() => void prepareTrigger(auth, companyId, "buy_below", triggerPrice, 100).then((r) => { if (!r.ok) setError(r.error); })} />
      </group>
      <group position={[0, -0.545, 0.01]}>
        {RANGES.map((r, i) => <Pill key={r} position={[-0.33 + i * 0.13, 0, 0]} w={0.11} label={r} accent={C.frost} active={r === range} onClick={() => setChartRange(r)} />)}
        <Pill position={[0.27, 0, 0]} w={0.18} label="◂ World" accent={C.frost} onClick={() => useWorld.getState().resetGlobe(false)} />
      </group>
    </group>
  );
}

/** Frosted card for confirmations (kept translucent, not opaque). */
function Card({ w, h, accent }: { w: number; h: number; accent: string }) {
  const edges = useMemo(() => new THREE.EdgesGeometry(new THREE.PlaneGeometry(w, h)), [w, h]);
  return (
    <group>
      <mesh position={[0, 0, -0.002]}><planeGeometry args={[w, h]} /><meshBasicMaterial color="#0b0f1c" transparent opacity={0.72} toneMapped={false} depthWrite={false} /></mesh>
      <lineSegments geometry={edges} position={[0, 0, -0.001]}><lineBasicMaterial color={accent} transparent opacity={0.9} toneMapped={false} /></lineSegments>
      <mesh position={[0, h / 2 - 0.001, 0]}><planeGeometry args={[w * 0.6, 0.0025]} /><meshBasicMaterial color={accent} toneMapped={false} /></mesh>
    </group>
  );
}

function Row({ y, label, value, color = "#ffffff", w = 0.76 }: { y: number; label: string; value: string; color?: string; w?: number }) {
  return (
    <group>
      <Label position={[-w / 2, y, 0.001]} text={label} size={0.022} color="#b8c7da" />
      <Label position={[w / 2, y, 0.001]} text={value} size={0.023} color={color} anchorX="right" />
    </group>
  );
}

function TradeHolo() {
  const auth = useAuth();
  const pending = useMarket((s) => s.pendingTrade);
  const setPending = useMarket((s) => s.setPendingTrade);
  const announce = useVoice((s) => s.announce);
  const [err, setErr] = useState<string | null>(null);
  if (!pending?.quote) return null;
  const q = pending.quote; const co = COMPANY_BY_ID[pending.companyId];
  const accent = pending.status === "confirmed" ? C.solGreen : pending.status === "failed" ? C.magenta : C.sol;
  return (
    <group>
      <Card w={0.84} h={0.66} accent={accent} />
      <Label position={[-0.38, 0.28, 0.001]} text={`${pending.side.toUpperCase()} ${co.tokenSymbol}`} size={0.042} color="#ffffff" />
      <Label position={[-0.38, 0.235, 0.001]} text={`${co.name} · Jupiter · Solana · ${pending.status.replace("_", " ")}`} size={0.02} color="#b8c7da" />
      <Row y={0.16} label={pending.side === "buy" ? "Spend" : "Sell"} value={`${q.inAmountUi} ${q.inSymbol}`} />
      <Row y={0.11} label={`Estimated ${q.outSymbol}`} value={q.outAmountUi.toFixed(4)} />
      <Row y={0.06} label="Route" value={q.route} />
      <Row y={0.01} label="Price impact" value={`${q.priceImpactPct.toFixed(3)}%`} color={q.priceImpactPct > 1 ? C.amber : "#ffffff"} />
      <Row y={-0.04} label="Network fee" value={`~${(q.feeLamports / 1e9).toFixed(5)} SOL`} />
      {pending.signature ? <Row y={-0.09} label="Signature" value={`${pending.signature.slice(0, 10)}…`} color={C.solGreen} /> : null}
      {err || pending.error ? <Label position={[-0.38, -0.14, 0.001]} text={err ?? pending.error ?? ""} size={0.018} color={C.magenta} maxWidth={0.76} /> : null}
      <Pill position={[-0.19, -0.24, 0.002]} w={0.24} label={pending.status === "confirmed" || pending.status === "failed" ? "Close" : "Cancel"} accent={C.frost} onClick={() => setPending(null)} />
      {pending.status === "awaiting_confirmation" || pending.status === "failed" ? (
        <Pill position={[0.19, -0.24, 0.002]} w={0.24} label="Confirm" accent={C.solGreen} onClick={() => { setErr(null); void confirmTrade(auth, pending).then((d) => announce(`Filled: ${d.quote!.outAmountUi.toFixed(4)} ${d.quote!.outSymbol}. Tell the user briefly.`)).catch((e: Error) => setErr(e.message)); }} />
      ) : null}
    </group>
  );
}

function OrderHolo() {
  const auth = useAuth();
  const pending = useMarket((s) => s.pendingOrder);
  const setPending = useMarket((s) => s.setPendingOrder);
  const upsertOrder = useMarket((s) => s.upsertOrder);
  const removeOrder = useMarket((s) => s.removeOrder);
  const announce = useVoice((s) => s.announce);
  const [err, setErr] = useState<string | null>(null);
  if (!pending) return null;
  const co = COMPANY_BY_ID[pending.companyId];
  const isCancel = pending.status === "cancelled";
  return (
    <group>
      <Card w={0.84} h={0.56} accent={C.amber} />
      <Label position={[-0.38, 0.23, 0.001]} text={isCancel ? "CANCEL ORDER" : `${co.tokenSymbol} · CONDITIONAL ORDER`} size={0.038} color="#ffffff" />
      <Label position={[-0.38, 0.185, 0.001]} text={`${co.name} · Jupiter Trigger V2 · ${pending.status}`} size={0.02} color="#b8c7da" />
      <Row y={0.11} label="Action" value={`${pending.action.side.toUpperCase()} ${pending.action.side === "buy" ? fmtUsd(pending.action.amount) : pending.action.amount + " " + pending.action.currency}`} />
      <Row y={0.06} label="Trigger" value={`${co.tokenSymbol} ${pending.condition.kind === "price_below" ? "≤" : "≥"} ${fmtUsd(pending.condition.priceUsd)}`} color={C.amber} />
      <Row y={0.01} label="Execution" value={pending.simulated ? "simulated (no key)" : "Jupiter keeper · vault"} />
      {err ? <Label position={[-0.38, -0.06, 0.001]} text={err} size={0.018} color={C.magenta} maxWidth={0.76} /> : null}
      <Pill position={[-0.19, -0.19, 0.002]} w={0.24} label={pending.status === "active" ? "Close" : "Cancel"} accent={C.frost} onClick={() => setPending(null)} />
      {pending.status === "pending" || isCancel ? (
        <Pill position={[0.19, -0.19, 0.002]} w={0.24} label={isCancel ? "Cancel order" : "Confirm"} accent={isCancel ? C.magenta : C.amber} onClick={() => {
          setErr(null);
          if (isCancel) { removeOrder(pending.id); setPending(null); announce(`Order on ${co.name} cancelled.`); return; }
          void confirmTrigger(auth, pending).then((a) => { upsertOrder(a); announce(`Agent watching ${co.name}: ${describeRule(a)}.`); }).catch((e: Error) => setErr(e.message));
        }} />
      ) : null}
    </group>
  );
}

function CountryHolo({ code }: { code: keyof typeof COUNTRIES }) {
  const cd = COUNTRIES[code];
  const overview = useMarket((s) => s.overview);
  const prices = useMarket((s) => s.prices);
  const cs = overview?.countries.find((c) => c.code === code);
  const ids = (cs?.companies ?? []).filter((id) => (prices[id]?.tokenPriceUsd ?? 0) > 0).slice(0, 8);
  const news = useWorld((s) => s.news);
  const headlines = news && (news.target === cd.name || news.items.some((n) => n.countryCodes.includes(code))) ? news.items.slice(0, 3) : [];
  const top = 0.05 + ids.length * 0.025 + headlines.length * 0.024;
  const listEnd = top - 0.03 - ids.length * 0.052;
  return (
    <group>
      <Label position={[-0.4, top + 0.09, 0]} text={cd.name.toUpperCase()} size={0.046} color="#ffffff" />
      <Label position={[-0.4, top + 0.04, 0]} text={`${cs?.assetCount ?? 0} tokenized assets · ${cs?.tradableCount ?? 0} live · say a company name or point at it`} size={0.02} color="#b8c7da" />
      {ids.map((id, i) => {
        const co = COMPANY_BY_ID[id]; const p = prices[id]; const ch = p?.change24hPct ?? null;
        return (
          <group key={id} position={[0, top - 0.03 - i * 0.052, 0.002]}>
            <mesh onClick={(e) => { e.stopPropagation(); useWorld.getState().focusCompany(id); }}><planeGeometry args={[0.8, 0.046]} /><meshBasicMaterial color="#0b0f1c" transparent opacity={0.5} toneMapped={false} depthWrite={false} /></mesh>
            <Label position={[-0.38, 0, 0.001]} text={`${co.name}  ${co.ticker}`} size={0.022} color="#ffffff" />
            <Label position={[0.38, 0, 0.001]} text={`${fmtUsd(p?.tokenPriceUsd)}  ${fmtPct(ch)}`} size={0.022} color={ch == null ? "#ffffff" : ch >= 0 ? C.solGreen : C.magenta} anchorX="right" />
          </group>
        );
      })}
      {headlines.length ? <Label position={[-0.4, listEnd - 0.01, 0]} text={`NEWS · ${cd.name.toUpperCase()}`} size={0.017} color={C.frost} /> : null}
      {headlines.map((n, i) => <Label key={n.id} position={[-0.4, listEnd - 0.05 - i * 0.042, 0]} text={`▸ ${n.title} — ${n.source}`} size={0.018} color="#c7d7ea" maxWidth={0.8} />)}
      <Pill position={[0, listEnd - (headlines.length ? 0.09 + headlines.length * 0.042 : 0.03), 0.01]} w={0.22} label="◂ World" accent={C.frost} onClick={() => useWorld.getState().resetGlobe(false)} />
    </group>
  );
}

/* ---------------- Sign-in / funding gates (in-headset) ----------------
 * Privy's login is a DOM modal, which an immersive session hides, so the
 * sign-in card ends the session first: the user signs in on the flat page and
 * re-enters Mixed Reality signed in (the login persists in the browser). */

function LoginHolo() {
  const auth = useAuth();
  const session = useXR((s) => s.session);
  const prompt = useMarket((s) => s.loginPrompt);
  const setPrompt = useMarket((s) => s.setLoginPrompt);
  if (!prompt) return null;
  return (
    <group>
      <Card w={0.84} h={0.5} accent={C.cyan} />
      <Label position={[-0.38, 0.19, 0.001]} text="SIGN IN TO TRADE" size={0.04} color="#ffffff" />
      <Label position={[-0.38, 0.145, 0.001]} text={prompt.reason} size={0.02} color="#b8c7da" maxWidth={0.76} />
      <Label position={[-0.38, 0.07, 0.001]} text="Google, email or a Solana wallet — new accounts get an embedded Solana wallet in seconds." size={0.02} color="#dfe9f5" maxWidth={0.76} />
      <Label position={[-0.38, -0.01, 0.001]} text={`Sign in opens a new browser tab: sign in there, come back to this tab, then press Enter Mixed Reality again.${prompt.resume ? ` Your request to ${describeIntent(prompt.resume)} continues automatically.` : ""}`} size={0.019} color="#b8c7da" maxWidth={0.76} />
      <Pill position={[-0.19, -0.17, 0.002]} w={0.24} label="Later" accent={C.frost} onClick={() => setPrompt(null)} />
      <Pill position={[0.19, -0.17, 0.002]} w={0.24} label="Sign in ↗" accent={C.cyan} onClick={() => {
        /* Try the tab straight from the press; if the browser blocks it outside
         * a DOM gesture, the flat page's sign-in panel (shown once the session
         * ends) has a button that opens it. */
        const tab = auth.mode === "privy" ? window.open(signInUrl(), "rhea-signin") : null;
        void session?.end().catch(() => undefined);
        if (tab) tab.focus?.();
      }} />
    </group>
  );
}

function DepositHolo() {
  const auth = useAuth();
  const prompt = useMarket((s) => s.depositPrompt);
  const setPrompt = useMarket((s) => s.setDepositPrompt);
  const portfolio = useMarket((s) => s.portfolio);
  const loadPortfolio = useMarket((s) => s.loadPortfolio);
  if (!prompt) return null;
  const have = portfolio?.usdcBalance ?? prompt.haveUsd;
  const addr = auth.address ?? "—";
  return (
    <group>
      <Card w={0.84} h={0.56} accent={C.solGreen} />
      <Label position={[-0.38, 0.22, 0.001]} text="FUND YOUR WALLET" size={0.04} color="#ffffff" />
      <Label position={[-0.38, 0.175, 0.001]} text={`USDC on Solana · ${fmtUsd(Math.max(0, prompt.neededUsd - have))} more needed`} size={0.02} color="#b8c7da" />
      <Row y={0.11} label="Wallet USDC" value={fmtUsd(have)} />
      <Row y={0.065} label="This trade needs" value={fmtUsd(prompt.neededUsd)} />
      <Label position={[-0.38, 0.005, 0.001]} text="SEND USDC (SOLANA) TO" size={0.017} color="#b8c7da" />
      <Label position={[-0.38, -0.03, 0.001]} text={addr.slice(0, 22)} size={0.024} color={C.solGreen} />
      <Label position={[-0.38, -0.062, 0.001]} text={addr.slice(22)} size={0.024} color={C.solGreen} />
      <Label position={[-0.38, -0.115, 0.001]} text={`Solana network only; keep ~0.01 SOL for fees. Copy the address from the desktop panel.${prompt.resume ? " The trade continues when the USDC lands." : ""}`} size={0.018} color="#b8c7da" maxWidth={0.76} />
      <Pill position={[-0.19, -0.2, 0.002]} w={0.24} label="Later" accent={C.frost} onClick={() => setPrompt(null)} />
      <Pill position={[0.19, -0.2, 0.002]} w={0.24} label="I've sent it" accent={C.solGreen} onClick={() => void loadPortfolio()} />
    </group>
  );
}

/** Follows the globe: just under it, in front of its lower half. */
function useUnderGlobe(ref: RefObject<THREE.Group | null>, dy = 0) {
  useFrame(() => {
    const g = ref.current;
    if (!g) return;
    const { pos, scale } = xrGlobe;
    g.position.set(pos.x + 0.12, pos.y - scale - CAPTION_GAP + dy, pos.z + scale * 0.55);
  });
}

/** Floating captions + status under the globe. */
function Captions() {
  const captions = useVoice((s) => s.captions);
  const state = useVoice((s) => s.state);
  const holding = useVoice((s) => s.holding);
  const ref = useRef<THREE.Group>(null);
  useUnderGlobe(ref);
  const last = captions.slice(-2);
  const status = holding ? "LISTENING · RELEASE WHEN DONE"
    : state === "connecting" ? "CONNECTING…"
    : state === "speaking" ? "SPEAKING · HOLD  A  TO INTERRUPT"
    : state === "thinking" ? "THINKING…"
    : "HOLD  A  TO SPEAK";
  return (
    <group ref={ref}>
      {last.map((c, i) => (
        <Text key={c.id} position={[0, (last.length - 1 - i) * 0.085, 0]} fontSize={0.026} color={c.role === "user" ? "#e6dcff" : "#e8f4ff"} anchorX="center" anchorY="middle" maxWidth={1.1} textAlign="center" {...OUTLINE}>
          {`${c.role === "user" ? "You: " : "Rhea: "}${c.text.slice(-200)}`}
        </Text>
      ))}
      <Text position={[0, -0.085, 0]} fontSize={0.017} color={holding ? C.violet : state === "speaking" ? C.solGreen : state === "thinking" ? C.amber : "#b8c7da"} anchorX="center" anchorY="middle" letterSpacing={0.2} {...OUTLINE}>
        {status}
      </Text>
    </group>
  );
}

/** Voice orb under the captions: pinch-and-hold to talk. */
function VoiceOrb() {
  const state = useVoice((s) => s.state);
  const holding = useVoice((s) => s.holding);
  const setHold = useVoice((s) => s.setHold);
  const auth = useAuth();
  const ref = useRef<THREE.Mesh>(null);
  const anchor = useRef<THREE.Group>(null);
  useUnderGlobe(anchor, -0.16);
  useFrame((s) => {
    if (!ref.current) return;
    const t = s.clock.elapsedTime;
    const k = state === "speaking" ? 1 + Math.sin(t * 12) * 0.12 : holding ? 1.15 : 1 + Math.sin(t * 2) * 0.04;
    ref.current.scale.setScalar(k);
    (ref.current.material as THREE.MeshStandardMaterial).emissiveIntensity = state === "speaking" ? 2.2 : state === "thinking" ? 1.4 : holding ? 2 : 0.6;
  });
  const color = holding ? C.violet : state === "thinking" ? C.amber : state === "error" ? C.red : state === "off" ? C.steel : C.sol;
  /* The mic is hot only while the talk button is held on a live session. */
  const micHot = holding && state !== "off" && state !== "error" && state !== "connecting";
  return (
    <group ref={anchor}>
      <mesh ref={ref} onPointerDown={(e) => { e.stopPropagation(); setHold(true, auth); }} onPointerUp={(e) => { e.stopPropagation(); setHold(false); }} onPointerOut={() => setHold(false)}>
        <sphereGeometry args={[0.04, 24, 18]} />
        <meshStandardMaterial color={new THREE.Color(color).multiplyScalar(0.3)} emissive={color} emissiveIntensity={1} roughness={0.3} />
        <MicGlyph hot={micHot} />
      </mesh>
    </group>
  );
}

const NO_RAYCAST = () => null;

/** Mic symbol drawn on the front of the voice orb: red while the mic is open, grey when closed. */
function MicGlyph({ hot }: { hot: boolean }) {
  const color = hot ? "#ff3b4e" : "#8a94a3";
  const mat = <meshBasicMaterial color={color} toneMapped={false} depthTest={false} transparent />;
  const halo = useRef<THREE.Mesh>(null);
  useFrame((s) => {
    if (!halo.current) return;
    const m = halo.current.material as THREE.MeshBasicMaterial;
    m.opacity = hot ? 0.35 + Math.sin(s.clock.elapsedTime * 8) * 0.15 : 0;
  });
  return (
    <group position={[0, 0, 0.041]} renderOrder={10}>
      <mesh raycast={NO_RAYCAST} renderOrder={10}>
        <circleGeometry args={[0.028, 32]} />
        <meshBasicMaterial color="#05060d" transparent opacity={0.72} toneMapped={false} depthTest={false} />
      </mesh>
      <mesh ref={halo} raycast={NO_RAYCAST} renderOrder={11}>
        <ringGeometry args={[0.028, 0.033, 40]} />
        <meshBasicMaterial color="#ff3b4e" transparent opacity={0} toneMapped={false} depthTest={false} />
      </mesh>
      {/* capsule head */}
      <mesh raycast={NO_RAYCAST} renderOrder={12} position={[0, 0.006, 0.001]}>
        <capsuleGeometry args={[0.0065, 0.012, 6, 16]} />
        {mat}
      </mesh>
      {/* cradle */}
      <mesh raycast={NO_RAYCAST} renderOrder={12} position={[0, 0.004, 0.001]} rotation={[0, 0, Math.PI]}>
        <torusGeometry args={[0.0125, 0.0018, 8, 24, Math.PI]} />
        {mat}
      </mesh>
      {/* stem + base */}
      <mesh raycast={NO_RAYCAST} renderOrder={12} position={[0, -0.0125, 0.001]}>
        <boxGeometry args={[0.0028, 0.008, 0.001]} />
        {mat}
      </mesh>
      <mesh raycast={NO_RAYCAST} renderOrder={12} position={[0, -0.0168, 0.001]}>
        <boxGeometry args={[0.014, 0.0026, 0.001]} />
        {mat}
      </mesh>
    </group>
  );
}

/* Right controller: hold A to speak (the mic opens while held and Rhea is
 * ducked, so she can be interrupted); B returns to the world view. B is
 * edge-detected so a held button fires once. Reads the mapped "a-button"
 * component when the profile provides it, else the xr-standard index
 * (4 = A/X, 5 = B/Y). */
function XRButtons() {
  const right = useXRInputSourceState("controller", "right");
  const was = useRef<{ a: boolean; b: boolean }>({ a: false, b: false });
  const auth = useAuth();
  useFrame(() => {
    const gp = right?.gamepad;
    const buttons = right?.inputSource?.gamepad?.buttons;
    if (!gp && !buttons) return;
    const a = gp?.["a-button"] ? gp["a-button"].state === "pressed" : Boolean(buttons?.[4]?.pressed);
    const b = gp?.["b-button"] ? gp["b-button"].state === "pressed" : Boolean(buttons?.[5]?.pressed);
    if (a !== was.current.a) useVoice.getState().setHold(a, auth);
    /* B also re-seats the planet in front of wherever the user now is. */
    if (b && !was.current.b) { useWorld.getState().resetGlobe(false); recenterXR(); }
    was.current = { a, b };
  });
  return null;
}

/** Idle hint when nothing is focused: floats where the chart will appear. */
function IdleHint() {
  const overview = useMarket((s) => s.overview);
  return (
    <group>
      <Label position={[0, 0.06, 0]} text="RHEA" size={0.05} color="#ffffff" anchorX="center" />
      <Label position={[0, 0.005, 0]} text={overview ? `${overview.assets.length} tokenized stocks · ${overview.countries.length} countries · live on Solana` : "loading market…"} size={0.02} color="#b8c7da" anchorX="center" />
      <Label position={[0, -0.05, 0]} text={`Say "What's happening in China?" or point at a country`} size={0.022} color={C.frost} anchorX="center" />
    </group>
  );
}

export function XRPanels() {
  const mode = useXR((s) => s.mode);
  const focusedCompany = useWorld((s) => s.focusedCompany);
  const focusedCountry = useWorld((s) => s.focusedCountry);
  const pendingTrade = useMarket((s) => s.pendingTrade);
  const pendingOrder = useMarket((s) => s.pendingOrder);
  const loginPrompt = useMarket((s) => s.loginPrompt);
  const depositPrompt = useMarket((s) => s.depositPrompt);
  if (mode == null) return null;
  return (
    <group>
      <group position={CLUSTER_POS} rotation={CLUSTER_ROT}>
        {pendingTrade ? <TradeHolo /> : pendingOrder ? <OrderHolo /> : depositPrompt ? <DepositHolo /> : loginPrompt ? <LoginHolo /> : focusedCompany ? <CompanyHolo companyId={focusedCompany} /> : focusedCountry ? <CountryHolo code={focusedCountry} /> : <IdleHint />}
      </group>
      <Captions />
      <VoiceOrb />
      <XRButtons />
    </group>
  );
}
