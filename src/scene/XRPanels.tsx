/* In-headset 3D panels (company / trade / captions). Filled in later;
 * desktop uses the HTML HUD instead. */
import { useXR } from "@react-three/xr";

export function XRPanels() {
  const mode = useXR((s) => s.mode);
  if (mode == null) return null;
  return null;
}
