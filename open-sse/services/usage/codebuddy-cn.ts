/**
 * CodeBuddy CN usage handler — scoped to the "codebuddy-cn" provider.
 *
 * Quota lives behind a Tencent billing endpoint (POST, payload wrapped twice
 * under data.Response.Data). The package parsing — the refill/bonus split, the
 * cadence labels and the reset times — is shared with the intl handler in
 * ./codebuddy-cn-accounts.ts, because the envelope is identical across both
 * regions and only the host plus the CLI/IDE fingerprint differ.
 */

import { CODEBUDDY_CN_USER_AGENT } from "../../config/providerHeaderProfiles.ts";
import {
  parseCodeBuddyAccounts,
  type CodeBuddyAccount,
  type CodeBuddyUsageResult,
} from "./codebuddy-cn-accounts.ts";

const USAGE_URL = "https://copilot.tencent.com/v2/billing/meter/get-user-resource";

export type { CodeBuddyUsageResult };

export async function getCodeBuddyCnUsage(
  accessToken?: string,
  apiKey?: string,
  _providerSpecificData?: unknown
): Promise<CodeBuddyUsageResult> {
  const token = accessToken || apiKey;
  if (!token) {
    return { message: "CodeBuddy CN credential not available." };
  }

  try {
    const response = await fetch(USAGE_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
        "User-Agent": CODEBUDDY_CN_USER_AGENT,
        "X-Product": "SaaS",
        "X-IDE-Type": "CLI",
        "X-IDE-Name": "CLI",
        "x-requested-with": "XMLHttpRequest",
        "x-codebuddy-request": "1",
      },
      body: "{}",
    });

    if (response.status === 401 || response.status === 403) {
      return { message: "CodeBuddy CN credential invalid or expired." };
    }
    if (!response.ok) {
      return { message: `CodeBuddy CN quota API error (${response.status}).` };
    }

    const json = (await response.json()) as {
      code?: number;
      msg?: string;
      data?: { Response?: { Data?: { Accounts?: CodeBuddyAccount[] } } };
    };
    if (json?.code !== 0) {
      return { message: `CodeBuddy CN quota error: ${json?.msg || "unknown"}` };
    }

    const accountsRaw = json?.data?.Response?.Data?.Accounts ?? [];
    if (accountsRaw.length === 0) {
      return { message: "CodeBuddy CN connected. No credit package found." };
    }

    return parseCodeBuddyAccounts(accountsRaw, "CodeBuddy CN");
  } catch {
    // Hard Rule #12: no raw err.message in any HTTP/SSE/executor response. Usage
    // handler returns a controlled string for the dashboard; do not include the
    // raw exception text in case it carries a path/stack snippet.
    return { message: "CodeBuddy CN error: failed to fetch quota." };
  }
}

export default getCodeBuddyCnUsage;
