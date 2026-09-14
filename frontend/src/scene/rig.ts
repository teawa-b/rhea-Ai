/* Camera / globe rig state — mutable, frame-rate data kept outside React.
 *
 * Both desktop and XR drive the same numbers: yaw/pitch rotate the world
 * group, `dist` is the virtual camera distance. On desktop the camera really
 * moves; in XR the user's head is the camera, so the group is scaled and
 * shifted instead (see CameraRig). */
import { clamp, facingRotation, nearestAngle } from "./geo";

export const DIST: { world: number; country: number; company: number } = { world: 4.8, country: 2.9, company: 2.3 };

export const rig: {
  yaw: number; pitch: number; vy: number; vp: number; dist: number; offsetX: number;
  targetYaw: number; targetPitch: number; targetDist: number; targetOffsetX: number;
  dragging: boolean; idleT: number; autoRotate: boolean; tweening: boolean; lastUserInput: number;
} = {
  yaw: -Math.PI / 2 + 98 * (Math.PI / 180), // start facing the US-ish
  pitch: 0.36,
  vy: 0,
  vp: 0,
  dist: DIST.world,
  offsetX: 0,           // desktop: shift globe left when a panel is open
  targetYaw: -Math.PI / 2 + 98 * (Math.PI / 180),
  targetPitch: 0.36,
  targetDist: DIST.world,
  targetOffsetX: 0,
  dragging: false,
  idleT: 0,
  autoRotate: true,
  /** while true the tween owns yaw/pitch (user drag cancels it) */
  tweening: false,
  lastUserInput: 0,
};

/* Scripted camera flight for "take me there": rotate to face the place first
 * (pulling back a little on long jumps), then zoom in and slide the globe
 * aside, then report arrival so the UI can reveal its panel. */
type Flight = {
  yaw0: number; pitch0: number; dist0: number; off0: number;
  yaw1: number; pitch1: number; distMid: number; dist1: number; offMid: number; off1: number;
  rotateS: number; zoomS: number; t: number;
  onArrive?: () => void;
};
let flight: Flight | null = null;

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const reducedMotion = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Starts a flight and returns its duration in seconds. */
export function flyTo(lat: number, lng: number, dist: number, offsetX: number, onArrive?: () => void): number {
  const f = facingRotation(lat, lng);
  const yaw1 = nearestAngle(f.yaw, rig.yaw);
  const pitch1 = clamp(f.pitch, -1.2, 1.2);
  const angle = Math.hypot((yaw1 - rig.yaw) * Math.cos((pitch1 + rig.pitch) / 2), pitch1 - rig.pitch);
  const speed = reducedMotion() ? 0.35 : 1;
  const rotateS = angle < 0.03 ? 0 : clamp(0.55 + angle * 0.5, 0.65, 1.5) * speed;
  /* Long jumps back off and re-centre so the planet is readable mid-turn. */
  const long = angle > 0.45;
  const distMid = long ? Math.max(rig.dist, Math.min(DIST.world, dist + angle * 1.1)) : rig.dist;
  const offMid = long ? 0 : rig.offsetX;
  const zoomS = Math.abs(distMid - dist) < 0.02 && Math.abs(offMid - offsetX) < 0.02 ? 0 : clamp(0.5 + Math.abs(distMid - dist) * 0.3, 0.55, 1.0) * speed;
  flight = { yaw0: rig.yaw, pitch0: rig.pitch, dist0: rig.dist, off0: rig.offsetX, yaw1, pitch1, distMid, dist1: dist, offMid, off1: offsetX, rotateS, zoomS, t: 0, onArrive };
  rig.targetYaw = yaw1; rig.targetPitch = pitch1; rig.targetDist = dist; rig.targetOffsetX = offsetX;
  rig.tweening = false; rig.autoRotate = false; rig.vy = 0; rig.vp = 0;
  return rotateS + zoomS;
}

/** Advances the active flight; returns false when none is running. */
export function stepFlight(dt: number): boolean {
  const fl = flight;
  if (!fl) return false;
  fl.t += dt;
  const r = fl.rotateS ? clamp(fl.t / fl.rotateS, 0, 1) : 1;
  const z = fl.zoomS ? clamp((fl.t - fl.rotateS) / fl.zoomS, 0, 1) : 1;
  const er = ease(r), ez = ease(z);
  rig.yaw = lerp(fl.yaw0, fl.yaw1, er);
  rig.pitch = lerp(fl.pitch0, fl.pitch1, er);
  rig.dist = z > 0 ? lerp(fl.distMid, fl.dist1, ez) : lerp(fl.dist0, fl.distMid, er);
  rig.offsetX = z > 0 ? lerp(fl.offMid, fl.off1, ez) : lerp(fl.off0, fl.offMid, er);
  if (r >= 1 && z >= 1) endFlight();
  return true;
}

/** Ends the flight where it is (user grabbed the globe) and still reveals the UI. */
export function endFlight() {
  const fl = flight;
  if (!fl) return;
  flight = null;
  rig.targetYaw = rig.yaw; rig.targetPitch = rig.pitch;
  fl.onArrive?.();
}

export function faceLatLng(lat: number, lng: number, dist?: number) {
  const f = facingRotation(lat, lng);
  rig.targetYaw = nearestAngle(f.yaw, rig.yaw);
  rig.targetPitch = clamp(f.pitch, -1.2, 1.2);
  if (dist != null) rig.targetDist = dist;
  rig.tweening = true;
  rig.autoRotate = false;
  rig.vy = 0; rig.vp = 0;
}

export function setDistance(dist: number) {
  rig.targetDist = clamp(dist, 1.2, 6);
  rig.tweening = true;
}

export function userNudge(dYaw: number, dPitch: number) {
  endFlight();
  rig.yaw += dYaw;
  rig.pitch = clamp(rig.pitch + dPitch, -1.35, 1.35);
  rig.targetYaw = rig.yaw;
  rig.targetPitch = rig.pitch;
  rig.tweening = false;
  rig.autoRotate = false;
  rig.idleT = 0;
  rig.lastUserInput = performance.now();
}

export function userZoom(factor: number) {
  endFlight();
  rig.targetDist = clamp(rig.targetDist * factor, 1.2, 6);
  rig.tweening = true;
  rig.lastUserInput = performance.now();
}

export function releaseToWorld() {
  flight = null;
  rig.targetDist = DIST.world;
  rig.targetPitch = 0.36;
  rig.targetOffsetX = 0;
  rig.tweening = true;
  rig.autoRotate = true;
}
