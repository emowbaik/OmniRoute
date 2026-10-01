import test from "node:test";
import assert from "node:assert/strict";

import {
  AI_PROVIDERS,
  USAGE_SUPPORTED_PROVIDERS,
  supportsDualAuthProvider,
} from "../../src/shared/constants/providers.ts";
import { REGISTRY } from "../../open-sse/config/providerRegistry.ts";
import { getExecutor } from "../../open-sse/executors/index.ts";
import { CodeBuddyIntlExecutor } from "../../open-sse/executors/codebuddy-intl.ts";
import {
  PROVIDERS as OAUTH_PROVIDER_IDS,
  CODEBUDDY_CN_CONFIG,
  CODEBUDDY_INTL_CONFIG,
  CODEBUDDY_CN_USER_AGENT,
  CODEBUDDY_INTL_USER_AGENT,
} from "../../src/lib/oauth/constants/oauth.ts";
import PROVIDERS_MAP from "../../src/lib/oauth/providers/index.ts";
import { supportsTokenRefresh } from "../../open-sse/services/tokenRefresh.ts";
import { OAUTH_PROVIDERS as UI_OAUTH_PROVIDERS } from "../../src/shared/constants/providers/oauth.ts";
import { getCodeBuddyIntlUsage } from "../../open-sse/services/usage/codebuddy-intl.ts";
import { getCodeBuddyCnUsage } from "../../open-sse/services/usage/codebuddy-cn.ts";
import { parseCodeBuddyAccounts } from "../../open-sse/services/usage/codebuddy-cn-accounts.ts";

const INTL_BASE = "https://www.codebuddy.ai";

type CapturedRequest = {
  url: string;
  init?: RequestInit;
  body: Record<string, unknown>;
};

async function executeWithMockedUpstream(
  body: Record<string, unknown>,
  responses: Response[]
): Promise<{ calls: CapturedRequest[]; responseBody: string; status: number }> {
  const originalFetch = globalThis.fetch;
  const calls: CapturedRequest[] = [];
  globalThis.fetch = async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(url),
      init,
      body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>,
    });
    const response = responses.shift();
    assert.ok(response, "unexpected extra upstream dispatch");
    return response;
  };

  try {
    const executor = new CodeBuddyIntlExecutor();
    const result = await executor.execute({
      model: "glm-5.2",
      body,
      stream: false,
      credentials: { accessToken: "test-token" },
    });
    const response = result instanceof Response ? result : result.response;
    return { calls, responseBody: await response.clone().text(), status: response.status };
  } finally {
    globalThis.fetch = originalFetch;
  }
}

function sseResponse(chunks: string[] = ["data: [DONE]\n\n"]): Response {
  return new Response(chunks.join(""), {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

/* ------------------------------------------------------------------ *
 * Registry / wiring
 * ------------------------------------------------------------------ */

test("codebuddy-intl is registered as its own provider, separate from codebuddy-cn", () => {
  const entry = REGISTRY["codebuddy-intl"];
  assert.ok(entry, "codebuddy-intl must exist in the provider registry");
  assert.equal(entry.id, "codebuddy-intl");
  assert.equal(entry.alias, "cbai");
  // The short alias "cbai" is reserved for the international variant.
  assert.equal(REGISTRY["codebuddy-cn"].alias, "cbcn");

  // Both regions must coexist as distinct entries pointing at distinct hosts.
  // baseUrl carries the full chat path in this registry, so compare on origin.
  const cn = REGISTRY["codebuddy-cn"];
  const intlOrigin = new URL(entry.baseUrl).origin;
  const cnOrigin = new URL(cn.baseUrl).origin;
  assert.equal(intlOrigin, INTL_BASE);
  assert.equal(cnOrigin, "https://copilot.tencent.com");
  assert.notEqual(intlOrigin, cnOrigin);
  assert.ok(!cn.baseUrl.includes("codebuddy.ai"));
});

test("the intl gateway is stream-only, so the entry must force streaming", () => {
  const entry = REGISTRY["codebuddy-intl"];
  assert.equal(entry.forceStream, true, "www.codebuddy.ai rejects non-stream (code 11101)");
});

test("the intl catalog is the live-probed .ai catalog, not a copy of CN", () => {
  const entry = REGISTRY["codebuddy-intl"];
  const models = entry.models.map((m) => (typeof m === "string" ? m : m.id));
  assert.ok(models.length > 0, "intl entry must ship a model catalog");
  // Proven live against www.codebuddy.ai.
  assert.ok(models.includes("glm-5.2"));
  assert.ok(models.includes("deepseek-v4.1-flash"));
  // These exist in the CN/Vans catalogs but are NOT served by the .ai host —
  // they must not have been copied over.
  const cnModels = new Set(
    REGISTRY["codebuddy-cn"].models.map((m) => (typeof m === "string" ? m : m.id))
  );
  const bogus = ["deepseek-v3-2-volc", "minimax-m2.7", "hunyuan-t2"];
  for (const id of bogus) {
    if (cnModels.has(id)) {
      assert.ok(!models.includes(id), `${id} is CN-only and must not be in the intl catalog`);
    }
  }
});

test("provider constants, OAuth ids and UI metadata all expose codebuddy-intl", () => {
  assert.equal(AI_PROVIDERS["codebuddy-intl"]?.id, "codebuddy-intl");
  assert.equal(OAUTH_PROVIDER_IDS.CODEBUDDY_INTL, "codebuddy-intl");
  assert.equal(UI_OAUTH_PROVIDERS["codebuddy-intl"]?.alias, "cbai");
  assert.equal(UI_OAUTH_PROVIDERS["codebuddy-intl"]?.website, INTL_BASE);
  assert.equal(PROVIDERS_MAP["codebuddy-intl"], PROVIDERS_MAP["codebuddy-intl"]);
  assert.equal(UI_OAUTH_PROVIDERS["codebuddy-cn"]?.website, CODEBUDDY_CN_CONFIG.baseUrl);
});

test("token refresh and usage support are wired for codebuddy-intl", () => {
  assert.equal(supportsTokenRefresh("codebuddy-intl"), true);
  assert.ok(
    USAGE_SUPPORTED_PROVIDERS.includes("codebuddy-intl"),
    "codebuddy-intl must be in the usage-supported provider list"
  );
  // Dual-auth: OAuth login OR pasted API key.
  assert.equal(supportsDualAuthProvider("codebuddy-intl"), true);
});

test("the executor map resolves codebuddy-intl and its cbai alias to the intl executor", async () => {
  const direct = await getExecutor("codebuddy-intl");
  const alias = await getExecutor("cbai");
  assert.equal(direct?.constructor.name, "CodeBuddyIntlExecutor");
  assert.equal(alias?.constructor.name, "CodeBuddyIntlExecutor");
  // The CN alias must NOT resolve to the intl executor.
  assert.equal((await getExecutor("cbcn"))?.constructor.name, "CodeBuddyCnExecutor");
  assert.equal((await getExecutor("codebuddy-cn"))?.constructor.name, "CodeBuddyCnExecutor");
});

/* ------------------------------------------------------------------ *
 * Issuer separation — the whole reason this is a separate provider
 * ------------------------------------------------------------------ */

test("intl and CN OAuth configs target different issuers", () => {
  assert.equal(CODEBUDDY_INTL_CONFIG.baseUrl, INTL_BASE);
  assert.equal(CODEBUDDY_INTL_CONFIG.domain, "www.codebuddy.ai");
  // The .ai host is the IDE product; CN is the CLI. Mixing these is what the
  // upstream WAF flags, and the platform param is part of the request contract.
  assert.equal(CODEBUDDY_INTL_CONFIG.platform, "ide");
  assert.equal(CODEBUDDY_CN_CONFIG.platform, "CLI");

  // Every intl endpoint must live on the .ai host, never on the CN host.
  for (const key of ["stateUrl", "tokenUrl", "refreshUrl"] as const) {
    assert.ok(
      CODEBUDDY_INTL_CONFIG[key].startsWith(INTL_BASE),
      `${key} must be on the .ai host, got ${CODEBUDDY_INTL_CONFIG[key]}`
    );
    assert.ok(!CODEBUDDY_INTL_CONFIG[key].includes("tencent"));
  }
});

test("intl and CN use distinct client fingerprints", () => {
  assert.equal(CODEBUDDY_INTL_USER_AGENT, "IDE/2.108.1 CodeBuddy/2.108.1");
  assert.equal(CODEBUDDY_CN_USER_AGENT, "CLI/2.108.1 CodeBuddy/2.108.1");
  assert.notEqual(CODEBUDDY_INTL_USER_AGENT, CODEBUDDY_CN_USER_AGENT);
  // The three intl call sites must all share one constant.
  assert.equal(CODEBUDDY_INTL_CONFIG.userAgent, CODEBUDDY_INTL_USER_AGENT);
});

/* ------------------------------------------------------------------ *
 * Executor request shaping
 * ------------------------------------------------------------------ */

test("chat completions hit the .ai host with the IDE fingerprint", async () => {
  const { calls } = await executeWithMockedUpstream(
    { messages: [{ role: "user", content: "hi" }] },
    [sseResponse()]
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `${INTL_BASE}/v2/chat/completions`);
  const headers = calls[0].init?.headers as Record<string, string>;
  assert.equal(headers["User-Agent"], CODEBUDDY_INTL_USER_AGENT);
  assert.equal(headers["X-IDE-Type"], "IDE");
  assert.equal(headers["X-IDE-Name"], "IDE");
  assert.equal(headers["Authorization"], "Bearer test-token");
  assert.ok(!JSON.stringify(headers).includes("tencent"));
});

test("non-stream client requests are upgraded to stream upstream", async () => {
  const { calls } = await executeWithMockedUpstream(
    { messages: [{ role: "user", content: "hi" }], stream: false },
    [sseResponse()]
  );
  // The gateway answers non-stream with code 11101, so forceStream must win.
  assert.equal(calls[0].body.stream, true);
});

test("the required CodeBuddy system prompt is prepended and client system messages are dropped", async () => {
  const { calls } = await executeWithMockedUpstream(
    {
      messages: [
        { role: "system", content: "You are a helpful pirate assistant." },
        { role: "user", content: "hi" },
      ],
    },
    [sseResponse()]
  );
  const messages = calls[0].body.messages as Array<{ role: string; content: unknown }>;
  const first = messages[0];
  const firstText =
    typeof first.content === "string" ? first.content : JSON.stringify(first.content);
  assert.ok(firstText.includes("You are CodeBuddy Code."), "required prompt must be first");
  assert.ok(
    !firstText.includes("pirate"),
    "client system prompt must not reach the upstream system slot"
  );
  // No leftover system-role messages anywhere in the array.
  assert.ok(
    !messages.slice(1).some((m) => m.role === "system" || m.role === "developer"),
    "system/developer messages must be stripped"
  );
});

test("string user content is converted to typed content parts", async () => {
  const { calls } = await executeWithMockedUpstream(
    { messages: [{ role: "user", content: "hello world" }] },
    [sseResponse()]
  );
  const messages = calls[0].body.messages as Array<{ role: string; content: unknown }>;
  const user = messages.find((m) => m.role === "user");
  assert.ok(Array.isArray(user?.content), "string user content must become an array");
  assert.deepEqual(user?.content, [{ type: "text", text: "hello world" }]);
});

test("multimodal user content is preserved untouched", async () => {
  const content = [
    { type: "text", text: "look" },
    { type: "image_url", image_url: { url: "https://example.com/a.png" } },
  ];
  const { calls } = await executeWithMockedUpstream({ messages: [{ role: "user", content }] }, [
    sseResponse(),
  ]);
  const messages = calls[0].body.messages as Array<{ role: string; content: unknown }>;
  const user = messages.find((m) => m.role === "user");
  assert.deepEqual(user?.content, content);
});

test("reasoning stays opt-in — plain requests get no reasoning_summary", async () => {
  const { calls } = await executeWithMockedUpstream(
    { messages: [{ role: "user", content: "hi" }] },
    [sseResponse()]
  );
  assert.equal(calls[0].body.reasoning_summary, undefined);
  assert.equal(calls[0].body.reasoning_effort, undefined);
});

test("reasoning_summary:auto is added only when the client asks for reasoning", async () => {
  const { calls } = await executeWithMockedUpstream(
    { messages: [{ role: "user", content: "hi" }], reasoning_effort: "medium" },
    [sseResponse()]
  );
  assert.equal(calls[0].body.reasoning_summary, "auto");
});

test("reasoning_effort none/off is removed rather than forwarded as 'none'", async () => {
  for (const effort of ["none", "off"]) {
    const { calls } = await executeWithMockedUpstream(
      { messages: [{ role: "user", content: "hi" }], reasoning_effort: effort },
      [sseResponse()]
    );
    assert.equal(
      calls[0].body.reasoning_effort,
      undefined,
      `${effort} must be stripped, not forwarded`
    );
    assert.equal(calls[0].body.reasoning_summary, undefined);
  }
});

test("tool definitions survive the upstream rewrite", async () => {
  const tools = [
    {
      type: "function",
      function: { name: "read_file", description: "Read", parameters: { type: "object" } },
    },
  ];
  const { calls } = await executeWithMockedUpstream(
    { messages: [{ role: "user", content: "use a tool" }], tools, tool_choice: "auto" },
    [sseResponse()]
  );
  assert.deepEqual(calls[0].body.tools, tools);
  assert.equal(calls[0].body.tool_choice, "auto");
});

/* ------------------------------------------------------------------ *
 * Usage / quota
 * ------------------------------------------------------------------ */

test("intl usage handler queries the .ai billing host with the IDE fingerprint", async () => {
  const originalFetch = globalThis.fetch;
  const calls: CapturedRequest[] = [];
  globalThis.fetch = async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init, body: {} });
    return new Response(
      JSON.stringify({
        code: 0,
        data: {
          Response: {
            Data: {
              Accounts: [
                {
                  PackageName: "Free Plan Subscription",
                  CycleStartTime: "2026-10-01 00:00:00",
                  CycleEndTime: "2026-10-31 23:59:59",
                  DeductionEndTime: "2027-08-01 00:00:00",
                  CycleCapacitySize: 100,
                  CycleCapacityUsed: 0,
                },
              ],
            },
          },
        },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  };

  try {
    const result = await getCodeBuddyIntlUsage("test-token");
    assert.equal(calls[0].url, `${INTL_BASE}/v2/billing/meter/get-user-resource`);
    const headers = calls[0].init?.headers as Record<string, string>;
    assert.equal(headers["User-Agent"], CODEBUDDY_INTL_USER_AGENT);
    assert.equal(headers["X-IDE-Type"], "IDE");
    assert.equal(result.plan, "Free Plan Subscription");
    assert.equal(result.quotas?.Monthly.total, 100);
    assert.equal(result.quotas?.Monthly.used, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("intl usage reports an invalid credential without leaking the exception", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("nope", { status: 401 });
  try {
    const result = await getCodeBuddyIntlUsage("bad-token");
    assert.match(result.message ?? "", /invalid or expired/i);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("intl usage never contacts the CN host, and a fetch throw stays sanitized", async () => {
  const originalFetch = globalThis.fetch;
  const urls: string[] = [];
  globalThis.fetch = async (url: string | URL | Request) => {
    urls.push(String(url));
    throw new Error("socket hang up at /home/secret/path.ts:42");
  };
  try {
    const result = await getCodeBuddyIntlUsage("test-token");
    assert.ok(
      urls.every((u) => !u.includes("tencent")),
      "intl usage must never touch copilot.tencent.com"
    );
    assert.ok(!result.message?.includes("/home/secret"), "raw error text must not leak");
    assert.match(result.message ?? "", /failed to fetch quota/i);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("CN and intl parse the shared account envelope but label plans per region", () => {
  const accounts = [
    {
      PackageName: "",
      SubProductName: "",
      CycleStartTime: "2026-10-01 00:00:00",
      CycleEndTime: "2026-10-31 23:59:59",
      DeductionEndTime: "2027-08-01 00:00:00",
      CycleCapacitySize: 100,
      CycleCapacityUsed: 12,
    },
    {
      PackageName: "Bonus Credits",
      CycleStartTime: "2026-10-01 00:00:00",
      CycleEndTime: "2026-10-05 00:00:00",
      DeductionEndTime: "2026-10-05 00:00:00",
      CapacitySize: 50,
      CapacityUsed: 5,
    },
  ];
  const intl = parseCodeBuddyAccounts(accounts, "CodeBuddy intl");
  const cn = parseCodeBuddyAccounts(accounts, "CodeBuddy CN");
  assert.equal(intl.plan, "CodeBuddy intl");
  assert.equal(cn.plan, "CodeBuddy CN");
  // Refill pack keeps live counters; bonus pack is a one-shot row.
  assert.deepEqual(intl.quotas, cn.quotas);
  assert.equal(intl.quotas?.Monthly.used, 12);
  assert.equal(intl.quotas?.["Bonus Pack 1"].used, 5);
  assert.equal(intl.quotas?.["Bonus Pack 1"].total, 50);
});

test("CN usage still talks to the Tencent host after the parser refactor", async () => {
  const originalFetch = globalThis.fetch;
  const urls: string[] = [];
  globalThis.fetch = async (url: string | URL | Request) => {
    urls.push(String(url));
    return new Response(
      JSON.stringify({
        code: 0,
        data: { Response: { Data: { Accounts: [] } } },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  };
  try {
    const result = await getCodeBuddyCnUsage("test-token");
    assert.equal(urls[0], "https://copilot.tencent.com/v2/billing/meter/get-user-resource");
    assert.match(result.message ?? "", /No credit package found/i);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
