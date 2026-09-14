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
  rig.targetDist = clamp(rig.targetDist * factor, 1.2, 6);
  rig.tweening = true;
  rig.lastUserInput = performance.now();
}

export function releaseToWorld() {
  rig.targetDist = DIST.world;
  rig.targetPitch = 0.36;
  rig.targetOffsetX = 0;
  rig.tweening = true;
  rig.autoRotate = true;
}
