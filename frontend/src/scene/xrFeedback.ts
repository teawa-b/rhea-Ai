/* Touch and sound for in-headset UI. Controllers get a short haptic pulse on
 * hover and press; presses, confirmations and refusals also get tiny
 * synthesized sounds (Web Audio, no assets), which carry the feedback for hand
 * tracking where there is no actuator. Everything is a no-op outside XR, so
 * shared components (HoloLabel) stay silent on the desktop. */
import { isXRInputSourceState } from "@react-three/xr";

type Actuator = { pulse?: (intensity: number, ms: number) => Promise<boolean> };

/** The XR input source behind a pointer event, if any. */
function xrSource(e: unknown) {
  const state = (e as { pointerState?: unknown } | null)?.pointerState;
  return isXRInputSourceState(state) ? state : null;
}

/** A haptic pulse on one input source (no sound). */
export function buzz(source: XRInputSource | undefined, intensity: number, ms: number) {
  pulse(source, intensity, ms);
}

function pulse(source: XRInputSource | undefined, intensity: number, ms: number) {
  const act = source?.gamepad?.hapticActuators?.[0] as Actuator | undefined;
  act?.pulse?.(intensity, ms)?.catch(() => undefined);
}

let ctx: AudioContext | null = null;
function audio() {
  if (!ctx) { try { ctx = new AudioContext(); } catch { return null; } }
  if (ctx.state === "suspended") void ctx.resume().catch(() => undefined);
  return ctx;
}

/** One enveloped oscillator note, optionally gliding to `to` Hz. */
function tone(freq: number, dur: number, gain: number, { type = "sine" as OscillatorType, delay = 0, to }: { type?: OscillatorType; delay?: number; to?: number } = {}) {
  const a = audio();
  if (!a) return;
  const t = a.currentTime + delay;
  const osc = a.createOscillator();
  const g = a.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (to) osc.frequency.exponentialRampToValueAtTime(to, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.006);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g).connect(a.destination);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

const sound = {
  press: () => tone(760, 0.07, 0.08, { type: "triangle", to: 540 }),
  deny: () => tone(210, 0.12, 0.07, { type: "square", to: 160 }),
  success: () => { tone(880, 0.12, 0.06); tone(1320, 0.22, 0.05, { delay: 0.08 }); },
  error: () => { tone(330, 0.12, 0.06, { type: "triangle" }); tone(247, 0.2, 0.06, { type: "triangle", delay: 0.1 }); },
};

/** Pointer-driven feedback for scene buttons (pass the R3F event). */
export const feel = {
  hover(e: unknown) { const s = xrSource(e); if (s) pulse(s.inputSource, 0.12, 10); },
  press(e: unknown) { const s = xrSource(e); if (!s) return; pulse(s.inputSource, 0.45, 22); sound.press(); },
  deny(e: unknown) { const s = xrSource(e); if (!s) return; pulse(s.inputSource, 0.2, 45); sound.deny(); },
};

/** Session-wide cues (no pointer): a controller button, a trade landing. */
export function cue(session: XRSession | null | undefined, kind: "press" | "success" | "error", hand?: XRHandedness) {
  if (!session) return;
  for (const src of session.inputSources) {
    if (hand && src.handedness !== hand) continue;
    pulse(src, kind === "press" ? 0.4 : 0.7, kind === "press" ? 20 : 60);
  }
  sound[kind]();
}
