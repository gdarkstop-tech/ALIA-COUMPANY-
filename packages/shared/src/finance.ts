import type { AiMetric, AiProviderCode } from './ai';
import type { PlanCode } from './billing';

/**
 * AI Finance Center (ADR 0018). AI costs are USD micro-dollars (1 USD = 1 000 000) metered from
 * provider-reported tokens at the registry price; platform revenue is EGP piasters and comes only
 * from verified records. Nothing is estimated on the revenue side, and nothing here moves money.
 */
export type FinanceIntegrationState = 'NOT_CONFIGURED' | 'CONFIGURED' | 'DISABLED' | 'SIMULATED';

export type BudgetState = 'NO_BUDGET' | 'OK' | 'WARNING' | 'PROJECTED_OVER' | 'EXCEEDED';

export type AiFinanceOverview = {
  generatedAt: string;
  timezone: 'Africa/Cairo';
  /** Look-back window for the breakdowns (days, ending now). */
  days: number;
  /** Real-provider spend (simulated development usage is never counted as money). */
  spend: {
    todayMicros: number;
    weekMicros: number;
    monthMicros: number;
    periodMicros: number;
    /** Part of periodMicros priced at an unverified registry price (cost_estimated). */
    periodEstimatedMicros: number;
    /** Requests reserved but not yet settled (in flight or abandoned; no cost yet). */
    unsettledRequests: number;
    /** Development simulator requests in the period: no money spent. */
    simulatedRequests: number;
  };
  budget: {
    monthLimitMicros: number | null;
    monthSpendMicros: number;
    usedPct: number | null;
    /** Straight-line projection of this month's spend at the current daily rate. */
    projectedMonthMicros: number;
    projectedPct: number | null;
    state: BudgetState;
    daysElapsed: number;
    daysInMonth: number;
  };
  planBudgets: { plan: PlanCode; userMonthlyLimitMicros: number | null; planMonthlyLimitMicros: number | null; planMonthSpendMicros: number }[];
  alerts: { scope: 'COMPANY' | 'PLAN'; plan: PlanCode | null; month: string; thresholdPct: number; spendMicros: number; limitMicros: number; createdAt: string }[];
  byProvider: { provider: AiProviderCode; requests: number; costMicros: number; estimatedMicros: number }[];
  byModel: {
    provider: AiProviderCode;
    modelId: string;
    requests: number;
    answered: number;
    failed: number;
    inputTokens: number;
    outputTokens: number;
    costMicros: number;
    estimatedMicros: number;
    /** Cost of requests that did not produce a usable answer (refused, invalid output, truncated). */
    wastedMicros: number;
    costPerAnsweredMicros: number | null;
    costPer1kOutputTokensMicros: number | null;
  }[];
  /** Per AI feature (route), plus company evaluation runs as `evaluation`. */
  byFeature: { feature: string; description: string; metric: AiMetric | 'EVALUATION'; requests: number; units: number; costMicros: number }[];
  byPlan: { plan: PlanCode | 'NONE'; users: number; requests: number; costMicros: number }[];
  voice: { requests: number; minutes: number; costMicros: number };
  documents: { requests: number; costMicros: number };
  /** Highest-cost accounts in the period (pseudonymous reference; no names, no content). */
  topUsers: { userRef: string; accountKind: string; plan: PlanCode | null; requests: number; costMicros: number; sharePct: number }[];
  daily: { date: string; requests: number; costMicros: number }[];
  /** Metered cost vs what the provider invoiced, per provider and month (when an invoice was entered). */
  reconciliation: { month: string; provider: AiProviderCode; meteredMicros: number; invoicedMicros: number | null; varianceMicros: number | null; reference: string | null; recordedAt: string | null }[];
  revenue: {
    /** EGP piasters actually recorded as earned by the platform (verified records only). */
    recordedPiasters: number;
    sources: { source: 'APP_STORE' | 'GOOGLE_PLAY' | 'CARD_PAYMENTS' | 'VISIT_FEES'; state: FinanceIntegrationState; recordedPiasters: number | null }[];
    subscriptions: { plan: PlanCode; source: 'APPLE' | 'GOOGLE' | 'ADMIN_GRANT'; status: string; accounts: number }[];
    /** Provider ledger totals; demo rows are reported separately and never counted. */
    ledger: { entryType: string; status: string; isDemo: boolean; entries: number; amountPiasters: number }[];
  };
  /** Statements the console shows verbatim: what the numbers do not include. */
  limitations: ('NO_STORE_PROCEEDS' | 'NO_CARD_PAYMENTS' | 'NO_FX_CONVERSION' | 'OTHER_COSTS_NOT_TRACKED' | 'NO_PAYOUTS')[];
};

export type RecordProviderInvoiceBody = { provider: Exclude<AiProviderCode, 'SIMULATED'>; month: string; amountUsd: number; reference: string; note?: string };
