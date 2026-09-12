/* Voice store: owns the single LiveClient, captions and status text.
 * The HUD, XR panels and trade flows all talk to Rhea through here. */
import { create } from "zustand";
import type { RheaAuth } from "@/auth/Auth";
import { greetingFor } from "./greeting";
import { LiveClient, type VoiceState } from "./liveClient";
import { createToolRunner } from "./toolRunner";
import { describeWorld, useWorld } from "@/state/world";
import { useMarket } from "@/state/market";

export type Caption = { id: string; role: "user" | "assistant"; text: string; at: number; done: boolean };

type VoiceStore = {
  client: LiveClient | null;
  state: VoiceState;
  captions: Caption[];
  lastTool: string | null;
  error: string | null;
  muted: boolean;
  connect: (auth: RheaAuth) => Promise<void>;
  disconnect: () => void;
  toggleMute: () => void;
  sendText: (text: string) => void;
  announce: (text: string) => void;
  instruct: (text: string) => void;
  pushContext: () => void;
};

let authRef: RheaAuth | null = null;
let seq = 0;
const TURN_GAP_MS = 2200;

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

  return {
    client: null,
    state: "off",
    captions: [],
    lastTool: null,
    error: null,
    muted: false,

    connect: async (auth) => {
      authRef = auth;
      if (get().client) return;
      const client = new LiveClient(
        {
          onState: (state) => set({ state }),
          onUserTranscript: (delta) => appendCaption("user", delta, delta.length > 40),
          onAssistantTranscript: (delta) => appendCaption("assistant", delta),
          onToolStart: (name) => set({ lastTool: name }),
          onError: (message) => set({ error: message }),
          onClosed: () => set({ client: null, state: "off" }),
        },
        createToolRunner(() => authRef!),
      );
      set({ client, error: null });
      try {
        await client.connect({ context: buildContext(auth) });
        /* Greeting after session.started — poll ready since events are async. */
        const started = Date.now();
        const wait = () => {
          if (client.isConnected) { client.greet(greetingFor(auth)); return; }
          if (Date.now() - started < 8000) window.setTimeout(wait, 150);
        };
        wait();
      } catch (e) {
        set({ client: null, state: "error", error: (e as Error).message });
      }
    },

    disconnect: () => {
      get().client?.close();
      set({ client: null, state: "off" });
    },

    toggleMute: () => {
      const c = get().client;
      const muted = !get().muted;
      c?.setMuted(muted);
      set({ muted });
    },

    sendText: (text) => {
      const c = get().client;
      if (!c?.isConnected) return;
      appendCaption("user", text, true);
      c.send({ type: "response.item.create", item: { type: "message", role: "user", content: [{ type: "input_text", text }] } });
      c.send({ type: "response.create" });
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
  parts.push(m.jurisdiction ? `Jurisdiction: ${m.jurisdiction}.` : "Jurisdiction not selected.");
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
  useMarket.subscribe((s, prev) => { if (s.portfolio !== prev.portfolio || s.pendingTrade !== prev.pendingTrade || s.pendingOrder !== prev.pendingOrder || s.jurisdiction !== prev.jurisdiction) useVoice.getState().pushContext(); });
}
