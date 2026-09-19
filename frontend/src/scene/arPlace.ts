/* Where the globe sits in AR, and the taps that move it.
 *
 * Two anchors, one per handheld path:
 *   camera view (gyro)  `dir` — a unit direction from the viewer. Tapping the
 *                       feed re-aims it at the tapped pixel.
 *   WebXR (Android)     `point` — a world position from a real hit test, so
 *                       the globe rests on the floor or table you tapped.
 *                       `null` means "the default spot in front of you".
 *
 * A tap that the scene already handled (dragging the globe, opening a company)
 * must not also move the planet, so those paths stamp `consumeTap()` and the
 * placement waits a beat before deciding. */
import * as THREE from "three";

export const arAnchor = {
  /** Camera-view anchor: unit direction from the viewer. */
  dir: new THREE.Vector3(0, 0, -1),
  /** WebXR anchor: a world point the globe sits at, or null for the default spot. */
  point: null as THREE.Vector3 | null,
  /** True when `point` came from a real surface, so the globe rests on it rather than floating. */
  onSurface: false,
  /** Latest hit-test position while in WebXR, or null when no surface is in view. */
  hit: null as THREE.Vector3 | null,
};

/** Cleared on exit so the next session starts in front of the user. */
export function resetAnchor() {
  arAnchor.dir.set(0, 0, -1);
  arAnchor.point = null;
  arAnchor.onSurface = false;
  arAnchor.hit = null;
}

/* ---------------- taps ---------------- */

let consumedAt = 0;
/** Called by anything that handled a touch itself (globe drag, marker focus). */
export function consumeTap() { consumedAt = performance.now(); }
export function tapWasConsumed() { return performance.now() - consumedAt < 500; }

export type TapListener = (x: number, y: number) => void;
const listeners = new Set<TapListener>();

export function onArTap(fn: TapListener): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/** A tap on empty screen. Deferred so a WebXR `select` landing on the globe (which
 * arrives on the next XR frame, after the DOM touch) can still claim it first. */
export function emitArTap(x: number, y: number) {
  setTimeout(() => {
    if (tapWasConsumed()) return;
    for (const fn of listeners) fn(x, y);
  }, 130);
}
