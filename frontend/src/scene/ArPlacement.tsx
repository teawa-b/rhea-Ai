/* Tap-to-place for handheld AR. Lives inside the Canvas, outside the head
 * anchor, so hit-test results (which arrive in the XR reference space) can be
 * used as world positions directly.
 *
 * WebXR: a continuous hit test from the viewer finds the real surface the
 * phone is pointed at. A reticle draws there, and a tap drops the globe onto
 * it. Where the runtime won't grant hit-test (it is an optional feature, and
 * the dev emulator refuses it without a synthetic room), the tap still places
 * the globe, just floating at arm's length instead of resting on something.
 * Camera view: no surfaces to hit, so a tap re-aims the anchor direction at
 * the tapped pixel. */
import { useFrame, useThree } from "@react-three/fiber";
import { createXRHitTestSource, useXR } from "@react-three/xr";
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { C } from "@/theme";
import { arAnchor, onArTap } from "./arPlace";
import { gyro } from "./gyro";
import { useHandheld } from "./handheld";
import { xrStore } from "./xrStore";

type HitSource = Awaited<ReturnType<typeof createXRHitTestSource>>;

/** How far in front of the viewer a tap lands when no real surface was found. */
const FREE_PLACE_M = 1.0;

const _m = new THREE.Matrix4();
const _p = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _ndc = new THREE.Vector2();
const _ray = new THREE.Raycaster();

/** Reticle: a flat ring lying on the surface the phone is pointed at. */
function Reticle({ shown }: { shown: boolean }) {
  const ref = useRef<THREE.Group>(null);
  useFrame((_, dt) => {
    const g = ref.current;
    if (!g) return;
    const hit = arAnchor.hit;
    g.visible = shown && hit != null;
    if (!g.visible || !hit) return;
    g.position.lerp(hit, 1 - Math.exp(-dt * 14));
    g.rotation.x = -Math.PI / 2;
  });
  return (
    <group ref={ref} visible={false}>
      <mesh>
        <ringGeometry args={[0.07, 0.085, 48]} />
        <meshBasicMaterial color={C.cyan} transparent opacity={0.85} toneMapped={false} depthTest={false} side={THREE.DoubleSide} />
      </mesh>
      <mesh>
        <ringGeometry args={[0.015, 0.02, 24]} />
        <meshBasicMaterial color={C.solGreen} transparent opacity={0.9} toneMapped={false} depthTest={false} side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
}

export function ArPlacement() {
  const mode = useHandheld((s) => s.active);
  const webxr = mode === "webxr";
  const session = useXR((s) => s.session);
  const { camera } = useThree();
  /* Hit-test is an optional feature and a runtime may advertise it, then refuse the
   * request (the dev emulator does exactly that). useXRHitTest leaves such a rejection
   * unhandled, so the source is created here where it can be caught: without it the
   * reticle stays hidden and taps place the globe in free space instead. */
  const [hits, setHits] = useState<HitSource>(undefined);
  const wanted = webxr && Boolean(session?.enabledFeatures?.includes("hit-test"));

  useEffect(() => {
    arAnchor.hit = null;
    if (!wanted || !session) return;
    let live = true;
    let made: HitSource;
    createXRHitTestSource(xrStore, session, "viewer", ["plane", "mesh", "point"])
      .then((r) => { if (!live || !r) return; made = r; setHits(r); })
      .catch((e) => console.warn("[ar] hit test unavailable; tapping will place the globe in front of you", e));
    return () => {
      live = false;
      try { made?.source.cancel(); } catch { /* the session may already be gone */ }
      setHits(undefined);
      arAnchor.hit = null;
    };
  }, [wanted, session]);

  useFrame((_s, _dt, frame) => {
    if (!hits) return;
    const results = (frame as XRFrame | undefined)?.getHitTestResults(hits.source);
    if (!results?.length || !hits.getWorldMatrix(_m, results[0])) { arAnchor.hit = null; return; }
    _p.setFromMatrixPosition(_m);
    if (arAnchor.hit) arAnchor.hit.copy(_p);
    else arAnchor.hit = _p.clone();
  });

  useEffect(() => {
    if (!mode) return;
    return onArTap((x, y) => {
      if (webxr) {
        if (arAnchor.hit) {
          arAnchor.point = (arAnchor.point ?? new THREE.Vector3()).copy(arAnchor.hit);
          arAnchor.onSurface = true;
          return;
        }
        /* No surface under the phone: drop it at arm's length along the view. */
        camera.getWorldPosition(_p);
        camera.getWorldDirection(_dir);
        arAnchor.point = (arAnchor.point ?? new THREE.Vector3()).copy(_p).addScaledVector(_dir, FREE_PLACE_M);
        arAnchor.onSurface = false;
        return;
      }
      if (!gyro.active) return;
      /* The gyro camera sits at the origin, so the ray through the tapped pixel
       * is already the world direction to anchor to. */
      _ndc.set((x / window.innerWidth) * 2 - 1, -(y / window.innerHeight) * 2 + 1);
      _ray.setFromCamera(_ndc, camera);
      arAnchor.dir.copy(_ray.ray.direction).normalize();
      gyro.recalibrate = false;
    });
  }, [mode, webxr, camera]);

  if (!mode) return null;
  return <Reticle shown={hits != null} />;
}
