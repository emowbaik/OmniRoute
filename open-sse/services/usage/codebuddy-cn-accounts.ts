/**
 * Shared CodeBuddy credit-package parser.
 *
 * Both CodeBuddy regions bill through the same envelope
 * (POST …/v2/billing/meter/get-user-resource → { code: 0, data.Response.Data.Accounts[] }),
 * and the refill/bonus distinction is derived from the time fields, not the host:
 *
 *  - Refill / base packs: recurring allowance whose cycle resets long before the
 *    resource itself expires (CycleEndTime << DeductionEndTime). Live numbers in
 *    the *Cycle* fields; resetAt = next refresh.
 *  - Bonus packs: one-shot credits that run a single cycle and expire
 *    (CycleEndTime ≈ DeductionEndTime). Numbers in the plain Capacity fields.
 *
 * One quota row per package — cadence label (Monthly/Weekly/Daily) for refill
 * packs, "Bonus Pack N" for bonus packs (soonest-expiring first).
 *
 * Kept host-agnostic so codebuddy-cn and codebuddy-intl cannot drift apart.
 */

export interface CodeBuddyAccount {
  PackageName?: string;
  SubProductName?: string;
  CycleStartTime?: string | number;
  CycleEndTime?: string | number;
  DeductionEndTime?: string | number;
  CycleCapacitySize?: number | string;
  CycleCapacitySizePrecise?: string | number;
  CycleCapacityUsed?: number | string;
  CycleCapacityUsedPrecise?: string | number;
  CapacitySize?: number | string;
  CapacitySizePrecise?: string | number;
  CapacityUsed?: number | string;
  CapacityUsedPrecise?: string | number;
}

export interface CodeBuddyUsageResult {
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

export function parseResetTime(value: unknown): string | null {
  if (!value) return null;
  try {
    if (value instanceof Date) return value.toISOString();
    if (typeof value === "number") {
      const ts = value < 1e12 ? value * 1000 : value;
      const d = new Date(ts);
      return d.getTime() > 0 ? d.toISOString() : null;
    }
    if (typeof value === "string") {
      if (/^\d+$/.test(value)) {
        const n = Number(value);
        const d = new Date(n < 1e12 ? n * 1000 : n);
        return d.getTime() > 0 ? d.toISOString() : null;
      }
      const d = new Date(value);
      return Number.isNaN(d.getTime()) || d.getTime() <= 0 ? null : d.toISOString();
    }
    return null;
  } catch {
    return null;
  }
}

// Prefer the *Precise string fields (exact), fall back to the numeric ones.
function num(precise: unknown, plain: unknown): number {
  const n = Number(precise ?? plain);
  return Number.isFinite(n) ? n : 0;
}

// Label a refill pack by its cycle length (Monthly is the common CodeBuddy case).
function refillCadence(acc: CodeBuddyAccount): "Monthly" | "Weekly" | "Daily" {
  const start = parseResetTime(acc.CycleStartTime);
  const end = parseResetTime(acc.CycleEndTime);
  if (start && end) {
    const days = (new Date(end).getTime() - new Date(start).getTime()) / 86400000;
    if (days <= 1.5) return "Daily";
    if (days <= 10) return "Weekly";
  }
  return "Monthly";
}

function cycleEndMs(acc: CodeBuddyAccount): number {
  const r = parseResetTime(acc.CycleEndTime);
  return r ? new Date(r).getTime() : Number.POSITIVE_INFINITY;
}

function deductionEndMs(acc: CodeBuddyAccount): number {
  const v = acc.DeductionEndTime;
  if (typeof v === "number") return v < 1e12 ? v * 1000 : v;
  if (typeof v === "string" && /^\d+$/.test(v)) {
    const n = Number(v);
    return n < 1e12 ? n * 1000 : n;
  }
  const r = parseResetTime(v);
  return r ? new Date(r).getTime() : Number.POSITIVE_INFINITY;
}

// Refill packs roll into a new cycle before the resource expires; bonus packs
// end at expiry. >2d gap between cycle end and validity end = refill.
const REFILL_GAP_MS = 2 * 24 * 60 * 60 * 1000;
function isRefill(acc: CodeBuddyAccount): boolean {
  const ce = cycleEndMs(acc);
  const de = deductionEndMs(acc);
  return Number.isFinite(ce) && Number.isFinite(de) && de - ce > REFILL_GAP_MS;
}

/**
 * Turn a raw Accounts[] array into the dashboard's plan + quota-row shape.
 *
 * `fallbackPlan` is the plan label used when the account carries neither
 * PackageName nor SubProductName — region-specific ("CodeBuddy CN" vs
 * "CodeBuddy intl"), so it stays a caller-supplied string.
 */
export function parseCodeBuddyAccounts(
  accountsRaw: CodeBuddyAccount[],
  fallbackPlan: string
): CodeBuddyUsageResult {
  const byExpiry = (a: CodeBuddyAccount, b: CodeBuddyAccount) => cycleEndMs(a) - cycleEndMs(b);
  const refills = accountsRaw.filter(isRefill).sort(byExpiry);
  const bonuses = accountsRaw.filter((a) => !isRefill(a)).sort(byExpiry);

  const quotas: NonNullable<CodeBuddyUsageResult["quotas"]> = {};
  const seenRefill: Record<string, number> = {};
  refills.forEach((acc) => {
    const base = refillCadence(acc);
    seenRefill[base] = (seenRefill[base] || 0) + 1;
    const name = seenRefill[base] > 1 ? `${base} ${seenRefill[base]}` : base;
    quotas[name] = {
      used: num(acc.CycleCapacityUsedPrecise, acc.CycleCapacityUsed),
      total: num(acc.CycleCapacitySizePrecise, acc.CycleCapacitySize),
      resetAt: parseResetTime(acc.CycleEndTime),
      unlimited: false,
    };
  });
  bonuses.forEach((acc, i) => {
    quotas[`Bonus Pack ${i + 1}`] = {
      used: num(acc.CapacityUsedPrecise, acc.CapacityUsed),
      total: num(acc.CapacitySizePrecise, acc.CapacitySize),
      resetAt: parseResetTime(acc.CycleEndTime),
      unlimited: false,
    };
  });

  const basePkg = refills[0] || accountsRaw[0] || {};
  const plan = basePkg.PackageName || basePkg.SubProductName || fallbackPlan;

  return { plan, quotas };
}
