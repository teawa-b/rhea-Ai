/* Copy-to-clipboard helpers for wallet addresses. The clipboard API is absent
 * or blocked in some embedded webviews, so every path falls back to a hidden
 * textarea + execCommand before giving up. */
import { useEffect, useRef, useState } from "react";
import { CopyIcon, CheckIcon } from "./icons";

async function writeClipboard(text: string) {
  try {
    if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); return true; }
  } catch { /* fall through to the legacy path */ }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.cssText = "position:fixed;top:-1000px;opacity:0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch { return false; }
}

/** copy(text) → true when it landed; `copied` flips back on its own. */
export function useCopy(ms = 1500) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const copy = async (text: string | null | undefined) => {
    if (!text) return false;
    const ok = await writeClipboard(text);
    setCopied(ok); setFailed(!ok);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => { setCopied(false); setFailed(false); }, ms);
    return ok;
  };
  return { copied, failed, copy };
}

export const shortAddress = (a: string, head = 4, tail = 4) => (a.length > head + tail + 1 ? `${a.slice(0, head)}…${a.slice(-tail)}` : a);

/** The truncated address as a one-tap copy control — for panel headers and chips. */
export function CopyAddress({ address, head = 6, tail = 6, label }: { address: string; head?: number; tail?: number; label?: string }) {
  const { copied, failed, copy } = useCopy();
  return (
    <button
      type="button"
      className="copy-addr mono"
      onClick={(e) => { e.stopPropagation(); void copy(address); }}
      title={`${label ? `${label}\n` : ""}${address}\nClick to copy`}
      aria-label={`Copy wallet address ${address}`}
    >
      <span>{copied ? "Copied" : failed ? "Copy failed" : shortAddress(address, head, tail)}</span>
      {copied ? <CheckIcon size={12} /> : <CopyIcon size={12} />}
    </button>
  );
}

/** The full address on its own line with a copy button — for deposit/receive flows. */
export function AddressBlock({ address, hint }: { address: string | null | undefined; hint?: string }) {
  const { copied, failed, copy } = useCopy();
  return (
    <>
      {hint ? <div className="hint">{hint}</div> : null}
      <div className="mono addr-full" onClick={() => void copy(address)} title="Click to copy">{address ?? "—"}</div>
      <button className="btn sm" onClick={() => void copy(address)} disabled={!address}>
        {copied ? "Copied" : failed ? "Copy failed — select it above" : "Copy address"}
      </button>
    </>
  );
}
