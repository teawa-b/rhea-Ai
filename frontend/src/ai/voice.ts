/* Voice store: owns the single LiveClient, captions and status text.
 * The HUD, XR panels and trade flows all talk to Rhea through here. */
import { create } from "zustand";
import type { RheaAuth } from "@/auth/Auth";
import { greetingFor } from "./greeting";
import { LiveClient, type InputMode, type VoiceState } from "./liveClient";
import { createToolRunner } from "./toolRunner";
import { describeWorld, useWorld } from "@/state/world";
import { useMarket } from "@/state/market";

export type Caption = { id: string; role: "user" | "assistant"; text: string; at: number; done: boolean };

type VoiceStore = {
  client: LiveClient | null;
  state: VoiceState;
  /** "text" when the session runs without a microphone (typed questions only). */
  inputMode: InputMode;
  captions: Caption[];
  lastTool: string | null;
  error: string | null;
  /** Non-fatal heads-up, e.g. the mic was blocked so Rhea switched to text mode. */
  notice: string | null;
  muted: boolean;
  /** Push-to-talk (headset): the mic is closed except while a button is held. */
  pushToTalk: boolean;
  /** True while the user is holding the talk button. */
  holding: boolean;
  /** Starts a session: with the mic by default, or text-only (no mic prompt). */
  connect: (auth: RheaAuth, input?: InputMode) => Promise<void>;
  /** From text mode, reconnect with the mic and keep the conversation so far. */
  switchToVoice: (auth: RheaAuth) => Promise<void>;
  disconnect: () => void;
  toggleMute: () => void;
  /** Switches between open-mic (desktop) and push-to-talk (headset). */
  setPushToTalk: (on: boolean) => void;
  /** Hold-to-speak: opens the mic and ducks Rhea while held; connects first if needed. */
  setHold: (on: boolean, auth?: RheaAuth) => void;
  /** Sends typed text, opening a text-only session first if none is running. */
  sendText: (text: string, auth?: RheaAuth) => void;
  announce: (text: string) => void;
  instruct: (text: string) => void;
  pushContext: () => void;
};

let authRef: RheaAuth | null = null;
let seq = 0;
const TURN_GAP_MS = 2200;
/* Typed questions sent before the session has started. */
let queued: string[] = [];

export const useVoice = create<VoiceStore>((set, get) => {
  const appendCaption = (role: Caption["role"], delta: string, forceNew = false) => {
    set((s) => {
      const caps = [...s.captions];
      const last = caps[caps.length - 1];
      const now = Date.now();
      if (!forceNew && last && last.role === role && now - last.at < TURN_GAP_MS) {
        caps[caps.length - 1] = { ...last, text: last.text + delta, at: now };
      } else {
        for (const c of caps) c.done = true;
        caps.push({ id: `cap_${++seq}`, role, text: delta.trimStart(), at: now, done: false });
      }
      return { captions: caps.slice(-8) };
    });
  };

  const deliver = (client: LiveClient, text: string) => {
    appendCaption("user", text, true);
    client.sendText(text);
  };

  return {
    client: null,
    state: "off",
    inputMode: "mic",
    captions: [],
    lastTool: null,
    error: null,
    notice: null,
    muted: false,
    pushToTalk: false,
    holding: false,

    connect: async (auth, input = "mic") => {
      authRef = auth;
      if (get().client) return;
      let client: LiveClient | null = null;
      /* Ignore late events from a client that has since been replaced (e.g. switchToVoice). */
      const current = <A extends unknown[]>(fn: (...a: A) => void) => (...a: A) => { if (get().client === client) fn(...a); };
      client = new LiveClient(
        {
          onState: current((state: VoiceState) => set({ state })),
          onUserTranscript: current((delta: string) => appendCaption("user", delta, delta.length > 40)),
          onAssistantTranscript: current((delta: string) => appendCaption("assistant", delta)),
          onToolStart: current((name: string) => set({ lastTool: name })),
          onError: current((message: string) => set({ error: message })),
          onMicUnavailable: current((message: string) => set({ notice: message, inputMode: "text" })),
          onClosed: current(() => set({ client: null, state: "off" })),
        },
        createToolRunner(() => authRef!),
      );
      const history = get().captions.filter((c) => c.text.trim()).map((c) => ({ role: c.role, text: c.text }));
      set({ client, error: null, notice: null, inputMode: input });
      try {
        await client.connect({ context: buildContext(auth), history, input });
        const live = client;
        /* Push-to-talk starts closed unless the button is already down. */
        if (get().pushToTalk && !get().holding) { live.setMuted(true); set({ muted: true }); }
        /* After session.started: answer queued typed questions, otherwise greet
         * (unless resuming a conversation). Poll since events are async. */
        const started = Date.now();
        const wait = () => {
          if (get().client !== live) return;
          if (live.isConnected) {
            const pendingText = queued; queued = [];
            if (pendingText.length) pendingText.forEach((t) => deliver(live, t));
            else if (!history.length) live.greet(greetingFor(auth));
            return;
          }
          if (Date.now() - started < 8000) window.setTimeout(wait, 150);
          else if (queued.length) { queued = []; set({ error: "Rhea didn't connect in time. Please ask again." }); }
        };
        wait();
      } catch (e) {
        queued = [];
        if (get().client === client) set({ client: null, state: "error", error: (e as Error).message });
      }
    },

    switchToVoice: async (auth) => {
      const old = get().client;
      set({ client: null, state: "connecting", notice: null });
      old?.close();
      await get().connect(auth, "mic");
    },

    disconnect: () => {
      get().client?.close();
      queued = [];
      set({ client: null, state: "off", holding: false });
    },

    toggleMute: () => {
      const c = get().client;
      const muted = !get().muted;
      c?.setMuted(muted);
      set({ muted });
    },

    setPushToTalk: (on) => {
      if (get().pushToTalk === on) return;
      const c = get().client;
      /* Entering the headset closes the mic until a button is held; leaving reopens it. */
      c?.setMuted(on);
      c?.setOutputVolume(1);
      set({ pushToTalk: on, holding: false, muted: on });
    },

    setHold: (on, auth) => {
      const { client, holding, state } = get();
      if (on === holding) return;
      set({ holding: on });
      if (on && (!client || state === "error")) {
        const a = auth ?? authRef;
        if (a) void get().connect(a, "mic");
        return;
      }
      if (!client) return;
      client.setMuted(!on);
      /* Duck Rhea while the user talks so she never speaks over them. */
      client.setOutputVolume(on ? 0.12 : 1);
      set({ muted: !on });
    },

    sendText: (text, auth) => {
      const c = get().client;
      if (c?.isConnected) { deliver(c, text); return; }
      queued.push(text);
      const a = auth ?? authRef;
      if (!c && a) void get().connect(a, "text");
    },

    announce: (text) => get().client?.announce(text),
    instruct: (text) => get().client?.instruct(text),
    pushContext: () => { const c = get().client; if (c?.isConnected && authRef) c.pushContext(buildContext(authRef)); },
  };
});

export function buildContext(auth: RheaAuth) {
  const m = useMarket.getState();
  const parts = [describeWorld()];
  parts.push(auth.authenticated ? `User signed in${auth.displayName ? ` as ${auth.displayName}` : ""}, wallet ${auth.address?.slice(0, 4)}…${auth.address?.slice(-4)}.` : "User not signed in (research only; trading needs sign-in).");
  if (m.portfolio) parts.push(`Portfolio: $${m.portfolio.totalValueUsd.toFixed(0)} total, ${m.portfolio.usdcBalance.toFixed(0)} USDC, positions: ${m.portfolio.positions.slice(0, 6).map((p) => `${p.amountUi.toFixed(3)} ${p.symbol}`).join(", ") || "none"}.`);
  const active = m.orders.filter((o) => o.status === "active");
  if (active.length) parts.push(`${active.length} active conditional order(s).`);
  if (m.pendingTrade) parts.push(`A ${m.pendingTrade.side} trade is ${m.pendingTrade.status.replace("_", " ")}.`);
  if (m.pendingOrder) parts.push(`A conditional order is ${m.pendingOrder.status}.`);
  return parts.join(" ");
}

/* Keep the live model quietly informed when the world or wallet changes. */
let wired = false;
export function wireContextUpdates() {
  if (wired) return;
  wired = true;
  useWorld.subscribe((s, prev) => { if (s.contextVersion !== prev.contextVersion) useVoice.getState().pushContext(); });
  useMarket.subscribe((s, prev) => { if (s.portfolio !== prev.portfolio || s.pendingTrade !== prev.pendingTrade || s.pendingOrder !== prev.pendingOrder) useVoice.getState().pushContext(); });
}
