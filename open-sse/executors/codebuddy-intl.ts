import { DefaultExecutor } from "./default.ts";
import type { ExecuteInput, ExecutorExecuteResult, ProviderCredentials } from "./base.ts";

const REQUIRED_SYSTEM_PROMPT = "You are CodeBuddy Code.";

/**
 * CodeBuddyIntlExecutor — talks to https://www.codebuddy.ai/v2/chat/completions
 *
 * Three intl-specific deviations from the plain OpenAI shape, all verified
 * against the live host:
 *
 *  1. Stream-only gateway (same as CN): non-stream requests are rejected with
 *     code 11101. The same-format (openai→openai) translator path leaves
 *     body.stream as the client sent it, so force it true here — OmniRoute
 *     re-aggregates the SSE into a JSON response for non-streaming clients.
 *
 *  2. Reasoning is opt-in. reasoning_summary:"auto" is only added when the
 *     client explicitly set reasoning_effort; plain requests are left untouched
 *     because forcing reasoning on them trips the content filter. A caller
 *     asking for "none"/"off" gets the field dropped entirely (no "none" value).
 *
 *  3. Message shape. A bare OpenAI request is rejected with 11101 invalid
 *     request: the gateway needs a leading system message AND user content as
 *     typed blocks ([{type:"text",text}]) rather than a bare string. Client
 *     system/developer messages are dropped — the intl gateway substitutes its
 *     own IDE identity, and a client agent prompt (Claude Code, Cursor, …) is
 *     what its content filter flags.
 */
export class CodeBuddyIntlExecutor extends DefaultExecutor {
  constructor() {
    super("codebuddy-intl");
  }

  async execute(input: ExecuteInput): Promise<ExecutorExecuteResult> {
    return super.execute(input);
  }

  transformRequest(
    model: string,
    body: unknown,
    stream: boolean,
    credentials: ProviderCredentials
  ): unknown {
    // DefaultExecutor mutates in place on some paths; the message rebuild below
    // creates a new array but reuses the caller's message objects, so clone
    // first to keep the incoming body intact for the caller's own bookkeeping.
    const input = body && typeof body === "object" ? structuredClone(body) : body;
    const transformed = super.transformRequest(model, input, stream, credentials);
    if (!transformed || typeof transformed !== "object" || Array.isArray(transformed)) {
      return transformed;
    }
    const out = transformed as Record<string, unknown>;
    out.stream = true;

    const eff = out.reasoning_effort;
    if (eff === "none" || eff === "off") {
      delete out.reasoning_effort;
    } else if (eff) {
      out.reasoning_summary = "auto";
    }

    // CodeBuddy intl rejects the plain OpenAI shape (11101 invalid request):
    // needs a leading system prompt + user content as typed blocks, not a bare
    // string. Guard against duplicating the required prompt when the caller's
    // history already replays it.
    const source = Array.isArray(out.messages) ? out.messages : [];
    const messages: Array<Record<string, unknown>> = [
      { role: "system", content: REQUIRED_SYSTEM_PROMPT },
    ];
    for (const message of source) {
      if (!message || typeof message !== "object") continue;
      const role = (message as Record<string, unknown>).role;
      // Client system/developer prompts are dropped, which also drops any replay
      // of REQUIRED_SYSTEM_PROMPT — so it can never appear twice in the output.
      if (role === "system" || role === "developer") continue;
      if (role === "user" && typeof (message as Record<string, unknown>).content === "string") {
        messages.push({
          ...(message as Record<string, unknown>),
          content: [{ type: "text", text: (message as Record<string, unknown>).content as string }],
        });
      } else {
        messages.push({ ...(message as Record<string, unknown>) });
      }
    }
    out.messages = messages;

    return out;
  }
}

export default CodeBuddyIntlExecutor;
