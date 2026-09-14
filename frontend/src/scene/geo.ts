/* Spherical helpers. Matches three's default SphereGeometry UV layout, so an
 * equirectangular map (lng −180 at x=0) lines up with these positions. */
import * as THREE from "three";

export const R = 1; // planet radius in scene units

/** Latitude/longitude (degrees) → point on a sphere of radius r. */
export function latLngToVec3(lat: number, lng: number, r = R, out = new THREE.Vector3()) {
  const phi = (90 - lat) * (Math.PI / 180);
  const theta = (lng + 180) * (Math.PI / 180);
  return out.set(-r * Math.sin(phi) * Math.cos(theta), r * Math.cos(phi), r * Math.sin(phi) * Math.sin(theta));
}

/** Yaw/pitch (radians) that bring lat/lng to face the +Z camera when applied
 * as rotateOnWorldAxis(Y, yaw) then rotateOnWorldAxis(X, pitch). */
export function facingRotation(lat: number, lng: number) {
  return { yaw: -Math.PI / 2 - lng * (Math.PI / 180), pitch: lat * (Math.PI / 180) };
}

/** Shortest-path unwrap so a yaw tween never spins the long way round. */
export function nearestAngle(target: number, current: number) {
  const twoPi = Math.PI * 2;
  let t = target;
  while (t - current > Math.PI) t -= twoPi;
  while (t - current < -Math.PI) t += twoPi;
  return t;
}

/** Great-circle arc lifted above the surface, for connection lines. */
export function arcPoints(a: THREE.Vector3, b: THREE.Vector3, segments = 48, lift = 0.28) {
  const pts: THREE.Vector3[] = [];
  const angle = a.angleTo(b);
  const height = R * (0.08 + lift * Math.min(1, angle / Math.PI) * 1.6);
  const tmp = new THREE.Vector3();
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    /* slerp on the sphere, then push outward with a sine bulge */
    tmp.copy(a).lerp(b, t).normalize();
    const bulge = Math.sin(t * Math.PI) * height;
    tmp.multiplyScalar(R + bulge);
    pts.push(tmp.clone());
  }
  return pts;
}

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
export const damp = (cur: number, target: number, lambda: number, dt: number) => THREE.MathUtils.damp(cur, target, lambda, dt);
