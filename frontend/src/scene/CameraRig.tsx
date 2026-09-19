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
import { useMarket } from "@/state/market";
import { REGION_BY_ID } from "@/state/regions";
import { useWorld } from "@/state/world";
import { clamp, damp } from "./geo";
import { arAnchor } from "./arPlace";
import { gyro } from "./gyro";
import { useHandheld } from "./handheld";
import { DIST, endFlight, flyTo, releaseToWorld, rig, stepFlight } from "./rig";

const Y_AXIS = new THREE.Vector3(0, 1, 0);
const X_AXIS = new THREE.Vector3(1, 0, 0);
const AUTO_RATE = 0.10;      // rad/s idle drift
const IDLE_AFTER = 2.2;      // s before drift resumes

/* MR layout: the globe floats left of centre at chest height so the chart
 * cluster can float to the right, both within comfortable reach/view.
 *
 * In a headset the globe is placed by its *surface*, not its centre: the
 * focused spot always sits at a "focal" point and is turned to face the
 * user's head, so zooming to Taiwan brings Taiwan toward you instead of
 * inflating the planet around a point you were viewing at an angle. While a
 * chart (or a confirmation) is showing, the globe tucks itself down-left and
 * shrinks so the chart and the captions beneath the globe get the space. */
export const XR_ANCHOR = new THREE.Vector3(-0.5, 1.3, -1.55);
export const XR_BASE_SCALE = 0.36;
/* Surface focal point + scale per state (metres, local-floor space). */
const XR_FOCAL_WORLD = new THREE.Vector3(-0.24, 1.32, -1.15);
const XR_FOCAL_NEAR = new THREE.Vector3(-0.34, 1.46, -0.9);
const XR_FOCAL_CHART = new THREE.Vector3(-0.72, 1.16, -1.25);
const XR_SCALE_NEAR = 0.54;
const XR_SCALE_CHART = 0.26;
/* Handheld AR (a phone, WebXR): the globe is a world-locked object — a fixed
 * centre in the room, never turned toward the user, so ARCore tracking does
 * the rest and you can walk around it. Zooming scales it in place; while a
 * DOM panel covers the lower half of the screen it rises above the sheet. */
const HH_CENTER = new THREE.Vector3(0, 1.22, -1.0);
const HH_CENTER_PANEL = new THREE.Vector3(0, 1.62, -1.0);
const HH_BASE_SCALE = 0.28;
const HH_SCALE_NEAR = 0.4;
const HH_SCALE_PANEL = 0.19;
/* Camera view with gyroscope: the globe is anchored on the ray the phone pointed
 * along when AR started (or when the user re-centred), at this distance. The
 * render FOV is widened toward a phone camera's so the anchor holds against
 * the live feed as the phone turns. */
const GYRO_FOV = 64;
const DESKTOP_FOV = 38;
/** How far a bottom sheet lifts a placed globe so the sheet doesn't cover it. */
const HH_PANEL_LIFT = HH_CENTER_PANEL.y - HH_CENTER.y;
/* The head pose every layout constant above is authored against. XrHeadAnchor
 * moves that frame onto the user's real head at session start, so the planet
 * lands in front of them whether they stand, sit, or start off-centre. */
const XR_HEAD_FALLBACK = new THREE.Vector3(0, 1.5, 0);
const easeInOut = (t: number) => t * t * (3 - 2 * t);

/** Live globe placement in the headset, read by the captions / voice orb so
 * they stay just below the planet whatever its size (mutable, per frame). */
export const xrGlobe = { pos: new THREE.Vector3().copy(XR_ANCHOR), scale: XR_BASE_SCALE, chartK: 0 };

const _head = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _focal = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _zero = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

const _fwd = new THREE.Vector3();

/* ---------------- Holdings planet travel ----------------
 * Desktop: the planet sits out in space and the camera flies there on an arc.
 * Headset: the user can't be moved, so Earth shrinks aside and the planet
 * grows in at the focal point instead. `travel.k` is the eased 0→1 blend. */
export const PLANET_POS = new THREE.Vector3(14, 2, -10);
/** Headset: where the holdings planet floats (head-anchor space) and its full size. */
export const XR_PLANET_POS = new THREE.Vector3(-0.1, 1.34, -1.2);
export const XR_PLANET_SCALE = 0.2;
export const travel = { t: 0, k: 0 };
const TRAVEL_S = 2.2;
const _camA = new THREE.Vector3();
const _camB = new THREE.Vector3();
const _lookA = new THREE.Vector3();
const _lookB = new THREE.Vector3();
const _look = new THREE.Vector3();
const headAnchor = { frames: 0, locked: false };

/** Re-seat the headset layout in front of the user's current head pose. */
export function recenterXR() { headAnchor.frames = 0; headAnchor.locked = false; }

/** Wraps all in-headset content. Outside XR it is the identity. On entering a
 * session it follows the head for a few frames (tracking settles), then locks:
 * position under the head and yaw toward where the user is looking. */
export function XrHeadAnchor({ children }: { children: ReactNode }) {
  const ref = useRef<THREE.Group>(null);
  const { camera } = useThree();
  const inXR = useXR((s) => s.mode) != null;
  useEffect(() => { recenterXR(); }, [inXR]);
  useFrame(() => {
    const g = ref.current;
    if (!g) return;
    if (!inXR) { g.position.set(0, 0, 0); g.rotation.set(0, 0, 0); return; }
    if (headAnchor.locked) return;
    camera.getWorldPosition(_head);
    if (!Number.isFinite(_head.x) || _head.lengthSq() < 1e-6) return;
    camera.getWorldDirection(_fwd);
    /* Looking nearly straight up/down gives no heading; keep the last one. */
    if (Math.hypot(_fwd.x, _fwd.z) > 0.2) g.rotation.set(0, Math.atan2(-_fwd.x, -_fwd.z), 0);
    g.position.set(_head.x, _head.y - XR_HEAD_FALLBACK.y, _head.z);
    if (++headAnchor.frames > 30) headAnchor.locked = true;
  });
  return <group ref={ref}>{children}</group>;
}

export function CameraRig({ children }: { children: ReactNode }) {
  const group = useRef<THREE.Group>(null);
  const { camera } = useThree();
  const xrMode = useXR((s) => s.mode);
  const inXR = xrMode != null;
  const handheld = useHandheld((s) => s.active === "webxr");
  const gyroView = useHandheld((s) => s.active === "camera" && s.gyro);
  /* Smoothed head direction + chart-shrink blend, kept out of React. */
  const xr = useRef({ dir: new THREE.Vector3(0.3, 0.1, 0.95).normalize(), chartK: 0 });

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

    /* Linear progress toward the vault, eased for the camera. */
    const toVault = useWorld.getState().vault;
    travel.t = clamp(travel.t + (toVault ? 1 : -1) * Math.min(0.1, rawDt) / TRAVEL_S, 0, 1);
    travel.k = easeInOut(travel.t);

    g.rotation.set(0, 0, 0);
    g.rotateOnWorldAxis(Y_AXIS, rig.yaw);
    g.rotateOnWorldAxis(X_AXIS, rig.pitch);

    if (inXR) {
      const x = xr.current;
      /* 0 at the world view → 1 once zoomed to a country (or closer). */
      const zoomT = easeInOut(clamp((DIST.world - rig.dist) / (DIST.world - DIST.country), 0, 1));
      /* Shrink while the cluster shows a chart or a confirmation card. */
      const w = useWorld.getState(), m = useMarket.getState();
      /* On a phone any DOM panel (place, compare, research, gates) is a bottom sheet, so all of them count. */
      const chartShowing = handheld
        ? Boolean((w.panelReady && (w.focusedCompany || w.focusedCountry || w.focusedRegion)) || w.comparison || w.news || w.impact || m.pendingTrade || m.pendingOrder || m.loginPrompt || m.depositPrompt)
        : Boolean((w.focusedCompany && w.panelReady) || m.pendingTrade || m.pendingOrder);
      x.chartK = damp(x.chartK, chartShowing ? 1 : 0, 3.2, dt);
      if (handheld) {
        const s = THREE.MathUtils.lerp(THREE.MathUtils.lerp(HH_BASE_SCALE, HH_SCALE_NEAR, zoomT), HH_SCALE_PANEL, x.chartK);
        g.scale.setScalar(s);
        if (arAnchor.point) {
          /* Tapped into the room. A hit point lies on the surface and the globe's origin is
           * its centre, so resting it there means lifting by one (scaled) radius. */
          _focal.copy(arAnchor.point);
          if (g.parent) g.parent.worldToLocal(_focal);
          if (arAnchor.onSurface) _focal.y += s;
          _focal.y += HH_PANEL_LIFT * x.chartK;
          g.position.lerp(_focal, 1 - Math.exp(-dt * 9));
        } else {
          g.position.lerpVectors(HH_CENTER, HH_CENTER_PANEL, x.chartK);
        }
        xrGlobe.pos.copy(g.position); xrGlobe.scale = s; xrGlobe.chartK = x.chartK;
        return;
      }
      _focal.lerpVectors(XR_FOCAL_WORLD, XR_FOCAL_NEAR, zoomT).lerp(XR_FOCAL_CHART, x.chartK);
      const s = THREE.MathUtils.lerp(THREE.MathUtils.lerp(XR_BASE_SCALE, XR_SCALE_NEAR, zoomT), XR_SCALE_CHART, x.chartK);

      /* The headset camera is the head: turn the focused spot toward it. */
      camera.getWorldPosition(_head);
      if (!Number.isFinite(_head.x) || _head.lengthSq() < 1e-6) _head.copy(XR_HEAD_FALLBACK);
      else if (g.parent) g.parent.worldToLocal(_head);
      _dir.subVectors(_head, _focal).normalize();
      x.dir.x = damp(x.dir.x, _dir.x, 3, dt); x.dir.y = damp(x.dir.y, _dir.y, 3, dt); x.dir.z = damp(x.dir.z, _dir.z, 3, dt);
      x.dir.normalize();
      _m.lookAt(x.dir, _zero, _up);
      _q.setFromRotationMatrix(_m);
      g.quaternion.premultiply(_q);

      /* Centre = focal point pulled back one radius along the head direction.
       * While the holdings planet is up, Earth shrinks and drifts off to the left. */
      const away = travel.k;
      const sEarth = s * (1 - 0.7 * away);
      g.scale.setScalar(sEarth);
      g.position.copy(_focal).addScaledVector(x.dir, -sEarth);
      g.position.x -= 0.55 * away; g.position.y -= 0.12 * away; g.position.z -= 0.35 * away;
      xrGlobe.pos.copy(g.position); xrGlobe.scale = sEarth; xrGlobe.chartK = x.chartK;
    } else if (gyroView && gyro.active) {
      /* Phone camera view: the sensor turns the camera; the globe holds a fixed spot in the room. */
      const cam = camera as THREE.PerspectiveCamera;
      if (cam.fov !== GYRO_FOV) { cam.fov = GYRO_FOV; cam.updateProjectionMatrix(); }
      cam.position.set(0, 0, 0);
      cam.quaternion.copy(gyro.q);
      if (gyro.recalibrate) { arAnchor.dir.set(0, 0, -1).applyQuaternion(gyro.q).normalize(); gyro.recalibrate = false; }
      const aspect = cam.aspect || 1;
      const fit = Math.max(1, 1.05 / aspect);
      /* Same on-screen size as the flat view despite the wider FOV. */
      const d = rig.dist * fit * (Math.tan((DESKTOP_FOV / 2) * Math.PI / 180) / Math.tan((GYRO_FOV / 2) * Math.PI / 180));
      g.scale.setScalar(1);
      g.position.copy(arAnchor.dir).multiplyScalar(d);
    } else {
      const cam = camera as THREE.PerspectiveCamera;
      if (cam.fov !== DESKTOP_FOV) { cam.fov = DESKTOP_FOV; cam.updateProjectionMatrix(); }
      g.scale.setScalar(1);
      g.position.set(0, 0, 0);
      /* Portrait viewports would crop the planet horizontally: back off. */
      const aspect = cam.aspect || 1;
      const fit = Math.max(1, 1.05 / aspect);
      const d = rig.dist * fit;
      /* Panel offset shrinks on narrow viewports where the panel overlays instead. */
      const wide = Math.min(1, Math.max(0, (aspect - 0.9) / 0.6));
      const ox = -rig.offsetX * (d / DIST.world) * wide;
      if (travel.k <= 0) {
        camera.position.set(ox, 0, d);
        camera.lookAt(ox, 0, 0);
      } else {
        /* Earth view → holdings planet, framed left of the portfolio panel, on a rising arc. */
        _camA.set(ox, 0, d); _lookA.set(ox, 0, 0);
        const side = 1.15 * wide;
        _lookB.copy(PLANET_POS).add(_look.set(side, 0.3, 0));
        _camB.copy(_lookB).add(_look.set(0, 1.1, 6.6 * fit));
        const k = travel.k;
        camera.position.lerpVectors(_camA, _camB, k);
        camera.position.y += Math.sin(Math.PI * k) * 1.8;
        /* Face the destination early in the trip: the planet going out, Earth coming back. */
        _look.lerpVectors(_lookA, _lookB, toVault ? THREE.MathUtils.smoothstep(k, 0, 0.4) : THREE.MathUtils.smoothstep(k, 0.6, 1));
        camera.lookAt(_look);
      }
    }
  });

  return <group ref={group}>{children}</group>;
}
