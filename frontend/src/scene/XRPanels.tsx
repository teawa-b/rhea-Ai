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
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
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
import { damp } from "./geo";
import { FONT_BODY, FONT_BOLD, FONT_NUM, latinText } from "./fonts";
import { GlassRect, UNIT_PLANE, type GlassMaterial } from "./glass";
import { HoloFrame } from "./holoframe";
import { HoloKeyboard, HoloNumpad, TypedLine } from "./HoloKeyboard";
import { useLogoTexture } from "./logoTexture";
import { api } from "@/market/api";
import type { NewsEvent } from "@shared/types";
import { Icon, type IconName } from "./icons";
import { buzz, cue, feel } from "./xrFeedback";
import { C, fmtAge, fmtEt, fmtPct, fmtSeconds, fmtUsd, shortSig } from "@/theme";
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

const BTN_H = 0.058;
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

/** Action button: a chamfered HUD control — the same corner cut as every button on the flat
 * page (--btn-cut), a luminous rim, an accent tick at the leading edge and a glow that blooms
 * on hover and press. The whole look is one GlassRect draw. */
function HoloButton({ position, label, icon, accent = C.cyan, w = 0.2, onClick, onHoldStart, onHoldEnd, disabled, active }: { position: [number, number, number]; label: string; icon?: IconName; accent?: string; w?: number; onClick?: () => void; /** press-and-hold (pinch or trigger held) */ onHoldStart?: () => void; onHoldEnd?: () => void; disabled?: boolean; active?: boolean }) {
  const stop = (e: ThreeEvent<PointerEvent | MouseEvent>) => e.stopPropagation();
  const spring = useButtonSpring({ disabled, active }, (m, g) => {
    m.uniforms.uGlow.value = g;
    m.uniforms.uFill.value = disabled ? 0.32 : 0.7 + g * 0.26;
    m.uniforms.uRim.value = disabled ? 0.3 : 0.75 + g * 0.6;
    m.uniforms.uBar.value = disabled ? 0.25 : 0.7 + g * 0.3;
  });
  const h = BTN_H;
  /* The cut scales with the control so the 1D/5D chips read the same as Buy $100. */
  const cut = Math.min(0.013, w * 0.13, h * 0.3);
  const [top, bottom] = useMemo(() => {
    const acc = new THREE.Color(accent);
    return [PANEL_DARK.clone().lerp(acc, active ? 0.56 : 0.2), PANEL_DARK.clone().lerp(acc, active ? 0.26 : 0.02)];
  }, [accent, active]);
  const ink = disabled ? "#6f8196" : "#ffffff";
  return (
    <group position={position}>
      <group ref={spring.group}>
        <GlassRect ref={spring.mat} w={w} h={h} chamfer={cut} pad={0.03} top={top} bottom={bottom} accent={accent} stroke={0.0026}
          sheen={disabled ? 0.04 : active ? 0.3 : 0.12} barGeo={[0.009, 0.0022, h * 0.26]} topBar={0} />
        {/* Hit area is the button itself, not its glow margin (neighbours sit 2.5 cm apart). */}
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
        {icon ? <Icon name={icon} size={0.023} color={ink} position={[-w / 2 + 0.026, 0, 0.003]} /> : null}
        <Text font={FONT_BOLD} position={[icon ? 0.014 : 0.005, -0.001, 0.003]} fontSize={0.0205} color={ink} anchorX="center" anchorY="middle" letterSpacing={0.13} raycast={NO_RAYCAST} {...OUTLINE}>
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

/* ---------------- Headline ticker (in-headset) ----------------
 * News hangs *under* the panel rather than inside it: square cards on a
 * shallow curve, sliding left→right for ever like a broadcast crawl. The list
 * is repeated until it is wider than the band, so the loop never opens a gap,
 * and cards fade out at both ends — the glass shader has no clip planes, and
 * a fade reads better over passthrough than a hard edge anyway. */
const TILE = 0.2, TILE_GAP = 0.03, TICKER_W = 1.24, TICKER_SPEED = 0.055;
const hostOf = (url: string) => { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; } };

/** Bottom edge of whichever panel is open, so the ticker hangs just beneath it (written during render). */
const holoBox = { bottom: -0.62 };

/** Drive a whole subtree's opacity: troika keeps it on the mesh, glass on a uniform, plain planes on the material. */
function setSubtreeOpacity(root: THREE.Object3D, k: number) {
  root.traverse((o) => {
    const tx = o as unknown as { fillOpacity?: number; outlineOpacity?: number };
    if (typeof tx.fillOpacity === "number") { tx.fillOpacity = k; tx.outlineOpacity = 0.9 * k; return; }
    const m = (o as THREE.Mesh).material as (THREE.Material & { uniforms?: { uOpacity?: { value: number } } }) | undefined;
    if (!m) return;
    if (m.uniforms?.uOpacity) m.uniforms.uOpacity.value = k;
    else if (m.transparent && m.visible) m.opacity = k;
  });
}

/** One story as a square card: source strip, wrapped headline, age. Green while under a day old. */
function NewsTile({ n }: { n: NewsEvent }) {
  const host = hostOf(n.sourceUrl ?? n.url);
  const icon = useLogoTexture(host ? api.faviconUrl(host) : undefined);
  const at = Date.parse(n.publishedAt);
  const fresh = Number.isFinite(at) && Date.now() - at < 86_400_000;
  const accent = fresh ? C.solGreen : C.cyan;
  const top = useMemo(() => PANEL_DARK.clone().lerp(new THREE.Color(accent), 0.16), [accent]);
  const pad = 0.018, badge = 0.024;
  return (
    <group>
      <GlassRect w={TILE} h={TILE} chamfer={0.02} top={top} bottom={PANEL_DARK} accent={accent}
        stroke={0.0024} fill={0.52} rim={0.55} topBar={1} glow={0.25} pad={0.035} sheen={0.1} bar={0} />
      <group position={[-TILE / 2 + pad + badge / 2, TILE / 2 - 0.028, 0.002]}>
        {icon ? (
          <>
            <mesh position={[0, 0, -0.0003]}><planeGeometry args={[badge + 0.004, badge + 0.004]} /><meshBasicMaterial color="#ffffff" transparent opacity={0.92} toneMapped={false} /></mesh>
            <mesh><planeGeometry args={[badge, badge]} /><meshBasicMaterial map={icon} transparent toneMapped={false} /></mesh>
          </>
        ) : (
          <>
            <mesh><planeGeometry args={[badge, badge]} /><meshBasicMaterial color={accent} transparent opacity={0.3} toneMapped={false} /></mesh>
            <Text font={FONT_BOLD} position={[0, 0, 0.001]} fontSize={0.015} color="#ffffff" anchorX="center" anchorY="middle" raycast={NO_RAYCAST}>{(n.source || host || "?").slice(0, 1).toUpperCase()}</Text>
          </>
        )}
      </group>
      <Label position={[-TILE / 2 + pad + badge + 0.011, TILE / 2 - 0.028, 0.002]} text={clip((n.source || host).toUpperCase(), 15)} size={0.0135} color={accent} />
      {/* Four lines is what fits above the age line; the clip keeps a long headline from running past the cut corner. */}
      <Text font={FONT_BODY} position={[-TILE / 2 + pad, TILE / 2 - 0.052, 0.002]} fontSize={0.016} color="#ffffff"
        anchorX="left" anchorY="top" maxWidth={TILE - pad * 2} lineHeight={1.26} raycast={NO_RAYCAST} {...OUTLINE}>
        {latinText(clip(n.title, 58))}
      </Text>
      {Number.isFinite(at) ? <Label position={[-TILE / 2 + pad, -TILE / 2 + 0.022, 0.002]} text={fmtAge(n.publishedAt)} size={0.014} color={fresh ? C.solGreen : "#8ea3bd"} /> : null}
    </group>
  );
}

/** "LIVE WIRE · SINGAPORE · 3 stories" with a breathing green dot; or the searching line while the wire loads. */
function WireHead({ y, x, label, count, searching }: { y: number; x: number; label: string; count: number; searching?: boolean }) {
  const dot = useRef<THREE.Mesh>(null);
  useFrame((s) => { if (dot.current) { const k = 0.6 + 0.4 * Math.sin(s.clock.elapsedTime * (searching ? 5 : 2.2)); dot.current.scale.setScalar(k); (dot.current.material as THREE.MeshBasicMaterial).opacity = 0.5 + 0.5 * k; } });
  return (
    <group position={[x, y, 0]}>
      <mesh ref={dot} position={[0.006, 0, 0]} raycast={NO_RAYCAST}><circleGeometry args={[0.0045, 20]} /><meshBasicMaterial color={C.solGreen} transparent toneMapped={false} /></mesh>
      <Label position={[0.018, 0, 0]} text={searching ? `SEARCHING THE WIRE · ${label.toUpperCase()}…` : `LIVE WIRE · ${label.toUpperCase()} · ${count} ${count === 1 ? "STORY" : "STORIES"}`} size={0.017} color={C.frost} />
    </group>
  );
}

/** The crawl itself: follows the open panel's bottom edge, loops for ever, fades at both ends. */
function NewsTicker() {
  const news = useWorld((s) => s.news);
  const newsPending = useWorld((s) => s.newsPending);
  const items = news?.items ?? [];
  const label = news?.target ?? newsPending ?? "";
  const root = useRef<THREE.Group>(null);
  const cards = useRef<(THREE.Group | null)[]>([]);
  const offset = useRef(0);
  const y = useRef(holoBox.bottom - 0.08);

  const pitch = TILE + TILE_GAP;
  /* Repeat the list until it outruns the band, so there is always a card entering as one leaves. */
  const slots = useMemo(() => {
    if (!items.length) return [];
    const reps = Math.max(2, Math.ceil((TICKER_W + pitch * 2) / (items.length * pitch)));
    return Array.from({ length: items.length * reps }, (_, i) => items[i % items.length]);
  }, [items, pitch]);
  const span = slots.length * pitch;
  useLayoutEffect(() => { cards.current.length = slots.length; offset.current = 0; }, [slots.length]);

  useFrame((_, rawDt) => {
    const g = root.current;
    if (!g) return;
    const dt = Math.min(0.05, rawDt);
    /* Ease onto the open panel so switching country → company slides rather than jumps. */
    y.current = damp(y.current, holoBox.bottom - 0.08, 5, dt);
    g.position.y = y.current;
    if (!span) return;
    offset.current = (offset.current + dt * TICKER_SPEED) % span;
    const edge = TICKER_W / 2 + TILE / 2;
    for (let i = 0; i < slots.length; i++) {
      const card = cards.current[i];
      if (!card) continue;
      const x = (((i * pitch + offset.current) % span) + span) % span - span / 2;
      const fade = Math.max(0, Math.min(1, (edge - Math.abs(x)) / 0.2));
      card.visible = fade > 0.01;
      if (!card.visible) continue;
      card.position.set(x, 0, -Math.abs(x) * 0.06);
      /* A shallow cylinder: cards turn away as they travel, like a carousel of panes. */
      card.rotation.y = -x * 0.5;
      setSubtreeOpacity(card, fade * fade);
    }
  });

  if (!items.length && !newsPending) return null;
  return (
    <group ref={root}>
      <WireHead x={-TICKER_W / 2} y={0} label={label} count={items.length} searching={!items.length} />
      <group position={[0, -0.04 - TILE / 2, 0]}>
        {slots.map((n, i) => (
          <group key={`${n.id}:${i}`} ref={(g) => { cards.current[i] = g; }}>
            <NewsTile n={n} />
          </group>
        ))}
      </group>
    </group>
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
  const newsPending = useWorld((s) => s.newsPending);
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
  const W = 1.04, H = 0.5;
  const triggerPrice = p?.tokenPriceUsd ? Math.round(p.tokenPriceUsd * 0.9) : 0;

  /* A private company has no exchange series, so there is nothing to plot. The
   * plane used to mount anyway and left a hole in the middle of the cluster,
   * with range pills under it that changed nothing. Skip both and lift
   * everything below the chart into the space it would have taken. */
  const isPrivate = Boolean(co.private) || p?.underlyingSource === "issuer-mark";
  const lift = isPrivate ? 0.42 : 0;
  const premium = p?.premiumToMarkPct ?? null;
  /* Frame bottom, for the ticker hanging under it. */
  useLayoutEffect(() => { holoBox.bottom = -0.62 + lift; }, [lift]);

  return (
    <group>
      {/* The glass card shrinks with the cluster: without a chart there is
          0.42 less to back, and its centre rises by half that. */}
      <Frame w={W + 0.14} h={1.12 - lift} y={-0.06 + lift / 2} />
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
      {/* Assistant buttons floating beneath */}
      <group position={[0, -0.46 + lift, 0.01]}>
        <HoloButton position={[-0.36, 0, 0]} w={0.2} icon={holding ? "dot" : undefined} label={holding ? "Listening" : voiceState === "connecting" ? "Connecting" : "Hold · Talk"} accent={holding ? C.violet : C.sol} active={holding} onHoldStart={() => setHold(true, auth)} onHoldEnd={() => setHold(false)} />
        <HoloButton position={[-0.135, 0, 0]} w={0.2} label="Buy $100" accent={C.solGreen} disabled={!canTrade} onClick={() => void prepareTrade(auth, companyId, "buy", 100).then((r) => { if (!r.ok && !isGated(r)) setError(r.error); })} />
        <HoloButton position={[0.09, 0, 0]} w={0.2} label="Sell all" accent={C.magenta} disabled={!canTrade || !pos} onClick={() => pos && void prepareTrade(auth, companyId, "sell", pos.amountUi).then((r) => { if (!r.ok && !isGated(r)) setError(r.error); })} />
        <HoloButton position={[0.315, 0, 0]} w={0.2} label={triggerPrice ? `Buy < $${triggerPrice}` : "Trigger"} accent={C.amber} disabled={!canTrade || !triggerPrice} onClick={() => void prepareTrigger(auth, companyId, "buy_below", triggerPrice, 100).then((r) => { if (!r.ok) setError(r.error); })} />
      </group>
      <group position={[0, -0.545 + lift, 0.01]}>
        {/* Range pills only where a range means something. */}
        {isPrivate ? null : RANGES.map((r, i) => <HoloButton key={r} position={[-0.33 + i * 0.13, 0, 0]} w={0.11} label={r} accent={C.frost} active={r === range} onClick={() => setChartRange(r)} />)}
        <HoloButton position={[isPrivate ? -0.36 : 0.27, 0, 0]} w={0.18} icon="back" label="World" accent={C.frost} onClick={() => useWorld.getState().resetGlobe(false)} />
      </group>
    </group>
  );
}

/** Frosted card for confirmations (kept translucent, not opaque): fill, rim and top accent strip in one draw.
 * Hittable, so controller rays stop on the card instead of reaching the globe behind it. */
function Card({ w, h, accent }: { w: number; h: number; accent: string }) {
  return (
    <GlassRect position={[0, 0, -0.002]} w={w} h={h} r={0.024} top="#0b0f1c" accent={accent} interactive
      fill={0.72} rim={0.9} stroke={0.0025} topBar={1} glow={0} sheen={0} bar={0} />
  );
}

/** Browse clusters (company, country, idle) are text standing in the room; the frame only marks their space. */
function Frame({ w, h, y = 0, accent = C.cyan }: { w: number; h: number; y?: number; accent?: string }) {
  return <HoloFrame position={[0, y, -0.004]} w={w} h={h} accent={accent} interactive />;
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
    setSubtreeOpacity(grp, k);
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

/* Privy's embedded wallet signs silently while immersive (Auth passes
 * showWalletUIs: false), so the holo card is the confirmation and a press on
 * Confirm signs right here. An external wallet (Phantom, Solflare…) needs its
 * own popup, which an immersive session hides: the first press explains, a
 * second press exits to the flat page where the same panel is waiting. */
const HANDOFF = "Your wallet app can't open in Mixed Reality";
function useSignHandoff(id: string | undefined) {
  const auth = useAuth();
  const inXR = useXR((s) => s.mode) != null;
  const session = useXR((s) => s.session);
  const announce = useVoice((s) => s.announce);
  const [shownFor, setShownFor] = useState<string | null>(null);
  const shown = id != null && shownFor === id;
  /** True when the press must be handed off rather than signed here. */
  const needed = inXR && !auth.embedded;
  const handoff = (what: string) => {
    if (shown) { void session?.end().catch(() => undefined); return; }
    setShownFor(id ?? null);
    announce(`The user pressed a headset button to ${what}. Their external wallet app can't open inside Mixed Reality, so nothing was signed. Tell them: "${HANDOFF} — press again to exit and approve on the page." The same panel is waiting on the page.`);
  };
  return { needed, shown, handoff, text: HANDOFF };
}

function TradeHolo() {
  const auth = useAuth();
  const pending = useMarket((s) => s.pendingTrade);
  const setPending = useMarket((s) => s.setPendingTrade);
  const announce = useVoice((s) => s.announce);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const sign = useSignHandoff(pending?.id);
  if (!pending?.quote) return null;
  const q = pending.quote; const co = COMPANY_BY_ID[pending.companyId];
  const accent = pending.status === "confirmed" ? C.solGreen : pending.status === "failed" ? C.magenta : C.sol;
  const fees = feeSummary(q);
  const receipt = pending.status === "confirmed" && pending.signature ? pending.signature : null;
  return (
    <group>
      <Card w={0.84} h={receipt ? 0.62 : 0.6} accent={accent} />
      <Label position={[-0.38, 0.25, 0.001]} text={`${pending.side.toUpperCase()} ${co.tokenSymbol}`} size={0.042} color="#ffffff" />
      <Label position={[-0.38, 0.205, 0.001]} text={`${co.name} · Jupiter · Solana · ${pending.status.replace("_", " ")}`} size={0.022} color="#b8c7da" />
      <Row y={0.14} label={pending.side === "buy" ? "Spend" : "Sell"} value={`${q.inAmountUi} ${q.inSymbol}`} />
      <Row y={0.095} label={`Estimated ${q.outSymbol}`} value={q.outAmountUi.toFixed(4)} />
      {receipt ? (
        /* Receipt: what the app saw. Links can't open inside the headset, so the tx is shown as text. */
        <group>
          <Label position={[-0.38, 0.03, 0.001]} text={pending.confirmMs != null ? `CONFIRMED IN ${fmtSeconds(pending.confirmMs).toUpperCase()}` : "CONFIRMED ON SOLANA"} size={0.036} color={C.solGreen} />
          {fees ? <Label position={[-0.38, -0.02, 0.001]} text={fees} size={0.02} color="#dfe9f5" maxWidth={0.76} /> : null}
          {pending.confirmedAt ? <Label position={[-0.38, -0.075, 0.001]} text={`${fmtEt(pending.confirmedAt)}${pending.sessionLabel ? ` · ${pending.sessionLabel}` : ""}`} size={0.02} color="#b8c7da" /> : null}
          <Label position={[-0.38, -0.115, 0.001]} text={`Solscan tx ${shortSig(receipt, 12)}`} size={0.022} color={C.solGreen} />
        </group>
      ) : (
        <group>
          <Row y={0.05} label="Route" value={q.route} />
          <Row y={0.005} label="Price impact" value={`${q.priceImpactPct.toFixed(3)}%`} color={q.priceImpactPct > 1 ? C.amber : "#ffffff"} />
          {/* The fee line is a sentence: it wraps under its caption rather than fighting a right-aligned value. */}
          {fees ? <Label position={[-0.38, -0.045, 0.001]} text="FEES" size={0.017} color={C.frost} /> : null}
          {fees ? <Label position={[-0.38, -0.085, 0.001]} text={fees} size={0.02} color="#dfe9f5" maxWidth={0.76} /> : null}
          {pending.signature ? <Row y={-0.14} label="Signature" value={shortSig(pending.signature, 10)} color={C.solGreen} /> : null}
        </group>
      )}
      {sign.shown ? <Label position={[-0.38, -0.165, 0.001]} text={`${sign.text}. Press again to exit and approve on the page — this trade waits there.`} size={0.02} color={C.amber} maxWidth={0.76} />
        : err || pending.error ? <Label position={[-0.38, -0.165, 0.001]} text={err ?? pending.error ?? ""} size={0.02} color={C.magenta} maxWidth={0.76} /> : null}
      <HoloButton position={[-0.19, -0.235, 0.002]} w={0.24} label={pending.status === "confirmed" || pending.status === "failed" ? "Close" : "Cancel"} accent={C.frost} disabled={busy} onClick={() => setPending(null)} />
      {pending.status === "awaiting_confirmation" || pending.status === "failed" ? (
        <HoloButton position={[0.19, -0.235, 0.002]} w={0.24} label={sign.shown ? "Exit to sign" : busy ? "Signing…" : "Confirm"} accent={C.solGreen} disabled={busy} onClick={() => {
          setErr(null);
          if (sign.needed) { sign.handoff(`confirm the ${pending.side} of ${co.tokenSymbol}`); return; }
          setBusy(true);
          void confirmTrade(auth, pending).then((d) => announce(tradeConfirmedAnnouncement(d))).catch((e: Error) => setErr(e.message)).finally(() => setBusy(false));
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
      {sign.shown ? <Label position={[-0.38, -0.13, 0.001]} text={`${sign.text}. Press again to exit and approve on the page — this order waits there.`} size={0.021} color={C.amber} maxWidth={0.76} />
        : err ? <Label position={[-0.38, -0.13, 0.001]} text={err} size={0.021} color={C.magenta} maxWidth={0.76} /> : null}
      <HoloButton position={[-0.19, -0.27, 0.002]} w={0.24} label={canPlace ? "Not now" : canCancel ? (withdrawOnly ? "Later" : "Keep order") : "Close"} accent={C.frost} disabled={busy} onClick={() => setPending(null)} />
      {canPlace || canCancel ? (
        <HoloButton position={[0.19, -0.27, 0.002]} w={0.24} label={sign.shown ? "Exit to sign" : busy ? "Signing…" : isCancel ? (withdrawOnly ? "Withdraw" : "Cancel order") : "Confirm"} accent={isCancel ? C.magenta : C.amber} disabled={busy} onClick={() => {
          setErr(null);
          /* External wallets only: the guard runs before anything that could open their popup (JWT signMessage included). */
          if (sign.needed) { sign.handoff(isCancel ? `${withdrawOnly ? "withdraw the funds of" : "cancel"} the limit order on ${co.name}` : `place the limit order on ${co.name}`); return; }
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
  const top = 0.05 + ids.length * 0.025;
  const listEnd = top - 0.03 - ids.length * 0.052;
  const pillY = listEnd - 0.03;
  const cardTop = top + 0.14, cardBottom = pillY - 0.06;
  useLayoutEffect(() => { holoBox.bottom = cardBottom; }, [cardBottom]);
  return (
    <group>
      <Frame w={0.94} h={cardTop - cardBottom} y={(cardTop + cardBottom) / 2} />
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
      <HoloButton position={[0, pillY, 0.01]} w={0.22} icon="back" label="World" accent={C.frost} onClick={() => useWorld.getState().resetGlobe(false)} />
    </group>
  );
}

/* ---------------- Sign-in / funding gates (in-headset) ----------------
 * Privy's login is a DOM modal, which an immersive session hides. Rather than
 * ejecting the user to the flat page, the card runs Privy's headless email
 * one-time-code flow on holo keyboards: address, then the six digits. A
 * returning browser remembers the address, so it is usually one press and a
 * code. Google and external wallets still need a browser and say so.
 *
 * Nothing resumes the pending trade here: App already watches for
 * authenticated + loginPrompt and calls resumeIntent, however the user got in. */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
/** t***e@gmail.com - enough to recognise, not enough to read over a shoulder. */
const maskEmail = (a: string) => {
  const [u, d] = a.split("@");
  if (!d) return a;
  const dots = "•".repeat(Math.max(1, Math.min(3, u.length - 2)));
  return `${u.slice(0, 1)}${dots}${u.length > 1 ? u.slice(-1) : ""}@${d}`;
};

function LoginHolo() {
  const auth = useAuth();
  const session = useXR((s) => s.session);
  const prompt = useMarket((s) => s.loginPrompt);
  const setPrompt = useMarket((s) => s.setLoginPrompt);
  const remembered = auth.email.remembered;
  /* "choose" only when there is nothing remembered: a returning user lands straight on Send. */
  const [step, setStep] = useState<"choose" | "email" | "code">(remembered ? "email" : "choose");
  const [addr, setAddr] = useState(remembered ?? "");
  const [code, setCode] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const valid = EMAIL_RE.test(addr.trim());

  if (!prompt) return null;

  const send = () => {
    if (!valid || busy) return;
    setBusy(true); setErr(null);
    void auth.email.sendCode(addr.trim())
      .then(() => { setCode(""); setStep("code"); })
      .catch((e: Error) => setErr(e.message || "Could not send the code - check the address."))
      .finally(() => setBusy(false));
  };
  const submit = () => {
    if (code.length !== 6 || busy) return;
    setBusy(true); setErr(null);
    /* On success App's resume effect takes over and the panel unmounts with the prompt. */
    void auth.email.submitCode(code)
      .catch((e: Error) => { setErr(e.message || "That code was not right - try again."); setCode(""); })
      .finally(() => setBusy(false));
  };

  /* Cards are centred on y=0, so each screen places its own header and note inside its own half-height. */
  const header = (y: number, title: string, sub: string) => (
    <group>
      <Label position={[-0.44, y, 0.001]} text={title} size={0.038} color="#ffffff" />
      <Label position={[-0.44, y - 0.045, 0.001]} text={sub} size={0.021} color="#b8c7da" maxWidth={0.88} />
    </group>
  );
  const note = (y: number, text: string, color: string = C.magenta) => <Label position={[0, y, 0.001]} text={text} size={0.02} color={color} maxWidth={0.88} anchorX="center" />;

  if (step === "choose") {
    return (
      <group>
        <Card w={0.96} h={0.72} accent={C.cyan} />
        {header(0.28, "SIGN IN TO TRADE", prompt.reason)}
        <Label position={[-0.44, 0.17, 0.001]} text={`New accounts get an embedded Solana wallet in seconds.${prompt.resume ? ` Your request to ${describeIntent(prompt.resume)} continues automatically.` : ""}`} size={0.021} color="#dfe9f5" maxWidth={0.88} />
        <Label position={[-0.44, 0.09, 0.001]} text="EMAIL - STAY IN MIXED REALITY" size={0.023} color={C.solGreen} />
        <Label position={[-0.44, 0.048, 0.001]} text="Type your address here, we mail you a six-digit code, you type that here. You never take the headset off." size={0.021} color="#b8c7da" maxWidth={0.88} />
        <HoloButton position={[0, -0.03, 0.002]} w={0.34} label="Use email" accent={C.solGreen} onClick={() => { setErr(null); setStep("email"); }} />
        <Label position={[-0.44, -0.115, 0.001]} text="GOOGLE OR A SOLANA WALLET" size={0.023} color={C.frost} />
        <Label position={[-0.44, -0.155, 0.001]} text="These need a browser, so they open a tab and end Mixed Reality. Sign in there, then press Enter Mixed Reality again." size={0.021} color="#b8c7da" maxWidth={0.88} />
        <HoloButton position={[-0.17, -0.245, 0.002]} w={0.26} label="Later" accent={C.frost} onClick={() => setPrompt(null)} />
        <HoloButton position={[0.17, -0.245, 0.002]} w={0.3} icon="external" label="Open a tab" accent={C.cyan} onClick={() => {
          /* Try the tab straight from the press; if the browser blocks it outside a DOM gesture,
           * the flat page's sign-in panel (shown once the session ends) has a button that opens it. */
          const tab = auth.mode === "privy" ? window.open(signInUrl(), "rhea-signin") : null;
          void session?.end().catch(() => undefined);
          if (tab) tab.focus?.();
        }} />
      </group>
    );
  }

  if (step === "email") {
    return (
      <group>
        <Card w={0.96} h={0.82} accent={C.cyan} />
        {header(0.34, "YOUR EMAIL", busy ? "Sending your code..." : "We mail a six-digit code. Nothing leaves the headset.")}
        {err ? note(0.245, err) : !valid && addr ? note(0.245, "That does not look like an email address yet.", C.amber) : null}
        <TypedLine y={0.18} w={0.88} text={addr} placeholder="you@example.com" />
        <HoloKeyboard
          y={0.08}
          onKey={(ch) => { setErr(null); setAddr((v) => (v + ch).slice(0, 64)); }}
          onBackspace={() => setAddr((v) => v.slice(0, -1))}
          onDone={send}
          doneLabel={busy ? "..." : "Send"}
          doneEnabled={valid && !busy}
        />
        <HoloButton position={[-0.17, -0.28, 0.002]} w={0.26} label="Later" accent={C.frost} disabled={busy} onClick={() => setPrompt(null)} />
        <HoloButton position={[0.17, -0.28, 0.002]} w={0.3} label={remembered && addr === remembered ? "Other options" : "Back"} accent={C.frost} disabled={busy}
          onClick={() => { setErr(null); setStep("choose"); }} />
      </group>
    );
  }

  return (
    <group>
      <Card w={0.96} h={0.8} accent={C.solGreen} />
      {header(0.33, "ENTER YOUR CODE", `Six digits, sent to ${maskEmail(addr.trim())}. It may take a few seconds.`)}
      {err ? note(0.235, err) : busy ? note(0.235, "Checking...", C.amber) : null}
      {/* Six slots, so a mistyped digit is obvious without leaving the pad. */}
      <group position={[0, 0.165, 0.002]}>
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <group key={i} position={[(i - 2.5) * 0.072, 0, 0]}>
            <GlassRect w={0.062} h={0.072} r={0.012} top="#0d1224" bottom="#080b16"
              accent={i < code.length ? C.solGreen : C.frost} fill={0.6} rim={i < code.length ? 0.9 : 0.4}
              stroke={0.0022} bar={0} topBar={0} sheen={0} />
            <Text font={FONT_NUM} position={[0, -0.001, 0.002]} fontSize={0.032} color="#ffffff"
              anchorX="center" anchorY="middle" raycast={NO_RAYCAST} {...OUTLINE}>{code[i] ?? ""}</Text>
          </group>
        ))}
      </group>
      <HoloNumpad
        y={0.06}
        onKey={(d) => { setErr(null); setCode((v) => (v.length >= 6 ? v : v + d)); }}
        onBackspace={() => setCode((v) => v.slice(0, -1))}
        onDone={submit}
        doneEnabled={code.length === 6 && !busy}
      />
      <HoloButton position={[-0.3, -0.29, 0.002]} w={0.24} label="Back" accent={C.frost} disabled={busy}
        onClick={() => { setErr(null); setCode(""); setStep("email"); }} />
      <HoloButton position={[0, -0.29, 0.002]} w={0.26} label="Resend" accent={C.cyan} disabled={busy} onClick={send} />
      <HoloButton position={[0.3, -0.29, 0.002]} w={0.24} label="Later" accent={C.frost} disabled={busy} onClick={() => setPrompt(null)} />
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
  /* Mirrors DepositPanel: no amount attached means "show me my address". */
  const receiveOnly = prompt.neededUsd <= 0;
  return (
    <group>
      <Card w={0.84} h={0.56} accent={C.solGreen} />
      <Label position={[-0.38, 0.22, 0.001]} text={receiveOnly ? "RECEIVE USDC" : "FUND YOUR WALLET"} size={0.04} color="#ffffff" />
      <Label position={[-0.38, 0.175, 0.001]} text={receiveOnly ? "USDC on Solana" : `USDC on Solana · ${fmtUsd(Math.max(0, prompt.neededUsd - have))} more needed`} size={0.022} color="#b8c7da" />
      <Row y={0.11} label="Wallet USDC" value={fmtUsd(have)} />
      {receiveOnly ? null : <Row y={0.065} label="This trade needs" value={fmtUsd(prompt.neededUsd)} />}
      <Label position={[-0.38, 0.005, 0.001]} text="SEND USDC (SOLANA) TO" size={0.02} color="#b8c7da" />
      <Label position={[-0.38, -0.03, 0.001]} text={addr.slice(0, 22)} size={0.024} color={C.solGreen} />
      <Label position={[-0.38, -0.062, 0.001]} text={addr.slice(22)} size={0.024} color={C.solGreen} />
      <Label position={[-0.38, -0.115, 0.001]} text={`Solana network only; keep ~0.01 SOL for fees. Copy the address from the desktop panel.${prompt.resume ? " The trade continues when the USDC lands." : ""}`} size={0.021} color="#b8c7da" maxWidth={0.76} />
      <HoloButton position={[-0.19, -0.2, 0.002]} w={0.24} label={receiveOnly ? "Done" : "Later"} accent={C.frost} onClick={() => setPrompt(null)} />
      <HoloButton position={[0.19, -0.2, 0.002]} w={0.24} label={receiveOnly ? "Refresh" : "I've sent it"} accent={C.solGreen} onClick={() => void loadPortfolio()} />
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
  return (
    <group ref={ref}>
      {/* Status line hugs the globe; captions stack upward from it (bottom-anchored so wrapping grows up). */}
      {last.length ? (
        <Text font={FONT_BODY} position={[0, 0.03, 0]} fontSize={0.026} color="#e8f4ff" anchorX="center" anchorY="bottom" maxWidth={1.1} textAlign="center" lineHeight={1.35} {...OUTLINE}>
          {last.map((c) => `${c.role === "user" ? "You: " : "Rhea: "}${c.text.slice(-200)}`).join("\n")}
        </Text>
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

/** Publishes the idle card's bottom edge so the ticker hangs under it too. */
function IdleBox() {
  useLayoutEffect(() => { holoBox.bottom = -0.17; }, []);
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
      <IdleBox />
      <Frame w={1.0} h={0.3} y={-0.02} accent={C.sol} />
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
        {/* News belongs under the panel, and only while one of the browse panels is up. */}
        {!pendingTrade && !pendingOrder && !depositPrompt && !loginPrompt ? <NewsTicker /> : null}
      </group>
      <Captions />
      <VoiceOrb />
      <XRButtons />
      <ResultCues />
    </group>
  );
}
