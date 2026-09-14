/* Company logo chip for DOM panels (bundled in public/logos); renders nothing
 * for companies without a bundled logo so rows stay aligned by the flex gap. */
import { useState } from "react";
import { COMPANY_BY_ID } from "@shared/registry";
import { logoUrl } from "@/market/logos";

export function CoLogo({ id, size = 26 }: { id: string; size?: number }) {
  const [failed, setFailed] = useState(false);
  const url = logoUrl(id);
  const co = COMPANY_BY_ID[id];
  if (!url || failed) {
    return <span className="co-logo mono-logo" style={{ width: size, height: size, fontSize: size * 0.42 }} aria-hidden>{(co?.ticker ?? "?").slice(0, 2)}</span>;
  }
  return <img className="co-logo" src={url} alt="" width={size} height={size} loading="lazy" onError={() => setFailed(true)} />;
}
