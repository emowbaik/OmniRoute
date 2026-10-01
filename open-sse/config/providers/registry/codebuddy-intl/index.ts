import { CODEBUDDY_INTL_USER_AGENT } from "../../../providerHeaderProfiles.ts";
import type { RegistryEntry } from "../../shared.ts";

/**
 * CodeBuddy International (codebuddy.ai) — www.codebuddy.ai.
 *
 * Separate registry entry from codebuddy-cn, NOT a host swap. The two issuers
 * mint tokens from different realms (`/auth/realms/copilot` vs Tencent's), so a
 * token from one is rejected by the other with 401 invalid_issuer. Keeping them
 * as two entries means a real CodeBuddy CN account can be added later without
 * either domain mixing into the other's connection row.
 *
 * Same OpenAI-compatible-but-stream-only gateway as CN (non-stream rejected with
 * code 11101), so `forceStream: true` lets chatCore keep the upstream stream
 * even for JSON clients and re-aggregate into a JSON body.
 *
 * Short alias "cbai" was reserved by the codebuddy-cn entry for exactly this
 * variant. All OAuth/plugin URLs use the /v2/plugin prefix with platform=ide
 * (CN uses platform=CLI).
 *
 * Model catalog is live-probed, NOT a copy of the CN list: the intl host serves
 * a different lineup and does not expose deepseek-v4-flash / deepseek-v4-pro /
 * deepseek-v3-2-volc / glm-4.7 / minimax-m2.7 / glm-5.0-turbo / hy3-preview
 * (all return code 11102 "service info not found"). The VansRouter intl entry
 * still lists several of those, so copying it would register dead models.
 */
export const codebuddy_intlProvider: RegistryEntry = {
  id: "codebuddy-intl",
  alias: "cbai",
  format: "openai",
  executor: "codebuddy-intl",
  baseUrl: "https://www.codebuddy.ai/v2/chat/completions",
  authType: "oauth",
  authHeader: "bearer",
  forceStream: true,
  headers: {
    "User-Agent": CODEBUDDY_INTL_USER_AGENT,
    "X-Product": "SaaS",
    "X-IDE-Type": "IDE",
    "X-IDE-Name": "IDE",
    "x-requested-with": "XMLHttpRequest",
    "x-codebuddy-request": "1",
  },
  models: [
    // contextLength is the OmniRoute analogue of upstream's contextWindow;
    // supportsReasoning + supportsVision drive UI affordances and translator
    // decisions. Values mirror the CN entry where the model exists on both
    // hosts (same underlying catalog service).
    {
      id: "glm-5.2",
      name: "GLM-5.2",
      contextLength: 1000000,
      maxOutputTokens: 48000,
      supportsReasoning: true,
    },
    {
      id: "glm-5.1",
      name: "GLM-5.1",
      contextLength: 200000,
      maxOutputTokens: 48000,
      supportsReasoning: true,
    },
    {
      id: "glm-5.0",
      name: "GLM-5.0",
      contextLength: 200000,
      maxOutputTokens: 48000,
      supportsReasoning: true,
    },
    {
      id: "glm-5v-turbo",
      name: "GLM-5v-Turbo",
      contextLength: 200000,
      maxOutputTokens: 38000,
      supportsReasoning: true,
      supportsVision: true,
    },
    {
      id: "minimax-m3",
      name: "MiniMax-M3",
      contextLength: 512000,
      maxOutputTokens: 48000,
      supportsReasoning: true,
      supportsVision: true,
    },
    {
      id: "kimi-k2.7",
      name: "Kimi-K2.7-Code",
      contextLength: 256000,
      maxOutputTokens: 32000,
      supportsReasoning: true,
      supportsVision: true,
    },
    {
      id: "kimi-k2.6",
      name: "Kimi-K2.6",
      contextLength: 256000,
      maxOutputTokens: 32000,
      supportsReasoning: true,
      supportsVision: true,
    },
    {
      id: "kimi-k2.5",
      name: "Kimi-K2.5",
      contextLength: 164000,
      maxOutputTokens: 32000,
      supportsReasoning: true,
      supportsVision: true,
    },
    {
      id: "hy3",
      name: "Hy3",
      contextLength: 192000,
      maxOutputTokens: 64000,
      supportsReasoning: true,
      supportsVision: true,
    },
    {
      id: "deepseek-v4.1-flash",
      name: "DeepSeek-V4.1-Flash",
      contextLength: 1000000,
      maxOutputTokens: 50000,
      supportsReasoning: true,
      supportsVision: true,
    },
  ],
};

export default codebuddy_intlProvider;
