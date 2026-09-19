/* One texture per logo URL, shared by every chip, sign and plaque that shows
 * it. The files are bundled under public/logos (same-origin, so WebGL can
 * sample them); a URL that fails to load is cached as a miss and never retried. */
import { useEffect, useState } from "react";
import * as THREE from "three";

const cache = new Map<string, THREE.Texture | null>();
const loader = new THREE.TextureLoader().setCrossOrigin("anonymous");

export function useLogoTexture(url?: string) {
  const [tex, setTex] = useState<THREE.Texture | null>(() => (url ? cache.get(url) ?? null : null));
  useEffect(() => {
    if (!url) { setTex(null); return; }
    if (cache.has(url)) { setTex(cache.get(url) ?? null); return; }
    let live = true;
    loader.load(url, (t) => { t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; cache.set(url, t); if (live) setTex(t); }, undefined, () => { cache.set(url, null); });
    return () => { live = false; };
  }, [url]);
  return tex;
}
