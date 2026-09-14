/* CameraRig — owns the world group's rotation and the "virtual distance".
 *
 * Desktop: the camera dollies along +Z and the globe slides left when a
 * side panel is open. XR: the headset is the camera, so the group is placed
 * ~1.4 m in front of the user at chest height and scaled instead of moving
 * the camera. Both read the same rig targets, which AI tools and pointer
 * input write. */
import { useFrame, useThree } from "@react-three/fiber";
import { useXR } from "@react-three/xr";
import { useEffect, useRef, type ReactNode } from "react";
import * as THREE from "three";
import { COMPANY_BY_ID, COUNTRIES } from "@shared/registry";
import { REGION_BY_ID } from "@/state/regions";
import { useWorld } from "@/state/world";
import { clamp, damp } from "./geo";
import { DIST, endFlight, flyTo, releaseToWorld, rig, stepFlight } from "./rig";

const Y_AXIS = new THREE.Vector3(0, 1, 0);
const X_AXIS = new THREE.Vector3(1, 0, 0);
const AUTO_RATE = 0.10;      // rad/s idle drift
const IDLE_AFTER = 2.2;      // s before drift resumes

/* MR layout: the globe floats left of centre at chest height so the chart
 * cluster can float to the right, both within comfortable reach/view. */
export const XR_ANCHOR = new THREE.Vector3(-0.5, 1.3, -1.55);
export const XR_BASE_SCALE = 0.36;

export function CameraRig({ children }: { children: ReactNode }) {
  const group = useRef<THREE.Group>(null);
  const { camera } = useThree();
  const xrMode = useXR((s) => s.mode);
  const inXR = xrMode != null;

  const view = useWorld((s) => s.view);
  const focusedRegion = useWorld((s) => s.focusedRegion);
  const focusedCountry = useWorld((s) => s.focusedCountry);
  const focusedCompany = useWorld((s) => s.focusedCompany);
  const comparison = useWorld((s) => s.comparison);

  /* World-state → rig targets (the AI "moves the globe" through here).
   * Focusing flies there first and only then reveals the side panel (the
   * world store has a fallback timer if frames never run). */
  useEffect(() => {
    const target = view === "company" && focusedCompany
      ? { place: COMPANY_BY_ID[focusedCompany].headquarters ?? COUNTRIES[COMPANY_BY_ID[focusedCompany].countryCode], dist: DIST.company, offset: -0.62 }
      : view === "country" && focusedCountry
        ? { place: COUNTRIES[focusedCountry], dist: DIST.country, offset: -0.45 }
        : view === "region" && focusedRegion && REGION_BY_ID[focusedRegion]
          ? { place: REGION_BY_ID[focusedRegion], dist: DIST.region, offset: -0.4 }
          : null;
    if (target) {
      let stale = false;
      flyTo(target.place.lat, target.place.lng, target.dist, target.offset, () => { if (!stale) useWorld.getState().revealPanel(); });
      return () => { stale = true; };
    }
    if (comparison) {
      releaseToWorld();
      rig.targetOffsetX = -0.35;
      rig.autoRotate = false;
    } else {
      releaseToWorld();
    }
  }, [view, focusedRegion, focusedCountry, focusedCompany, comparison]);

  useFrame((_, rawDt) => {
    const dt = Math.min(0.05, rawDt);
    const g = group.current;
    if (!g) return;

    if (rig.dragging) endFlight();
    /* Flights run on wall-clock time so they last the same on slow devices
     * (the 0.05 s cap only protects the damping below). */
    const flying = stepFlight(Math.min(0.25, rawDt));
    if (flying) {
      /* the flight owns yaw/pitch/dist/offset this frame */
    } else if (!rig.dragging) {
      if (rig.tweening) {
        rig.yaw = damp(rig.yaw, rig.targetYaw, 4.2, dt);
        rig.pitch = damp(rig.pitch, rig.targetPitch, 4.2, dt);
        if (Math.abs(rig.yaw - rig.targetYaw) < 0.002 && Math.abs(rig.pitch - rig.targetPitch) < 0.002) rig.tweening = false;
      } else {
        /* inertia after a fling, then a slow drift once idle */
        rig.yaw += rig.vy * dt;
        rig.pitch = clamp(rig.pitch + rig.vp * dt, -1.35, 1.35);
        const k = Math.pow(0.04, dt);
        rig.vy *= k; rig.vp *= k;
        rig.idleT += dt;
        if (rig.autoRotate && rig.idleT > IDLE_AFTER && Math.abs(rig.vy) < 0.03) {
          rig.yaw += AUTO_RATE * dt * clamp((rig.idleT - IDLE_AFTER) / 1.2, 0, 1);
        }
        rig.targetYaw = rig.yaw; rig.targetPitch = rig.pitch;
      }
    }
    if (!flying) {
      rig.dist = damp(rig.dist, rig.targetDist, 3.6, dt);
      rig.offsetX = damp(rig.offsetX, inXR ? 0 : rig.targetOffsetX, 4, dt);
    }

    g.rotation.set(0, 0, 0);
    g.rotateOnWorldAxis(Y_AXIS, rig.yaw);
    g.rotateOnWorldAxis(X_AXIS, rig.pitch);

    if (inXR) {
      /* Zoom by scaling the world toward the user; keep it comfortably sized. */
      const s = XR_BASE_SCALE * Math.pow(DIST.world / rig.dist, 0.62);
      g.scale.setScalar(s);
      g.position.set(XR_ANCHOR.x, XR_ANCHOR.y - (s - XR_BASE_SCALE) * 0.25, XR_ANCHOR.z + (s - XR_BASE_SCALE) * 0.35);
    } else {
      g.scale.setScalar(1);
      g.position.set(0, 0, 0);
      /* Portrait viewports would crop the planet horizontally: back off. */
      const aspect = (camera as THREE.PerspectiveCamera).aspect || 1;
      const fit = Math.max(1, 1.05 / aspect);
      const d = rig.dist * fit;
      /* Panel offset shrinks on narrow viewports where the panel overlays instead. */
      const ox = -rig.offsetX * (d / DIST.world) * Math.min(1, Math.max(0, (aspect - 0.9) / 0.6));
      camera.position.set(ox, 0, d);
      camera.lookAt(ox, 0, 0);
    }
  });

  return <group ref={group}>{children}</group>;
}
