/* Touch gestures for the globe that don't depend on hitting the planet mesh.
 *
 * Pinch (two fingers) zooms everywhere — phones had no zoom at all before,
 * only the mouse wheel. One-finger drag from empty screen spins the globe
 * only where asked (`dragAnywhere`): in handheld AR the canvas is not the
 * element receiving touches (the DOM overlay is), so the mesh's own drag
 * handler in Globe.tsx never sees them. Touches that start on a button,
 * link, input or panel are left alone. */
import { useEffect, type RefObject } from "react";
import { DIST, rig, userNudge, userZoom } from "@/scene/rig";

/** A touch that moves less than this, for less than this long, is a tap rather than a drag. */
const TAP_PX = 12;
const TAP_MS = 400;

const INTERACTIVE = ".clickable, button, a, input, select, textarea, [role=dialog]";

type P = { x: number; y: number };

export function useGlobeGestures(
  ref: RefObject<HTMLElement | null>,
  opts: { dragAnywhere: boolean; enabled?: boolean; /** fired when a touch on empty screen was a tap, not a drag */ onTap?: (x: number, y: number) => void },
) {
  const { dragAnywhere, enabled = true, onTap } = opts;
  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled) return;
    const pts = new Map<number, P>();
    let drag: (P & { id: number }) | null = null;
    let pinch: { d: number } | null = null;
    let tap: { id: number; x: number; y: number; t: number; moved: number } | null = null;

    const interactive = (t: EventTarget | null) => t instanceof Element && Boolean(t.closest(INTERACTIVE));
    const dist = () => { const [a, b] = [...pts.values()]; return Math.hypot(a.x - b.x, a.y - b.y); };

    const down = (e: PointerEvent) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      if (interactive(e.target)) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size === 1) tap = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now(), moved: 0 };
      if (pts.size === 2) {
        pinch = { d: dist() };
        drag = null;
        tap = null;
        rig.pinching = true;
        rig.dragging = false;
      } else if (pts.size === 1 && dragAnywhere && !rig.dragging) {
        /* rig.dragging already set means the planet mesh (Globe.tsx, listening on the canvas below) took this touch. */
        drag = { id: e.pointerId, x: e.clientX, y: e.clientY };
        rig.dragging = true; rig.vy = 0; rig.vp = 0; rig.tweening = false;
      }
    };
    const move = (e: PointerEvent) => {
      const p = pts.get(e.pointerId);
      if (!p) return;
      if (tap && tap.id === e.pointerId) tap.moved += Math.abs(e.clientX - p.x) + Math.abs(e.clientY - p.y);
      p.x = e.clientX; p.y = e.clientY;
      if (pinch && pts.size >= 2) {
        const d = dist();
        if (d > 0 && pinch.d > 0) {
          const f = pinch.d / d;
          /* Direct: the target follows the fingers; damping in CameraRig smooths the rest. */
          if (Math.abs(f - 1) > 0.002) userZoom(Math.min(1.25, Math.max(0.8, f)));
        }
        pinch.d = d;
        return;
      }
      if (drag && drag.id === e.pointerId) {
        const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
        drag.x = e.clientX; drag.y = e.clientY;
        const k = 0.0062 * (rig.dist / DIST.world);
        userNudge(dx * k, dy * k);
        rig.vy = dx * k * 14; rig.vp = dy * k * 14;
        rig.dragging = true;
      }
    };
    const up = (e: PointerEvent) => {
      if (!pts.delete(e.pointerId)) return;
      if (pinch && pts.size < 2) { pinch = null; rig.pinching = false; rig.idleT = 0; }
      if (drag && drag.id === e.pointerId) { drag = null; rig.dragging = false; rig.idleT = 0; }
      if (tap && tap.id === e.pointerId) {
        const t = tap;
        tap = null;
        if (onTap && t.moved < TAP_PX && performance.now() - t.t < TAP_MS) onTap(e.clientX, e.clientY);
      }
    };

    el.addEventListener("pointerdown", down);
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
    return () => {
      el.removeEventListener("pointerdown", down);
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
      pts.clear(); rig.pinching = false;
      if (drag) rig.dragging = false;
      tap = null;
    };
  }, [ref, dragAnywhere, enabled, onTap]);
}
