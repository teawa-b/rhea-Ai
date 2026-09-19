/* Gyroscope orientation for the phone camera view (no WebXR, e.g. iOS Safari).
 *
 * The device's orientation sensor drives the Three camera, so the globe is
 * anchored to a direction in the room and stays there when the phone turns
 * (3-DoF: rotation only — walking around it isn't tracked, that needs ARCore).
 * Same maths as Three's DeviceOrientationControls; kept out of React and read
 * per frame by CameraRig. */
import * as THREE from "three";

export const gyro = {
  /** Listening and at least one sample has arrived. */
  active: false,
  /** Camera orientation from the latest sample. */
  q: new THREE.Quaternion(),
  /** Set when the next frame should re-anchor the globe to where the phone points. */
  recalibrate: true,
};

const _euler = new THREE.Euler();
const _q0 = new THREE.Quaternion();
const _q1 = new THREE.Quaternion(-Math.SQRT1_2, 0, 0, Math.SQRT1_2); // -90° about X: device frame → camera looks out of the screen
const _z = new THREE.Vector3(0, 0, 1);
const D2R = Math.PI / 180;

let listening: ((e: DeviceOrientationEvent) => void) | null = null;

function screenAngle(): number {
  const o = window.screen?.orientation?.angle;
  if (typeof o === "number") return o;
  const w = (window as unknown as { orientation?: number }).orientation;
  return typeof w === "number" ? w : 0;
}

type PermissionedDOE = typeof DeviceOrientationEvent & { requestPermission?: () => Promise<"granted" | "denied"> };

/** Asks for the sensor (iOS 13+ needs a gesture-scoped permission), then waits briefly for a first sample.
 * Resolves false when the device has no usable orientation sensor. */
export async function startGyro(): Promise<boolean> {
  if (listening) return gyro.active;
  if (typeof DeviceOrientationEvent === "undefined") return false;
  try {
    const req = (DeviceOrientationEvent as PermissionedDOE).requestPermission;
    if (req && (await req.call(DeviceOrientationEvent)) !== "granted") return false;
  } catch { /* not iOS, or already decided; fall through and see whether events arrive */ }
  return new Promise<boolean>((resolve) => {
    let settled = false;
    const on = (e: DeviceOrientationEvent) => {
      if (e.alpha == null || e.beta == null || e.gamma == null) return;
      _euler.set(e.beta * D2R, e.alpha * D2R, -e.gamma * D2R, "YXZ");
      gyro.q.setFromEuler(_euler).multiply(_q1).multiply(_q0.setFromAxisAngle(_z, -screenAngle() * D2R));
      if (!gyro.active) { gyro.active = true; gyro.recalibrate = true; }
      if (!settled) { settled = true; resolve(true); }
    };
    listening = on;
    window.addEventListener("deviceorientation", on, true);
    setTimeout(() => { if (!settled) { settled = true; if (!gyro.active) stopGyro(); resolve(gyro.active); } }, 1500);
  });
}

export function stopGyro() {
  if (listening) window.removeEventListener("deviceorientation", listening, true);
  listening = null;
  gyro.active = false;
  gyro.recalibrate = true;
}
