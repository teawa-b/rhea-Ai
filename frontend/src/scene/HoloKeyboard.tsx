/* In-headset text entry (spec §13).
 *
 * Quest will not raise its system keyboard for a WebGL surface, and an
 * immersive session hides the DOM, so signing in used to mean leaving Mixed
 * Reality. These are the two keyboards that keep the user inside it: a compact
 * QWERTY for an email address and a numpad for the six-digit code.
 *
 * Keys are drawn with the same glass as the rest of the panels, but smaller and
 * quicker: a key is a hit plane plus one GlassRect, and the hover/press spring
 * is local to this file so the keyboard never pulls on XRPanels.
 */
import { Text } from "@react-three/drei";
import { useFrame, type ThreeEvent } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { C } from "@/theme";
import { FONT_BODY, FONT_BOLD, FONT_NUM } from "./fonts";
import { GlassRect, NO_RAYCAST, UNIT_PLANE, type GlassMaterial } from "./glass";
import { feel } from "./xrFeedback";

const PANEL_DARK = new THREE.Color("#0b0f1c");
const OUTLINE = { outlineWidth: 0.003, outlineColor: "#05060d", outlineOpacity: 0.9 } as const;

/** Key metrics. Keys are ~5 cm at arm's length, which is comfortable for a controller ray and a pinch alike. */
const KEY_W = 0.054, KEY_H = 0.048, GAP = 0.007;
const STEP_X = KEY_W + GAP, STEP_Y = KEY_H + GAP;

/** Hover/press glow, local so this file stands alone (XRPanels keeps its own for pills). */
function useKeySpring(accent: string, wide: boolean) {
  const group = useRef<THREE.Group>(null);
  const mat = useRef<GlassMaterial>(null);
  const hover = useRef(false);
  const pressed = useRef(false);
  const g = useRef(0);
  useFrame((_, dt) => {
    const k = 1 - Math.exp(-Math.min(dt, 0.1) * 20);
    const target = pressed.current ? 1 : hover.current ? 0.8 : 0.12;
    g.current += (target - g.current) * k;
    const s = pressed.current ? 0.93 : hover.current ? 1.05 : 1;
    if (group.current) group.current.scale.setScalar(group.current.scale.x + (s - group.current.scale.x) * k);
    const m = mat.current;
    if (!m) return;
    m.uniforms.uGlow.value = g.current * 0.5;
    m.uniforms.uFill.value = (wide ? 0.7 : 0.58) + g.current * 0.28;
    m.uniforms.uRim.value = 0.3 + g.current * 0.7;
  });
  const [top, bottom] = useMemo(() => {
    const acc = new THREE.Color(accent);
    return [PANEL_DARK.clone().lerp(acc, wide ? 0.3 : 0.14), PANEL_DARK.clone().lerp(acc, 0.03)];
  }, [accent, wide]);
  return { group, mat, hover, pressed, top, bottom };
}

function Key({ x, y, label, onPress, w = KEY_W, accent = C.cyan, mono, ink = "#ffffff" }: {
  x: number; y: number; label: string; onPress: () => void; w?: number; accent?: string; mono?: boolean; ink?: string;
}) {
  const wide = w > KEY_W;
  const s = useKeySpring(accent, wide);
  const stop = (e: ThreeEvent<PointerEvent | MouseEvent>) => e.stopPropagation();
  /* A long cap ("Done", ".com") keeps its text inside the key. */
  const size = label.length > 3 ? 0.018 : label.length > 1 ? 0.02 : 0.024;
  return (
    <group position={[x, y, 0]}>
      <group ref={s.group}>
        <GlassRect ref={s.mat} w={w} h={KEY_H} r={0.011} pad={0.016} top={s.top} bottom={s.bottom} accent={accent}
          stroke={0.0022} sheen={0.1} bar={0} topBar={0} />
        <mesh
          geometry={UNIT_PLANE}
          scale={[w, KEY_H, 1]}
          onClick={(e) => { stop(e); onPress(); }}
          onPointerDown={(e) => { stop(e); s.pressed.current = true; feel.press(e); }}
          onPointerUp={(e) => { stop(e); s.pressed.current = false; }}
          onPointerOver={(e) => { stop(e); s.hover.current = true; feel.hover(e); }}
          onPointerOut={() => { s.hover.current = false; s.pressed.current = false; }}>
          <meshBasicMaterial visible={false} />
        </mesh>
        <Text font={mono ? FONT_NUM : wide ? FONT_BOLD : FONT_BODY} position={[0, -0.001, 0.003]} fontSize={size}
          color={ink} anchorX="center" anchorY="middle" raycast={NO_RAYCAST} {...OUTLINE}>
          {label}
        </Text>
      </group>
    </group>
  );
}

/** What the user has typed so far, on its own strip, with a blinking caret. */
export function TypedLine({ y, w, text, placeholder, mono, size = 0.028 }: {
  y: number; w: number; text: string; placeholder: string; mono?: boolean; size?: number;
}) {
  const caret = useRef<THREE.Mesh>(null);
  useFrame((s) => { if (caret.current) (caret.current.material as THREE.MeshBasicMaterial).opacity = Math.sin(s.clock.elapsedTime * 3.4) > 0 ? 0.9 : 0.1; });
  const shown = text || placeholder;
  return (
    <group position={[0, y, 0]}>
      <GlassRect position={[0, 0, -0.001]} w={w} h={0.062} r={0.012} top="#0d1224" bottom="#080b16" accent={C.cyan}
        fill={0.6} rim={0.5} stroke={0.0022} bar={0} topBar={0} sheen={0} />
      <Text font={mono ? FONT_NUM : FONT_BODY} position={[0, -0.001, 0.002]} fontSize={size}
        color={text ? "#ffffff" : "#6f8196"} anchorX="center" anchorY="middle" letterSpacing={mono ? 0.22 : 0}
        maxWidth={w - 0.05} raycast={NO_RAYCAST} {...OUTLINE}>
        {shown}
      </Text>
      {/* Caret rides just past the text, so it reads as a live field rather than a label. */}
      <mesh ref={caret} position={[Math.min(w / 2 - 0.02, (text.length * size * (mono ? 0.78 : 0.5)) / 2 + 0.012), 0, 0.002]} raycast={NO_RAYCAST}>
        <planeGeometry args={[0.003, size * 1.15]} />
        <meshBasicMaterial color={C.cyan} transparent toneMapped={false} />
      </mesh>
    </group>
  );
}

const ROWS = ["1234567890", "qwertyuiop", "asdfghjkl", "zxcvbnm"];

/** Compact QWERTY for an email address: digits, letters, then the keys an address actually needs. */
export function HoloKeyboard({ y, onKey, onBackspace, onDone, doneLabel = "Done", doneEnabled = true }: {
  y: number; onKey: (ch: string) => void; onBackspace: () => void; onDone: () => void; doneLabel?: string; doneEnabled?: boolean;
}) {
  return (
    <group position={[0, y, 0.002]}>
      {ROWS.map((row, r) => {
        const chars = row.split("");
        const x0 = -((chars.length - 1) * STEP_X) / 2;
        return chars.map((ch, i) => (
          <Key key={ch} x={x0 + i * STEP_X} y={-r * STEP_Y} label={ch} mono={r === 0} onPress={() => onKey(ch)} />
        ));
      })}
      {/* Address row: the punctuation an email needs, a .com shortcut, delete, and the commit key. */}
      <group position={[0, -4 * STEP_Y, 0]}>
        <Key x={-2.42 * STEP_X} y={0} label="@" onPress={() => onKey("@")} accent={C.violet} />
        <Key x={-1.42 * STEP_X} y={0} label="." onPress={() => onKey(".")} accent={C.violet} />
        <Key x={-0.1 * STEP_X} y={0} w={KEY_W * 1.6} label=".com" onPress={() => onKey(".com")} accent={C.violet} />
        <Key x={1.3 * STEP_X} y={0} w={KEY_W * 1.2} label="DEL" onPress={onBackspace} accent={C.magenta} />
        <Key x={2.75 * STEP_X} y={0} w={KEY_W * 1.6} label={doneLabel} onPress={() => { if (doneEnabled) onDone(); }}
          accent={doneEnabled ? C.solGreen : C.frost} ink={doneEnabled ? "#ffffff" : "#6f8196"} />
      </group>
    </group>
  );
}

/** Numpad for the six-digit code: 1-9, then delete / 0 / submit. */
export function HoloNumpad({ y, onKey, onBackspace, onDone, doneLabel = "Sign in", doneEnabled }: {
  y: number; onKey: (ch: string) => void; onBackspace: () => void; onDone: () => void; doneLabel?: string; doneEnabled: boolean;
}) {
  const w = KEY_W * 1.25, stepX = w + GAP;
  return (
    <group position={[0, y, 0.002]}>
      {[0, 1, 2, 3].map((r) =>
        [0, 1, 2].map((c) => {
          const x = (c - 1) * stepX, ky = -r * STEP_Y;
          if (r < 3) { const d = String(r * 3 + c + 1); return <Key key={d} x={x} y={ky} w={w} label={d} mono onPress={() => onKey(d)} />; }
          if (c === 0) return <Key key="del" x={x} y={ky} w={w} label="DEL" onPress={onBackspace} accent={C.magenta} />;
          if (c === 1) return <Key key="0" x={x} y={ky} w={w} label="0" mono onPress={() => onKey("0")} />;
          return <Key key="go" x={x} y={ky} w={w} label="GO" onPress={() => { if (doneEnabled) onDone(); }}
            accent={doneEnabled ? C.solGreen : C.frost} ink={doneEnabled ? "#ffffff" : "#6f8196"} />;
        }),
      )}
      {/* The submit key is narrow, so the action is spelled out beside the pad. */}
      <Text font={FONT_BODY} position={[0, -4 * STEP_Y + 0.006, 0]} fontSize={0.018} color="#8ea3bd"
        anchorX="center" anchorY="middle" raycast={NO_RAYCAST} {...OUTLINE}>
        {doneEnabled ? `GO — ${doneLabel.toLowerCase()}` : "enter all six digits"}
      </Text>
    </group>
  );
}
