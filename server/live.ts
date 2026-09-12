/* POST /api/live/session — creates a GPT-Live WebRTC session (spec §7.3).
 *
 * The browser sends its SDP offer; we attach the session configuration
 * (persona, voice, Responses delegation with Rhea's tools + web_search) and
 * forward it to OpenAI with the server-side API key. The SDP answer and the
 * session id go back to the browser. The permanent key never leaves here.
 */
import type { Request, Response } from "express";
import OpenAI from "openai";
import type { InitialItem, LiveCreateParams } from "openai/resources/live/live";
import { RHEA_TOOLS } from "../shared/tools";
import { BACKEND_INSTRUCTIONS, LIVE_INSTRUCTIONS } from "./prompts";

const LIVE_MODEL = process.env.OPENAI_LIVE_MODEL || "gpt-live-1";
const BACKEND_MODEL = process.env.OPENAI_BACKEND_MODEL || "gpt-5.6-terra";
const LIVE_VOICE = process.env.OPENAI_LIVE_VOICE || "marin";

type SessionRequestBody = {
  sdp?: string;
  /** Short plain-text summary of app state at connect time (spec: share UI context). */
  context?: string;
  /** Optional prior text turns to seed the conversation. */
  history?: { role: "user" | "assistant"; text: string }[];
};

let client: OpenAI | null = null;
function openai() {
  if (!client) client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, maxRetries: 0 });
  return client;
}

export async function createLiveSession(req: Request, res: Response) {
  res.setHeader("Cache-Control", "no-store");
  if (!process.env.OPENAI_API_KEY) {
    res.status(503).json({ error: "OPENAI_API_KEY is not configured on the server" });
    return;
  }
  const body = (req.body ?? {}) as SessionRequestBody;
  if (typeof body.sdp !== "string" || !body.sdp.trim()) {
    res.status(400).json({ error: "An SDP offer is required" });
    return;
  }

  const contextNote = body.context?.trim()
    ? `\n\nCurrent app state: ${body.context.trim().slice(0, 1500)}`
    : "";

  const input: InitialItem[] = (body.history ?? [])
    .filter((t) => (t.role === "user" || t.role === "assistant") && typeof t.text === "string" && t.text.trim())
    .slice(-12)
    .map((t): InitialItem => {
      const text = t.text.trim().slice(0, 600);
      return t.role === "user"
        ? { type: "message", role: "user", content: [{ type: "input_text", text }] }
        : { type: "message", role: "assistant", content: [{ type: "output_text", text }] };
    });

  const params: LiveCreateParams = {
    session: {
      model: LIVE_MODEL,
      instructions: LIVE_INSTRUCTIONS + contextNote,
      audio: { output: { voice: LIVE_VOICE } },
      input,
      delegation: {
        type: "responses",
        responses: {
          model: BACKEND_MODEL,
          instructions: BACKEND_INSTRUCTIONS + contextNote,
          tools: [
            ...RHEA_TOOLS.map((t) => ({
              type: "function" as const,
              name: t.name,
              description: t.description,
              parameters: t.parameters,
              strict: false,
            })),
            { type: "web_search" as const },
          ],
          tool_choice: "auto",
          parallel_tool_calls: true,
          reasoning: { effort: "low" },
          text: { verbosity: "low" },
        },
      },
    },
    transport: { type: "webrtc", sdp: body.sdp },
  };

  try {
    const result = await openai().live.create(params);
    res.status(201).json(result);
  } catch (error) {
    if (error instanceof OpenAI.APIError) {
      console.error("[live] session creation failed", error.status, error.message);
      res.status(error.status ?? 502).json({ error: "Live session creation failed", detail: error.message });
      return;
    }
    const message = error instanceof Error ? error.message : String(error);
    console.error("[live] unexpected error", message);
    res.status(502).json({ error: "Live session creation failed", detail: message });
  }
}
