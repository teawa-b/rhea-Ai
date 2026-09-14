/* GPT-Live-1 browser client (spec §7).
 *
 * WebRTC carries audio both ways; the `oai-events` data channel carries JSON.
 * The session is created by POST /api/live/session (server holds the key)
 * with Responses delegation: gpt-live-1 talks, a Responses backend reasons and
 * calls Rhea's tools. Function calls arrive nested in `response.event`
 * envelopes; we execute them in the browser (they move the globe, open panels,
 * fetch data) and return `function_call_output` items, then `response.create`
 * to let the backend continue — exactly the flow in the delegation guide.
 */
import { apiUrl } from "@/market/api";

export type VoiceState = "off" | "connecting" | "idle" | "listening" | "thinking" | "speaking" | "error";

export type ToolExecutor = (name: string, args: Record<string, unknown>) => Promise<unknown>;

export type LiveCallbacks = {
  onState?: (s: VoiceState) => void;
  onUserTranscript?: (delta: string, startMs: number, endMs: number) => void;
  onAssistantTranscript?: (delta: string, startMs: number, endMs: number) => void;
  onToolStart?: (name: string, args: Record<string, unknown>) => void;
  onError?: (message: string) => void;
  onClosed?: (usage: unknown) => void;
};

type ServerEvent = {
  type: string;
  event_id?: string;
  delta?: string;
  start_ms?: number;
  end_ms?: number;
  delegation_id?: string | null;
  delegation?: { id: string; target: string };
  session?: { id: string };
  usage?: unknown;
  error?: { message?: string; code?: string; type?: string };
  event?: NestedResponseEvent;
  client_event_id?: string;
};

type NestedResponseEvent = {
  type: string;
  response?: { id?: string; status?: string };
  item?: { id?: string; type?: string; call_id?: string; name?: string; arguments?: string; status?: string };
  delta?: string;
};

type PendingCall = { callId: string; name: string; promise: Promise<unknown> };

export class LiveClient {
  private pc: RTCPeerConnection | null = null;
  private dc: RTCDataChannel | null = null;
  private mic: MediaStream | null = null;
  private audio: HTMLAudioElement | null = null;
  private state: VoiceState = "off";
  private ready = false;
  private closed = false;
  private eventSeq = 0;
  private speakingTimer: number | null = null;
  private lastContext = "";
  private contextTimer: number | null = null;
  /* function calls collected per delegation (outer id) until the response completes */
  private pending = new Map<string, PendingCall[]>();
  private continued = new Set<string>();
  sessionId: string | null = null;
  muted = false;

  constructor(private readonly cb: LiveCallbacks, private readonly execute: ToolExecutor) {}

  get voiceState() { return this.state; }
  get isConnected() { return this.ready && !this.closed; }

  private setState(s: VoiceState) {
    if (this.state === s) return;
    this.state = s;
    this.cb.onState?.(s);
  }

  async connect(opts: { context?: string; history?: { role: "user" | "assistant"; text: string }[] } = {}) {
    if (this.pc) return;
    this.closed = false;
    this.setState("connecting");
    try {
      const pc = new RTCPeerConnection();
      this.pc = pc;

      this.audio = new Audio();
      this.audio.autoplay = true;
      this.audio.setAttribute("playsinline", "true");
      pc.addEventListener("track", (ev) => {
        if (!this.audio) return;
        this.audio.srcObject = new MediaStream([ev.track]);
        this.audio.play().catch(() => undefined);
      });

      this.mic = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      for (const track of this.mic.getAudioTracks()) pc.addTrack(track, this.mic);

      /* Create the channel BEFORE the offer so it is part of the SDP. */
      const dc = pc.createDataChannel("oai-events");
      this.dc = dc;
      dc.addEventListener("message", (m) => this.handle(m.data));
      dc.addEventListener("close", () => { if (!this.closed) this.fail("Voice channel closed"); });
      dc.addEventListener("error", () => this.fail("Voice channel error"));

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      if (pc.iceGatheringState !== "complete") {
        await new Promise<void>((resolve, reject) => {
          const timeout = window.setTimeout(() => { pc.removeEventListener("icegatheringstatechange", on); reject(new Error("ICE gathering timed out")); }, 10_000);
          const on = () => { if (pc.iceGatheringState !== "complete") return; window.clearTimeout(timeout); pc.removeEventListener("icegatheringstatechange", on); resolve(); };
          pc.addEventListener("icegatheringstatechange", on);
          on();
        });
      }
      const sdp = pc.localDescription?.sdp;
      if (!sdp) throw new Error("Missing local SDP offer");

      const res = await fetch(apiUrl("/api/live/session"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sdp, context: opts.context ?? "", history: opts.history ?? [] }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { error?: string; detail?: string };
        throw new Error(err.detail || err.error || `Session request failed (${res.status})`);
      }
      const result = await res.json() as { session: { id: string }; transport: { sdp: string } };
      this.sessionId = result.session.id;
      await pc.setRemoteDescription({ type: "answer", sdp: result.transport.sdp });
      /* The HTTP request started the session; wait for session.started on the channel. */
    } catch (e) {
      this.fail((e as Error).message);
      this.teardown();
      throw e;
    }
  }

  /** Graceful close: ask for final usage, keep media alive until session.closed. */
  close() {
    if (!this.dc || this.dc.readyState !== "open" || !this.ready) { this.teardown(); this.setState("off"); return; }
    this.closed = true;
    this.send({ type: "session.close" });
    window.setTimeout(() => { if (this.pc) { this.teardown(); this.setState("off"); } }, 6000);
  }

  private teardown() {
    if (this.contextTimer) window.clearTimeout(this.contextTimer);
    this.mic?.getTracks().forEach((t) => t.stop());
    try { this.dc?.close(); } catch { /* ignore */ }
    try { this.pc?.close(); } catch { /* ignore */ }
    if (this.audio) { this.audio.srcObject = null; this.audio.remove(); }
    this.pc = null; this.dc = null; this.mic = null; this.audio = null;
    this.ready = false; this.sessionId = null;
    this.pending.clear(); this.continued.clear();
  }

  private fail(message: string) {
    console.error("[live]", message);
    this.cb.onError?.(message);
    this.setState("error");
  }

  send(event: Record<string, unknown>) {
    if (!this.dc || this.dc.readyState !== "open") { console.warn("[live] send skipped, channel not open", event.type); return false; }
    const withId = { event_id: `c_${++this.eventSeq}`, ...event };
    this.dc.send(JSON.stringify(withId));
    return true;
  }

  /* ---------------- Steering ---------------- */

  /** Ask Rhea to greet first (docs: instructions.append + short commentary nudge). */
  greet(instruction: string) {
    this.send({ type: "session.instructions.append", delegation_id: null, content: instruction });
    this.send({ type: "session.commentary.append", delegation_id: null, content: "Begin the conversation now, following the instructions provided." });
  }

  /** Quiet UI-context update for the live model (debounced, skips unchanged). */
  pushContext(text: string) {
    if (!text || text === this.lastContext) return;
    if (this.contextTimer) window.clearTimeout(this.contextTimer);
    this.contextTimer = window.setTimeout(() => {
      if (!this.isConnected || text === this.lastContext) return;
      this.lastContext = text;
      this.send({ type: "session.thinking.append", delegation_id: null, content: text.slice(0, 1800) });
    }, 900);
  }

  /** Something the user should hear now (a confirmed trade, an error). */
  announce(text: string) {
    this.send({ type: "session.commentary.append", delegation_id: null, content: text.slice(0, 1800) });
  }

  /** Redirect the live model's behaviour (e.g. after a compliance block). */
  instruct(text: string) {
    this.send({ type: "session.instructions.append", delegation_id: null, content: text.slice(0, 1800) });
  }

  /** Typed text goes to the backend as a user message, then runs it. */
  sendText(text: string) {
    this.send({ type: "response.item.create", item: { type: "message", role: "user", content: [{ type: "input_text", text }] } });
    this.send({ type: "response.create" });
    this.cb.onUserTranscript?.(text, -1, -1);
  }

  setMuted(muted: boolean) {
    this.muted = muted;
    this.mic?.getAudioTracks().forEach((t) => { t.enabled = !muted; });
    this.send({ type: muted ? "session.input_audio.mute" : "session.input_audio.unmute" });
  }

  /* ---------------- Events ---------------- */

  private handle(raw: string) {
    let ev: ServerEvent;
    try { ev = JSON.parse(raw) as ServerEvent; } catch { return; }

    switch (ev.type) {
      case "session.started":
        this.ready = true;
        this.setState("idle");
        break;

      case "session.closed":
        this.cb.onClosed?.(ev.usage);
        this.teardown();
        this.setState("off");
        break;

      case "session.input_transcript.delta":
        if (ev.delta) {
          this.cb.onUserTranscript?.(ev.delta, ev.start_ms ?? 0, ev.end_ms ?? 0);
          if (this.state === "idle") this.setState("listening");
        }
        break;

      case "session.output_transcript.delta":
        if (ev.delta) {
          this.cb.onAssistantTranscript?.(ev.delta, ev.start_ms ?? 0, ev.end_ms ?? 0);
          this.setState("speaking");
          if (this.speakingTimer) window.clearTimeout(this.speakingTimer);
          this.speakingTimer = window.setTimeout(() => { if (this.state === "speaking") this.setState("idle"); }, 1800);
        }
        break;

      case "session.delegation.created":
        if (ev.delegation?.id) { this.pending.set(ev.delegation.id, []); this.continued.delete(ev.delegation.id); }
        if (this.state !== "speaking") this.setState("thinking");
        break;

      case "response.event":
        if (ev.event) this.handleNested(ev.delegation_id ?? "none", ev.event);
        break;

      case "error": {
        const msg = ev.error?.message ?? "Live session error";
        const code = ev.error?.code ?? "";
        console.warn("[live] error event", code, msg);
        /* Command rejections are recoverable; connection-level errors are not. */
        if (/session|connection|auth|expired|closed/i.test(`${code} ${msg}`) && !/append|invalid_value|item/i.test(`${code} ${msg}`)) this.fail(msg);
        else this.cb.onError?.(msg);
        break;
      }

      default:
        break;
    }
  }

  private handleNested(delegationId: string, ev: NestedResponseEvent) {
    switch (ev.type) {
      case "response.created":
        if (!this.pending.has(delegationId)) this.pending.set(delegationId, []);
        this.continued.delete(delegationId);
        break;

      case "response.output_item.done": {
        const item = ev.item;
        if (item?.type === "function_call" && item.call_id && item.name) {
          let args: Record<string, unknown> = {};
          try { args = item.arguments ? (JSON.parse(item.arguments) as Record<string, unknown>) : {}; } catch { args = {}; }
          this.cb.onToolStart?.(item.name, args);
          /* Execute immediately (visual tools are instant) and remember the promise. */
          const promise = this.execute(item.name, args).catch((e: unknown) => ({ ok: false, error: (e as Error).message }));
          const list = this.pending.get(delegationId) ?? [];
          list.push({ callId: item.call_id, name: item.name, promise });
          this.pending.set(delegationId, list);
        }
        break;
      }

      case "response.completed":
      case "response.done":
      case "response.incomplete":
        void this.finishResponse(delegationId);
        break;

      case "response.failed":
        this.pending.delete(delegationId);
        if (this.state === "thinking") this.setState("idle");
        break;

      default:
        break;
    }
  }

  /** Submit every collected tool result, then continue the backend response. */
  private async finishResponse(delegationId: string) {
    const calls = this.pending.get(delegationId) ?? [];
    this.pending.set(delegationId, []);
    if (!calls.length) {
      if (this.state === "thinking") this.setState("idle");
      return;
    }
    const results = await Promise.all(calls.map((c) => c.promise));
    calls.forEach((c, i) => {
      const out = results[i] ?? { ok: true };
      this.send({ type: "response.item.create", item: { type: "function_call_output", call_id: c.callId, output: JSON.stringify(out).slice(0, 12_000) } });
    });
    this.send({ type: "response.create" });
    this.continued.add(delegationId);
  }
}
