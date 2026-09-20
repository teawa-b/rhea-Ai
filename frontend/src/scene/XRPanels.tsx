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
import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import * as THREE from "three";
import { COMPANY_BY_ID, COUNTRIES } from "@shared/registry";
import type { ChartRange } from "@shared/types";
import { useAuth } from "@/auth/Auth";
import { signInUrl } from "@/auth/signinTab";
import { useVoice } from "@/ai/voice";
import { sessionPill, startSessionPolling, useMarket } from "@/state/market";
import { useWorld } from "@/state/world";
import { cancelAnnouncement, cancelTrigger, confirmTrade, confirmTrigger, describeIntent, describeRule, feeSummary, isGated, orderStatusLabel, prepareTrade, prepareTrigger, tradeConfirmedAnnouncement } from "@/solana/trade";
import { recenterXR, xrGlobe } from "./CameraRig";
import { useHandheld } from "./handheld";
import { FONT_BODY, FONT_BOLD, FONT_NUM, latinText } from "./fonts";
import { GlassRect, UNIT_PLANE, type GlassMaterial } from "./glass";
import { Icon, type IconName } from "./icons";
import { buzz, cue, feel } from "./xrFeedback";
import { C, fmtEt, fmtPct, fmtSeconds, fmtUsd, shortSig } from "@/theme";
import { drawChart } from "@/ui/chartDraw";

/* Chart cluster: eye level, right of the globe, turned slightly toward the user. */
const CLUSTER_POS: [number, number, number] = [0.6, 1.5, -1.3];
const CLUSTER_ROT: [number, number, number] = [0, -0.34, 0];
/* Captions float just above the globe and the voice orb hangs just under it;
 * both follow it as it grows, shrinks and moves (see xrGlobe in CameraRig). */
const CAPTION_GAP = 0.09;
const RANGES: ChartRange[] = ["1D", "5D", "1M", "1Y"];

const OUTLINE = { outlineWidth: 0.0035, outlineColor: "#05060d", outlineOpacity: 0.9 } as const;

/* ---------------- Buttons ---------------- */

const PILL_H = 0.066;
const PANEL_DARK = new THREE.Color("#0b0f1c");

/** Shared hover/press spring: eases scale, lift and a 0..1 glow level toward
 * their targets; `apply` writes the level into the panel shader each frame. */
function useButtonSpring(opts: { disabled?: boolean; active?: boolean }, apply: (m: GlassMaterial, level: number) => void) {
  const group = useRef<THREE.Group>(null);
  const mat = useRef<GlassMaterial>(null);
  const hover = useRef(false);
  const pressed = useRef(false);
  const g = useRef(0);
  useFrame((_, dt) => {
    const k = 1 - Math.exp(-Math.min(dt, 0.1) * 16);
    const hot = !opts.disabled && hover.current;
    const down = !opts.disabled && pressed.current;
    const s = down ? 0.95 : hot ? 1.06 : 1;
    const target = opts.disabled ? 0 : down ? 1 : opts.active ? 0.75 : hot ? 0.85 : 0.18;
    g.current += (target - g.current) * k;
    const grp = group.current;
    if (grp) {
      grp.scale.setScalar(grp.scale.x + (s - grp.scale.x) * k);
      grp.position.z += ((hot && !down ? 0.012 : 0) - grp.position.z) * k;
    }
    if (mat.current) apply(mat.current, g.current);
  });
  return { group, mat, hover, pressed };
}

/** Pill button: rounded, gradient-filled, luminous rim, glow that blooms on hover and press.
 * The whole look is one GlassRect draw (was five stacked meshes, glow and halo drawn even at opacity 0). */
function Pill({ position, label, icon, accent = C.cyan, w = 0.2, onClick, onHoldStart, onHoldEnd, disabled, active }: { position: [number, number, number]; label: string; icon?: IconName; accent?: string; w?: number; onClick?: () => void; /** press-and-hold (pinch or trigger held) */ onHoldStart?: () => void; onHoldEnd?: () => void; disabled?: boolean; active?: boolean }) {
  const stop = (e: ThreeEvent<PointerEvent | MouseEvent>) => e.stopPropagation();
  const spring = useButtonSpring({ disabled, active }, (m, g) => {
    m.uniforms.uGlow.value = g;
    m.uniforms.uFill.value = disabled ? 0.3 : 0.78 + g * 0.2;
  });
  const h = PILL_H, r = h / 2;
  const [top, bottom] = useMemo(() => {
    const acc = new THREE.Color(accent);
    return [PANEL_DARK.clone().lerp(acc, active ? 0.7 : 0.26), PANEL_DARK.clone().lerp(acc, active ? 0.38 : 0.04)];
  }, [accent, active]);
  const ink = disabled ? "#6f8196" : "#ffffff";
  return (
    <group position={position}>
      <group ref={spring.group}>
        <GlassRect ref={spring.mat} w={w} h={h} r={r} pad={0.03} top={top} bottom={bottom} accent={accent} stroke={0.0032}
          rim={disabled ? 0.28 : 1} sheen={disabled ? 0.05 : active ? 0.35 : 0.16} bar={0} topBar={0} />
        {/* Hit area is the pill itself, not its glow margin (neighbouring pills sit 2.5 cm apart). */}
        <mesh
          geometry={UNIT_PLANE}
          scale={[w, h, 1]}
          onClick={(e) => { stop(e); if (!disabled) onClick?.(); }}
          onPointerDown={(e) => { stop(e); spring.pressed.current = true; if (disabled) { feel.deny(e); return; } feel.press(e); onHoldStart?.(); }}
          onPointerUp={(e) => { stop(e); spring.pressed.current = false; onHoldEnd?.(); }}
          onPointerOver={(e) => { stop(e); spring.hover.current = true; if (!disabled) feel.hover(e); }}
          onPointerOut={() => { spring.hover.current = false; spring.pressed.current = false; onHoldEnd?.(); }}>
          <meshBasicMaterial visible={false} />
        </mesh>
        {icon ? <Icon name={icon} size={0.024} color={ink} position={[-w / 2 + r * 0.95, 0, 0.003]} /> : null}
        <Text font={FONT_BOLD} position={[icon ? r * 0.4 : 0, -0.001, 0.003]} fontSize={0.022} color={ink} anchorX="center" anchorY="middle" letterSpacing={0.09} raycast={NO_RAYCAST} {...OUTLINE}>
          {label.toUpperCase()}
        </Text>
      </group>
    </group>
  );
}

/** Tappable list row (country panel): rounded glass strip with an accent bar that lights on hover. */
function RowButton({ position, w, h, accent = C.cyan, onClick, children }: { position: [number, number, number]; w: number; h: number; accent?: string; onClick: () => void; children: ReactNode }) {
  const spring = useButtonSpring({}, (m, g) => {
    m.uniforms.uFill.value = 0.78 + g * 0.2;
    m.uniforms.uRim.value = g * 0.32;
    m.uniforms.uBar.value = 0.25 + g * 0.74;
  });
  const top = useMemo(() => PANEL_DARK.clone().lerp(new THREE.Color(accent), 0.12), [accent]);
  return (
    <group position={position}>
      <group ref={spring.group}>
        <GlassRect ref={spring.mat} w={w} h={h} r={0.012} top={top} bottom={PANEL_DARK} accent={accent} stroke={0.0022} barGeo={[0.012, 0.0025, h * 0.3]} glow={0} sheen={0} topBar={0} />
        <mesh
          geometry={UNIT_PLANE}
          scale={[w, h, 1]}
          onClick={(e) => { e.stopPropagation(); onClick(); }}
          onPointerDown={(e) => { e.stopPropagation(); spring.pressed.current = true; feel.press(e); }}
          onPointerUp={() => { spring.pressed.current = false; }}
          onPointerOver={(e) => { e.stopPropagation(); spring.hover.current = true; feel.hover(e); }}
          onPointerOut={() => { spring.hover.current = false; spring.pressed.current = false; }}>
          <meshBasicMaterial visible={false} />
        </mesh>
        {children}
      </group>
    </group>
  );
}

/** One-line headlines: clipped rather than wrapped, so rows never overlap. */
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** Scene text. Big sizes use the bold face, `mono` gives prices tabular digits; an `icon` sits before left-anchored text.
 * Body sizes stay at or above ~0.021 m: at the cluster's ~1.4 m that is under a degree tall, the least that holds up over passthrough. */
function Label({ position, text, size = 0.024, color = "#e8f4ff", anchorX = "left" as const, maxWidth, mono, icon }: { position: [number, number, number]; text: string; size?: number; color?: string; anchorX?: "left" | "center" | "right"; maxWidth?: number; mono?: boolean; icon?: IconName }) {
  const [x, y, z] = position;
  const shift = icon ? size * 1.05 : 0;
  return (
    <>
      {icon ? <Icon name={icon} size={size * 0.9} color={color} position={[x + size * 0.45, y, z]} /> : null}
      <Text font={mono ? FONT_NUM : size >= 0.036 ? FONT_BOLD : FONT_BODY} position={[x + shift, y, z]} fontSize={size} color={color} anchorX={anchorX} anchorY="middle" maxWidth={maxWidth == null ? undefined : maxWidth - shift} {...OUTLINE}>{latinText(text)}</Text>
    </>
  );
}

/* Chart on a transparent plane, drawn into a CanvasTexture. Inputs are checked
 * at ~2 fps but the canvas is only redrawn and re-uploaded when one changed: a
 * 1200×560 upload every 0.5 s was a periodic hitch in the headset. */
function ChartPlane({ companyId, w, h }: { companyId: string; w: number; h: number }) {
  const co = COMPANY_BY_ID[companyId];
  const canvas = useMemo(() => { const c = document.createElement("canvas"); c.width = 1200; c.height = 560; return c; }, []);
  const texture = useMemo(() => { const t = new THREE.CanvasTexture(canvas); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t; }, [canvas]);
  const last = useRef({ t: 0, key: "" });
  const range = useWorld((s) => s.chartRange);
  const loadHistory = useMarket((s) => s.loadHistory);
  useEffect(() => { void loadHistory(companyId, range); }, [companyId, range, loadHistory]);
  useEffect(() => () => texture.dispose(), [texture]);
  useFrame((s) => {
    if (s.clock.elapsedTime - last.current.t < 0.5) return;
    last.current.t = s.clock.elapsedTime;
    const w0 = useWorld.getState(); const m = useMarket.getState();
    const hist = m.histories[`${companyId}:${w0.chartRange}`];
    const d = m.details[companyId];
    const end = hist?.candles[hist.candles.length - 1];
    const key = [hist?.source, hist?.candles.length, end?.t, end?.c, w0.chartRange, w0.chartMode, w0.chartFocusTs, d?.price.underlyingPriceUsd, d?.price.tokenPriceUsd, d?.price.marketSession,
      w0.chartEvents.filter((e) => e.companyId === companyId).map((e) => `${e.timestamp}:${e.title}`).join("|")].join(";");
    if (key === last.current.key) return;
    last.current.key = key;
    const ctx = canvas.getContext("2d")!;
    drawChart(ctx, {
      candles: hist?.candles ?? [], range: w0.chartRange, mode: w0.chartMode,
      currentPrice: d?.price.underlyingPriceUsd ?? d?.price.tokenPriceUsd ?? null,
      marketOpen: d?.price.marketSession === "regular",
      events: w0.chartEvents.filter((e) => e.companyId === companyId), focusTs: w0.chartFocusTs,
      width: 600, height: 280, dpr: 2, ticker: co.ticker, ar: true,
      source: hist ? (hist.source === "pyth" ? "Pyth" : "Nasdaq regular session · Yahoo") : "—",
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

  /* A private company has no exchange series, so there is nothing to plot. The
   * plane used to mount anyway and left a hole in the middle of the cluster,
   * with range pills under it that changed nothing. Skip both and lift
   * everything below the chart into the space it would have taken. */
  const isPrivate = Boolean(co.private) || p?.underlyingSource === "issuer-mark";
  const lift = isPrivate ? 0.42 : 0;
  const premium = p?.premiumToMarkPct ?? null;

  return (
    <group>
      {/* The glass card shrinks with the cluster: without a chart there is
          0.42 less to back, and its centre rises by half that. */}
      <Card w={W + 0.12} h={1.1 - lift} y={-0.06 + lift / 2} accent={C.cyan} fill={0.5} />
      {/* Header. The onchain price leads, as it does in the DOM panel: it is
          what a buy actually costs. The reference sits under it. */}
      <Label position={[-W / 2, 0.42, 0]} text={co.name.toUpperCase()} size={0.056} color="#ffffff" />
      <Label position={[-W / 2, 0.36, 0]} text={`${co.ticker} · ${co.sector}`} size={0.022} color="#b8c7da" />
      <Label position={[W / 2, 0.42, 0]} text={fmtUsd(p?.tokenPriceUsd)} size={0.062} color="#ffffff" anchorX="right" mono />
      <Label
        position={[W / 2, 0.36, 0]}
        text={isPrivate
          ? `mark ${fmtUsd(p?.markPriceUsd)}${premium != null ? `  ${premium >= 0 ? "+" : ""}${premium.toFixed(1)}% vs mark` : ""}`
          : `underlying ${fmtUsd(p?.underlyingPriceUsd)}  ${fmtPct(ch)}`}
        size={0.024}
        color={isPrivate ? (premium == null ? "#b8c7da" : premium >= 0 ? C.solGreen : C.magenta) : ch == null ? "#b8c7da" : ch >= 0 ? C.solGreen : C.magenta}
        anchorX="right"
        mono
      />

      {/* The chart itself — transparent, no backdrop. Listed companies only. */}
      {isPrivate ? (
        <Label position={[-W / 2, 0.28, 0]} text={`Private company · trades 24/7 · no exchange price history`} size={0.022} color="#8ea3bd" maxWidth={W} />
      ) : (
        <group position={[0, 0.06, 0]}><ChartPlane companyId={companyId} w={W} h={H} /></group>
      )}

      {/* Stats line under the chart */}
      <Label position={[-W / 2, -0.23 + lift, 0]} text={pos ? `Position ${pos.amountUi.toFixed(4)} ${pos.symbol} · ${fmtUsd(pos.valueUsd)}` : auth.authenticated ? "No position" : "Not signed in · Buy opens sign-in"} size={0.022} color="#dfe9f5" />
      {active[0] ? <Label position={[-W / 2, -0.265 + lift, 0]} icon="order" text={`LIMIT ORDER · JUPITER · ${describeRule(active[0])}`} size={0.021} color={C.gold} /> : null}
      {impact && impact.companyId === companyId ? (
        <Label position={[-W / 2, -0.302 + lift, 0]} text={clip(`${impact.impact.replace("_", " ").toUpperCase()} · ${(impact.confidence * 100).toFixed(0)}% · ${impact.event}`, 84)} size={0.021} color={impact.impact === "potentially_negative" ? C.magenta : impact.impact === "potentially_positive" ? C.solGreen : C.amber} maxWidth={W} />
      ) : null}
      {items.map((n, i) => <Label key={n.id} position={[-W / 2, -0.34 + lift - i * 0.034, 0]} icon="bullet" text={clip(`${n.title} — ${n.source}`, 80)} size={0.021} color="#c7d7ea" maxWidth={W} />)}

      {/* Assistant buttons floating beneath */}
      <group position={[0, -0.46 + lift, 0.01]}>
        <Pill position={[-0.36, 0, 0]} w={0.2} icon={holding ? "dot" : undefined} label={holding ? "Listening" : voiceState === "connecting" ? "Connecting" : "Hold · Talk"} accent={holding ? C.violet : C.frost} active={holding} onHoldStart={() => setHold(true, auth)} onHoldEnd={() => setHold(false)} />
        {/* One accent for the primary action; the rest stay neutral. Five
            different hues in a row made the cluster read as a toy. */}
        <Pill position={[-0.135, 0, 0]} w={0.2} label="Buy $100" accent={C.sol} disabled={!canTrade} onClick={() => void prepareTrade(auth, companyId, "buy", 100).then((r) => { if (!r.ok && !isGated(r)) setError(r.error); })} />
        <Pill position={[0.09, 0, 0]} w={0.2} label="Sell all" accent={C.frost} disabled={!canTrade || !pos} onClick={() => pos && void prepareTrade(auth, companyId, "sell", pos.amountUi).then((r) => { if (!r.ok && !isGated(r)) setError(r.error); })} />
        <Pill position={[0.315, 0, 0]} w={0.2} label={triggerPrice ? `Buy < $${triggerPrice}` : "Trigger"} accent={C.frost} disabled={!canTrade || !triggerPrice} onClick={() => void prepareTrigger(auth, companyId, "buy_below", triggerPrice, 100).then((r) => { if (!r.ok) setError(r.error); })} />
      </group>
      <group position={[0, -0.545 + lift, 0.01]}>
        {/* Range pills only where a range means something. */}
        {isPrivate ? null : RANGES.map((r, i) => <Pill key={r} position={[-0.33 + i * 0.13, 0, 0]} w={0.11} label={r} accent={C.frost} active={r === range} onClick={() => setChartRange(r)} />)}
        <Pill position={[isPrivate ? -0.36 : 0.27, 0, 0]} w={0.18} icon="back" label="World" accent={C.frost} onClick={() => useWorld.getState().resetGlobe(false)} />
      </group>
    </group>
  );
}

/** Frosted card for confirmations (kept translucent, not opaque): fill, rim and top accent strip in one draw.
 * Hittable, so controller rays stop on the card instead of reaching the globe behind it. */
function Card({ w, h, accent, y = 0, fill = 0.72 }: { w: number; h: number; accent: string; y?: number; /** lighter for browse panels, so the room shows through */ fill?: number }) {
  return (
    <GlassRect position={[0, y, -0.002]} w={w} h={h} r={0.028} top="#0d1224" bottom="#080b16" accent={accent} interactive
      fill={fill} rim={0.7} stroke={0.0025} topBar={1} glow={0.35} pad={0.05} sheen={0.12} bar={0} />
  );
}

/** Rises and fades in over ~0.45 s when its key changes, so a cluster arrives with the globe instead of popping. */
function Rise({ id, children }: { id: string; children: ReactNode }) {
  const g = useRef<THREE.Group>(null);
  const t = useRef(0);
  const done = useRef(false);
  useEffect(() => { t.current = 0; done.current = false; }, [id]);
  useFrame((_, dt) => {
    const grp = g.current;
    if (!grp) return;
    t.current = Math.min(1, t.current + dt / 0.45);
    const k = 1 - Math.pow(1 - t.current, 3);
    grp.position.y = (1 - k) * -0.06;
    grp.position.z = (1 - k) * -0.08;
    grp.scale.setScalar(0.96 + 0.04 * k);
    if (done.current) return;
    if (t.current >= 1) done.current = true;
    grp.traverse((o) => {
      /* troika Text keeps its opacities on the mesh; glass on a uniform; chart / icon planes on the material. */
      const tx = o as unknown as { fillOpacity?: number; outlineOpacity?: number };
      if (typeof tx.fillOpacity === "number") { tx.fillOpacity = k; tx.outlineOpacity = 0.9 * k; return; }
      const m = (o as THREE.Mesh).material as (THREE.Material & { uniforms?: { uOpacity?: { value: number } } }) | undefined;
      if (!m) return;
      if (m.uniforms?.uOpacity) m.uniforms.uOpacity.value = k;
      else if (m.transparent && m.visible) m.opacity = k;
    });
  });
  return <group ref={g}>{children}</group>;
}

function Row({ y, label, value, color = "#ffffff", w = 0.76 }: { y: number; label: string; value: string; color?: string; w?: number }) {
  return (
    <group>
      <Label position={[-w / 2, y, 0.001]} text={label} size={0.022} color="#b8c7da" />
      <Label position={[w / 2, y, 0.001]} text={value} size={0.023} color={color} anchorX="right" />
    </group>
  );
}

/* Privy's signing prompt (showWalletUIs) is a DOM modal, which an immersive
 * session hides — the same reason LoginHolo ends the session. So while
 * immersive, holo confirm/cancel buttons never reach Privy: the first press
 * explains and tells Rhea; a second press exits to the flat page, where the
 * same panel is waiting to sign. */
const HANDOFF = "Confirm on your phone or desktop";
function useSignHandoff(id: string | undefined) {
  const inXR = useXR((s) => s.mode) != null;
  const session = useXR((s) => s.session);
  const announce = useVoice((s) => s.announce);
  const [shownFor, setShownFor] = useState<string | null>(null);
  const shown = id != null && shownFor === id;
  const handoff = (what: string) => {
    if (shown) { void session?.end().catch(() => undefined); return; }
    setShownFor(id ?? null);
    announce(`The user pressed a headset button to ${what}. Wallet signing can't be shown inside Mixed Reality, so nothing was signed. Tell them: "${HANDOFF}." Pressing the button again exits Mixed Reality, and the same panel is waiting on the page to sign.`);
  };
  return { inXR, shown, handoff, text: HANDOFF };
}

function TradeHolo() {
  const auth = useAuth();
  const pending = useMarket((s) => s.pendingTrade);
  const setPending = useMarket((s) => s.setPendingTrade);
  const announce = useVoice((s) => s.announce);
  const [err, setErr] = useState<string | null>(null);
  const sign = useSignHandoff(pending?.id);
  if (!pending?.quote) return null;
  const q = pending.quote; const co = COMPANY_BY_ID[pending.companyId];
  const accent = pending.status === "confirmed" ? C.solGreen : pending.status === "failed" ? C.magenta : C.sol;
  const fees = feeSummary(q);
  const receipt = pending.status === "confirmed" && pending.signature ? pending.signature : null;
  return (
    <group>
      <Card w={0.84} h={0.66} accent={accent} />
      <Label position={[-0.38, 0.28, 0.001]} text={`${pending.side.toUpperCase()} ${co.tokenSymbol}`} size={0.042} color="#ffffff" />
      <Label position={[-0.38, 0.235, 0.001]} text={`${co.name} · Jupiter · Solana · ${pending.status.replace("_", " ")}`} size={0.022} color="#b8c7da" />
      <Row y={0.16} label={pending.side === "buy" ? "Spend" : "Sell"} value={`${q.inAmountUi} ${q.inSymbol}`} />
      <Row y={0.11} label={`Estimated ${q.outSymbol}`} value={q.outAmountUi.toFixed(4)} />
      {receipt ? (
        /* Receipt: what the app saw. Links can't open inside the headset, so the tx is shown as text. */
        <group>
          <Label position={[-0.38, 0.045, 0.001]} text={pending.confirmMs != null ? `CONFIRMED IN ${fmtSeconds(pending.confirmMs).toUpperCase()}` : "CONFIRMED ON SOLANA"} size={0.036} color={C.solGreen} />
          {fees ? <Label position={[-0.38, -0.005, 0.001]} text={fees} size={0.021} color="#dfe9f5" maxWidth={0.76} /> : null}
          {pending.confirmedAt ? <Label position={[-0.38, -0.045, 0.001]} text={`${fmtEt(pending.confirmedAt)}${pending.sessionLabel ? ` · ${pending.sessionLabel}` : ""}`} size={0.021} color="#b8c7da" /> : null}
          <Label position={[-0.38, -0.09, 0.001]} text={`Solscan tx ${shortSig(receipt, 12)}`} size={0.022} color={C.solGreen} />
        </group>
      ) : (
        <group>
          <Row y={0.06} label="Route" value={q.route} />
          <Row y={0.01} label="Price impact" value={`${q.priceImpactPct.toFixed(3)}%`} color={q.priceImpactPct > 1 ? C.amber : "#ffffff"} />
          {fees ? <Row y={-0.04} label="Fees" value={fees} /> : null}
          {pending.signature ? <Row y={-0.09} label="Signature" value={shortSig(pending.signature, 10)} color={C.solGreen} /> : null}
        </group>
      )}
      {sign.shown ? <Label position={[-0.38, -0.14, 0.001]} text={`${sign.text}. Press again to exit Mixed Reality — this trade waits on the page.`} size={0.021} color={C.amber} maxWidth={0.76} />
        : err || pending.error ? <Label position={[-0.38, -0.14, 0.001]} text={err ?? pending.error ?? ""} size={0.021} color={C.magenta} maxWidth={0.76} /> : null}
      <Pill position={[-0.19, -0.24, 0.002]} w={0.24} label={pending.status === "confirmed" || pending.status === "failed" ? "Close" : "Cancel"} accent={C.frost} onClick={() => setPending(null)} />
      {pending.status === "awaiting_confirmation" || pending.status === "failed" ? (
        <Pill position={[0.19, -0.24, 0.002]} w={0.24} label={sign.shown ? "Exit to sign" : "Confirm"} accent={C.solGreen} onClick={() => {
          setErr(null);
          if (sign.inXR) { sign.handoff(`confirm the ${pending.side} of ${co.tokenSymbol}`); return; }
          void confirmTrade(auth, pending).then((d) => announce(tradeConfirmedAnnouncement(d))).catch((e: Error) => setErr(e.message));
        }} />
      ) : null}
    </group>
  );
}

function OrderHolo() {
  const auth = useAuth();
  const pending = useMarket((s) => s.pendingOrder);
  const mode = useMarket((s) => s.pendingOrderMode);
  const setPending = useMarket((s) => s.setPendingOrder);
  const announce = useVoice((s) => s.announce);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const sign = useSignHandoff(pending ? `${pending.id}:${pending.status}:${mode}` : undefined);
  if (!pending) return null;
  const co = COMPANY_BY_ID[pending.companyId];
  const isCancel = mode === "cancel";
  const withdrawOnly = pending.status !== "active" && Boolean(pending.needsWithdrawal);
  const canCancel = isCancel && (pending.status === "active" || withdrawOnly);
  const canPlace = !isCancel && pending.status === "pending";
  const held = !pending.simulated && (pending.status === "pending" || pending.status === "active" || withdrawOnly);
  const title = isCancel ? (pending.status === "cancelled" && !pending.needsWithdrawal ? "ORDER CANCELLED" : withdrawOnly ? "WITHDRAW FUNDS" : "CANCEL ORDER") : `${co.tokenSymbol} · LIMIT ORDER`;
  /* Most useful tx for this state: the refund after a cancel, else the deposit. */
  const tx = pending.withdrawTxSignature ? { label: pending.status === "completed" ? "Payout tx" : "Refund tx", sig: pending.withdrawTxSignature } : pending.txSignature ? { label: "Deposit tx", sig: pending.txSignature } : null;
  return (
    <group>
      <Card w={0.84} h={0.72} accent={isCancel ? C.magenta : C.amber} />
      <Label position={[-0.38, 0.31, 0.001]} text={title} size={0.038} color="#ffffff" />
      <Label position={[-0.38, 0.265, 0.001]} text={`${co.name} · Jupiter Trigger V2 · ${pending.status}`} size={0.022} color="#b8c7da" />
      <Row y={0.19} label="Action" value={`${pending.action.side.toUpperCase()} ${pending.action.side === "buy" ? fmtUsd(pending.action.amount) : pending.action.amount + " " + pending.action.currency}`} />
      <Row y={0.14} label="Trigger" value={`${co.tokenSymbol} ${pending.condition.kind === "price_below" ? "≤" : "≥"} ${fmtUsd(pending.condition.priceUsd)}`} color={C.amber} />
      <Row y={0.09} label="Status" value={orderStatusLabel(pending)} color={pending.needsWithdrawal ? C.amber : "#ffffff"} />
      <Row y={0.04} label="Held by" value={pending.simulated ? (import.meta.env.PROD ? "Unavailable right now" : "Dev only · local, not on Jupiter") : held ? "Jupiter, not Rhea · your Jupiter order vault" : "—"} color={held ? C.gold : "#ffffff"} />
      {pending.jupiterOrderId ? <Row y={-0.01} label="Jupiter order" value={shortSig(pending.jupiterOrderId)} /> : null}
      {tx ? <Row y={-0.06} label={tx.label} value={shortSig(tx.sig, 12)} color={C.solGreen} /> : null}
      {sign.shown ? <Label position={[-0.38, -0.13, 0.001]} text={`${sign.text}. Press again to exit Mixed Reality — this order waits on the page.`} size={0.021} color={C.amber} maxWidth={0.76} />
        : err ? <Label position={[-0.38, -0.13, 0.001]} text={err} size={0.021} color={C.magenta} maxWidth={0.76} /> : null}
      <Pill position={[-0.19, -0.27, 0.002]} w={0.24} label={canPlace ? "Not now" : canCancel ? (withdrawOnly ? "Later" : "Keep order") : "Close"} accent={C.frost} disabled={busy} onClick={() => setPending(null)} />
      {canPlace || canCancel ? (
        <Pill position={[0.19, -0.27, 0.002]} w={0.24} label={sign.shown ? "Exit to sign" : busy ? "Signing…" : isCancel ? (withdrawOnly ? "Withdraw" : "Cancel order") : "Confirm"} accent={isCancel ? C.magenta : C.amber} disabled={busy} onClick={() => {
          setErr(null);
          /* The immersive guard runs before anything that could open Privy (JWT signMessage included). */
          if (sign.inXR) { sign.handoff(isCancel ? `${withdrawOnly ? "withdraw the funds of" : "cancel"} the limit order on ${co.name}` : `place the limit order on ${co.name}`); return; }
          setBusy(true);
          const run = isCancel
            ? cancelTrigger(auth, pending).then((d) => announce(cancelAnnouncement(d)))
            : confirmTrigger(auth, pending).then((a) => announce(a.simulated
              ? `Dev build without a Jupiter key: ${describeRule(a)} was recorded locally for testing only; it is not on Jupiter and will not fill. Tell the user briefly.`
              : `Tell the user: "Your limit order is live on Jupiter: ${describeRule(a)}. It is held by Jupiter, not Rhea, and fills even if you close the app."`));
          void run.catch((e: Error) => setErr(e.message)).finally(() => setBusy(false));
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
  const pillY = listEnd - (headlines.length ? 0.09 + headlines.length * 0.042 : 0.03);
  const cardTop = top + 0.14, cardBottom = pillY - 0.06;
  return (
    <group>
      <Card w={0.92} h={cardTop - cardBottom} y={(cardTop + cardBottom) / 2} accent={C.cyan} fill={0.5} />
      <Label position={[-0.4, top + 0.09, 0]} text={cd.name.toUpperCase()} size={0.046} color="#ffffff" />
      <Label position={[-0.4, top + 0.04, 0]} text={`${cs?.assetCount ?? 0} tokenized assets · ${cs?.tradableCount ?? 0} live · say a company name or point at it`} size={0.022} color="#b8c7da" />
      {ids.map((id, i) => {
        const co = COMPANY_BY_ID[id]; const p = prices[id]; const ch = p?.change24hPct ?? null;
        return (
          <RowButton key={id} position={[0, top - 0.03 - i * 0.052, 0.002]} w={0.8} h={0.046} onClick={() => useWorld.getState().focusCompany(id, "user")}>
            <Label position={[-0.365, 0, 0.002]} text={`${co.name}  ${co.ticker}`} size={0.022} color="#ffffff" />
            <Label position={[0.38, 0, 0.002]} text={`${fmtUsd(p?.tokenPriceUsd)}  ${fmtPct(ch)}`} size={0.022} color={ch == null ? "#ffffff" : ch >= 0 ? C.solGreen : C.magenta} anchorX="right" mono />
          </RowButton>
        );
      })}
      {headlines.length ? <Label position={[-0.4, listEnd - 0.01, 0]} text={`NEWS · ${cd.name.toUpperCase()}`} size={0.02} color={C.frost} /> : null}
      {headlines.map((n, i) => <Label key={n.id} position={[-0.4, listEnd - 0.05 - i * 0.042, 0]} icon="bullet" text={clip(`${n.title} — ${n.source}`, 62)} size={0.021} color="#c7d7ea" maxWidth={0.8} />)}
      <Pill position={[0, pillY, 0.01]} w={0.22} icon="back" label="World" accent={C.frost} onClick={() => useWorld.getState().resetGlobe(false)} />
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
      <Label position={[-0.38, 0.145, 0.001]} text={prompt.reason} size={0.022} color="#b8c7da" maxWidth={0.76} />
      <Label position={[-0.38, 0.07, 0.001]} text="Google, email or a Solana wallet — new accounts get an embedded Solana wallet in seconds." size={0.022} color="#dfe9f5" maxWidth={0.76} />
      <Label position={[-0.38, -0.01, 0.001]} text={`Sign in opens a new browser tab: sign in there, come back to this tab, then press Enter Mixed Reality again.${prompt.resume ? ` Your request to ${describeIntent(prompt.resume)} continues automatically.` : ""}`} size={0.021} color="#b8c7da" maxWidth={0.76} />
      <Pill position={[-0.19, -0.17, 0.002]} w={0.24} label="Later" accent={C.frost} onClick={() => setPrompt(null)} />
      <Pill position={[0.19, -0.17, 0.002]} w={0.24} icon="external" label="Sign in" accent={C.cyan} onClick={() => {
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
      <Label position={[-0.38, 0.175, 0.001]} text={`USDC on Solana · ${fmtUsd(Math.max(0, prompt.neededUsd - have))} more needed`} size={0.022} color="#b8c7da" />
      <Row y={0.11} label="Wallet USDC" value={fmtUsd(have)} />
      <Row y={0.065} label="This trade needs" value={fmtUsd(prompt.neededUsd)} />
      <Label position={[-0.38, 0.005, 0.001]} text="SEND USDC (SOLANA) TO" size={0.02} color="#b8c7da" />
      <Label position={[-0.38, -0.03, 0.001]} text={addr.slice(0, 22)} size={0.024} color={C.solGreen} />
      <Label position={[-0.38, -0.062, 0.001]} text={addr.slice(22)} size={0.024} color={C.solGreen} />
      <Label position={[-0.38, -0.115, 0.001]} text={`Solana network only; keep ~0.01 SOL for fees. Copy the address from the desktop panel.${prompt.resume ? " The trade continues when the USDC lands." : ""}`} size={0.021} color="#b8c7da" maxWidth={0.76} />
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

/* Captions sit above the globe, but never so high the user has to crane up:
 * past this height they float in front of the planet's upper half instead. */
const CAPTION_MAX_Y = 1.78;

/** Follows the globe: just above it, the text growing upward from the status line. */
function useAboveGlobe(ref: RefObject<THREE.Group | null>) {
  useFrame(() => {
    const g = ref.current;
    if (!g) return;
    const { pos, scale } = xrGlobe;
    const y = pos.y + scale + CAPTION_GAP;
    if (y <= CAPTION_MAX_Y) g.position.set(pos.x + 0.06, y, pos.z + scale * 0.35);
    /* Too tall to stack on: slide in front of and up-left of the planet, clear of the country labels on its crown. */
    else g.position.set(pos.x - scale * 0.55, CAPTION_MAX_Y, pos.z + scale * 1.05);
  });
}

/** Floating captions + status above the globe. */
function Captions() {
  const captions = useVoice((s) => s.captions);
  const state = useVoice((s) => s.state);
  const holding = useVoice((s) => s.holding);
  const ref = useRef<THREE.Group>(null);
  useAboveGlobe(ref);
  const last = captions.slice(-2);
  const status = holding ? "LISTENING · RELEASE WHEN DONE"
    : state === "connecting" ? "CONNECTING…"
    : state === "speaking" ? "SPEAKING · HOLD  A  TO INTERRUPT"
    : state === "thinking" ? "THINKING…"
    : "HOLD  A  TO SPEAK";
  /* Backing chip sized from the laid-out text block, so it hugs one line or five. */
  const [box, setBox] = useState<{ w: number; h: number } | null>(null);
  const onSync = (m: { textRenderInfo?: { blockBounds: number[] } }) => { const b = m.textRenderInfo?.blockBounds; if (b) setBox({ w: b[2] - b[0], h: b[3] - b[1] }); };
  return (
    <group ref={ref}>
      {/* Status line hugs the globe; captions stack upward from it (bottom-anchored so wrapping grows up). */}
      {last.length ? (
        <group>
          {box ? <GlassRect position={[0, 0.03 + box.h / 2, -0.003]} w={box.w + 0.08} h={box.h + 0.05} r={0.024} top="#0d1224" bottom="#080b16" accent={C.cyan} fill={0.55} rim={0.45} stroke={0.002} topBar={0} glow={0.2} pad={0.03} sheen={0} bar={0} /> : null}
          <Text font={FONT_BODY} position={[0, 0.03, 0]} fontSize={0.025} color="#e8f4ff" anchorX="center" anchorY="bottom" maxWidth={1.0} textAlign="center" lineHeight={1.35} onSync={onSync} {...OUTLINE}>
            {last.map((c) => `${c.role === "user" ? "You: " : "Rhea: "}${c.text.slice(-160)}`).join("\n")}
          </Text>
        </group>
      ) : null}
      <Text font={FONT_BOLD} position={[0, 0, 0]} fontSize={0.02} color={holding ? C.violet : state === "speaking" ? C.solGreen : state === "thinking" ? C.amber : "#b8c7da"} anchorX="center" anchorY="middle" letterSpacing={0.2} {...OUTLINE}>
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
  useUnderGlobe(anchor);
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
      <mesh ref={ref} onPointerDown={(e) => { e.stopPropagation(); feel.press(e); setHold(true, auth); }} onPointerUp={(e) => { e.stopPropagation(); setHold(false); }} onPointerOut={() => setHold(false)}>
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
  const session = useXR((s) => s.session);
  useFrame(() => {
    const gp = right?.gamepad;
    const buttons = right?.inputSource?.gamepad?.buttons;
    if (!gp && !buttons) return;
    const a = gp?.["a-button"] ? gp["a-button"].state === "pressed" : Boolean(buttons?.[4]?.pressed);
    const b = gp?.["b-button"] ? gp["b-button"].state === "pressed" : Boolean(buttons?.[5]?.pressed);
    /* A is haptic-only: a click sound would land in the mic that just opened. */
    if (a !== was.current.a) { if (a) buzz(right?.inputSource, 0.35, 18); useVoice.getState().setHold(a, auth); }
    /* B also re-seats the planet in front of wherever the user now is. */
    if (b && !was.current.b) { cue(session, "press", "right"); useWorld.getState().resetGlobe(false); recenterXR(); }
    was.current = { a, b };
  });
  return null;
}

/** Idle hint when nothing is focused: floats where the chart will appear. */
function IdleHint() {
  const overview = useMarket((s) => s.overview);
  /* Same pill as the desktop HUD (which unmounts in the headset, so polling starts here too). */
  const session = useMarket((s) => s.session);
  useEffect(() => { startSessionPolling(); }, []);
  const pill = session ? sessionPill(session) : null;
  return (
    <group>
      <Card w={0.96} h={0.28} y={-0.02} accent={C.sol} fill={0.45} />
      <Label position={[0, 0.06, 0]} text="RHEA" size={0.05} color="#ffffff" anchorX="center" />
      <Label position={[0, 0.005, 0]} text={overview ? `${overview.assets.length} tokenized stocks · ${overview.countries.length} countries · live on Solana` : "loading market…"} size={0.022} color="#b8c7da" anchorX="center" />
      {pill ? <Label position={[0, -0.095, 0]} text={pill.long} size={0.021} color={pill.open ? C.solGreen : C.gold} anchorX="center" /> : null}
      <Label position={[0, -0.05, 0]} text={`Say "What changed while the market was closed?" or "Why is Nvidia moving?"`} size={0.022} color={C.frost} anchorX="center" />
    </group>
  );
}

/** A chime and a pulse on both controllers when a trade or order lands while in the headset; a low tone if it fails. */
function ResultCues() {
  const session = useXR((s) => s.session);
  /* Primitive selectors: zustand v5 re-renders forever on a fresh object per call. */
  const tradeId = useMarket((s) => s.pendingTrade?.id ?? "");
  const tradeStatus = useMarket((s) => s.pendingTrade?.status ?? "");
  const orderId = useMarket((s) => s.pendingOrder?.id ?? "");
  const orderStatus = useMarket((s) => s.pendingOrder?.status ?? "");
  const seen = useRef<Record<string, string>>({});
  useEffect(() => {
    for (const [key, status] of [[`trade:${tradeId}`, tradeStatus], [`order:${orderId}`, orderStatus]] as const) {
      if (!status) continue;
      const prev = seen.current[key];
      seen.current[key] = status;
      if (prev == null || prev === status) continue;
      if (status === "confirmed" || status === "active" || status === "completed") cue(session, "success");
      else if (status === "failed") cue(session, "error");
    }
  }, [tradeId, tradeStatus, orderId, orderStatus, session]);
  return null;
}

export function XRPanels() {
  const mode = useXR((s) => s.mode);
  /* Phones keep the DOM HUD on screen (dom-overlay), so the in-world panels stay out of the way. */
  const handheld = useHandheld((s) => s.active === "webxr");
  const focusedCompany = useWorld((s) => s.focusedCompany);
  const focusedCountry = useWorld((s) => s.focusedCountry);
  const pendingTrade = useMarket((s) => s.pendingTrade);
  const pendingOrder = useMarket((s) => s.pendingOrder);
  const loginPrompt = useMarket((s) => s.loginPrompt);
  const depositPrompt = useMarket((s) => s.depositPrompt);
  if (mode == null || handheld) return null;
  return (
    <group>
      <group position={CLUSTER_POS} rotation={CLUSTER_ROT}>
        <Rise id={pendingTrade ? `trade:${pendingTrade.id}` : pendingOrder ? `order:${pendingOrder.id}` : depositPrompt ? "deposit" : loginPrompt ? "login" : focusedCompany ? `co:${focusedCompany}` : focusedCountry ? `cc:${focusedCountry}` : "idle"}>
          {pendingTrade ? <TradeHolo /> : pendingOrder ? <OrderHolo /> : depositPrompt ? <DepositHolo /> : loginPrompt ? <LoginHolo /> : focusedCompany ? <CompanyHolo companyId={focusedCompany} /> : focusedCountry ? <CountryHolo code={focusedCountry} /> : <IdleHint />}
        </Rise>
      </group>
      <Captions />
      <VoiceOrb />
      <XRButtons />
      <ResultCues />
    </group>
  );
}
