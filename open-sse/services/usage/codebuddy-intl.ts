/**
 * CodeBuddy International usage handler — scoped to the "codebuddy-intl" provider.
 *
 * The intl billing endpoint returns the exact same envelope as CN
 * (a POST to the get-user-resource meter route → { code: 0, data.Response.Data.Accounts[] }),
 * so the package parsing is shared verbatim from the CN handler — including the
 * refill/bonus split, which keys off the Cycle and Deduction time fields rather
 * than the host.
 *
 * Live payload from www.codebuddy.ai for a Free Plan account:
 *   PackageName "Free Plan Subscription", CapacitySize/CapacityUsed 100/0,
 *   CycleStartTime "2026-10-01 00:00:00", CycleEndTime "2026-10-31 23:59:59",
 *   DeductionEndTime far future → refill pack, monthly cadence.
 */

import { CODEBUDDY_INTL_USER_AGENT } from "../../config/providerHeaderProfiles.ts";
import { parseCodeBuddyAccounts, type CodeBuddyAccount } from "./codebuddy-cn-accounts.ts";

const USAGE_URL = "https://www.codebuddy.ai/v2/billing/meter/get-user-resource";

export interface CodeBuddyIntlUsageResult {
  plan?: string;
  quotas?: Record<
    string,
    {
      used: number;
      total: number;
      resetAt: string | null;
      unlimited: boolean;
    }
  >;
  message?: string;
}

export async function getCodeBuddyIntlUsage(
  accessToken?: string,
  apiKey?: string,
  _providerSpecificData?: unknown
): Promise<CodeBuddyIntlUsageResult> {
  const token = accessToken || apiKey;
  if (!token) {
    return { message: "CodeBuddy intl credential not available." };
  }

  try {
    const response = await fetch(USAGE_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
        "User-Agent": CODEBUDDY_INTL_USER_AGENT,
        "X-Product": "SaaS",
        "X-IDE-Type": "IDE",
        "X-IDE-Name": "IDE",
        "x-requested-with": "XMLHttpRequest",
        "x-codebuddy-request": "1",
      },
      body: "{}",
    });

    if (response.status === 401 || response.status === 403) {
      return { message: "CodeBuddy intl credential invalid or expired." };
    }
    if (!response.ok) {
      return { message: `CodeBuddy intl quota API error (${response.status}).` };
    }

    const json = (await response.json()) as {
      code?: number;
      msg?: string;
      data?: { Response?: { Data?: { Accounts?: CodeBuddyAccount[] } } };
    };
    if (json?.code !== 0) {
      return { message: `CodeBuddy intl quota error: ${json?.msg || "unknown"}` };
    }

    const accountsRaw = json?.data?.Response?.Data?.Accounts ?? [];
    if (accountsRaw.length === 0) {
      return { message: "CodeBuddy intl connected. No credit package found." };
    }

    return parseCodeBuddyAccounts(accountsRaw, "CodeBuddy intl");
  } catch {
    // Hard Rule #12: no raw err.message in any HTTP/SSE/executor response. Usage
    // handler returns a controlled string for the dashboard; do not include the
    // raw exception text in case it carries a path/stack snippet.
    return { message: "CodeBuddy intl error: failed to fetch quota." };
  }
}

export default getCodeBuddyIntlUsage;
