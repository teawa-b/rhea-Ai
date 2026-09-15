/* Dead-center "Enter Mixed Reality" launcher for XR-capable browsers (Quest).
 * Before the immersive session starts we make sure the mic is allowed, so the
 * user never has to leave the headset view to answer a permission prompt. */
import { useState } from "react";
import { useAuth } from "@/auth/Auth";
import { useVoice } from "@/ai/voice";
import { enterImmersive } from "@/scene/RheaScene";
import { MicIcon, MicOffIcon } from "./icons";

type MicStep = "ask" | "requesting" | "granted" | "blocked";

/** Where the launcher makes sense: the Quest browser, an explicit ?xr=1, or localhost (keeps the desktop IWER
 * emulator QA path). Android Chrome also reports immersive-ar, so feature detection alone showed it on phones. */
export function xrLaunchAllowed(): boolean {
  try {
    if (navigator.userAgent.includes("OculusBrowser")) return true;
    if (new URLSearchParams(window.location.search).get("xr") === "1") return true;
    return ["localhost", "127.0.0.1"].includes(window.location.hostname);
  } catch { return false; }
}

async function micPermission(): Promise<PermissionState | "unknown"> {
  try {
    const p = await navigator.permissions.query({ name: "microphone" as PermissionName });
    return p.state;
  } catch { return "unknown"; }
}

export function XrLaunch({ mode }: { mode: "immersive-ar" | "immersive-vr" }) {
  const auth = useAuth();
  const connect = useVoice((s) => s.connect);
  const [step, setStep] = useState<MicStep | null>(null);
  const label = mode === "immersive-ar" ? "Enter Mixed Reality" : "Enter VR";

  const launch = () => { setStep(null); void connect(auth); void enterImmersive(); };

  const onLaunch = async () => {
    /* Already allowed: go straight in while the click still counts as a gesture. */
    if (await micPermission() === "granted") { launch(); return; }
    setStep("ask");
  };

  const enableMic = async () => {
    setStep("requesting");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
      setStep("granted");
    } catch {
      setStep("blocked");
    }
  };

  return (
    <>
      {step === null ? (
        <div className="xr-launch">
          <button className="xr-cta" onClick={() => void onLaunch()} title={mode === "immersive-ar" ? "Passthrough mixed reality (Quest)" : "Immersive VR"}>
            <span className="xr-cta-ring" aria-hidden />
            <span className="xr-cta-glyph" aria-hidden>◎</span>
            <span className="xr-cta-text">{label}</span>
            <span className="xr-cta-sub">Headset detected · tap to launch</span>
          </button>
        </div>
      ) : (
        <div className="xr-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="xr-mic-title">
          <div className="panel xr-modal">
            <i className="xr-corner tl" aria-hidden /><i className="xr-corner tr" aria-hidden />
            <i className="xr-corner bl" aria-hidden /><i className="xr-corner br" aria-hidden />
            <div className={`xr-mic-orb ${step}`} aria-hidden>
              {step === "blocked" ? <MicOffIcon size={28} /> : <MicIcon size={28} />}
            </div>
            <div className="xr-modal-kicker">Pre-flight check · audio link</div>
            <h2 id="xr-mic-title">
              {step === "granted" ? "Mic online" : step === "blocked" ? "Mic blocked" : "Enable your mic"}
            </h2>
            <p className="xr-modal-copy">
              {step === "granted" ? "You're all set. Rhea will hear you as soon as you're inside."
                : step === "blocked" ? "The browser didn't allow the microphone. You can allow it in the site settings (the lock icon by the address), or head in anyway and type instead."
                : "Rhea is voice-first. Allow the microphone now so you can talk to her in the headset without coming back out to grant access."}
            </p>
            <div className="xr-modal-actions">
              {step === "granted" ? (
                <button className="btn sol" onClick={launch}>◎ {label}</button>
              ) : step === "blocked" ? (
                <>
                  <button className="btn" onClick={() => void enableMic()}>Try again</button>
                  <button className="btn sol" onClick={launch}>Enter without mic</button>
                </>
              ) : (
                <button className="btn sol" onClick={() => void enableMic()} disabled={step === "requesting"}>
                  {step === "requesting" ? "Waiting for permission…" : "Enable microphone"}
                </button>
              )}
              <button className="btn ghost sm" onClick={() => setStep(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
