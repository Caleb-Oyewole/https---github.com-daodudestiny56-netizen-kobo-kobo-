import type { Kobo } from './money';

/**
 * Sweep Guard seam (owned by the AI/ML service). Core asks before it records or moves anything;
 * a HOLD stops the sweep (status HELD_GUARD), raises an alert row and texts the trader.
 */
export interface GuardInflow {
  bankReference: string;
  amount: Kobo;
  settledAt: Date;
}
export interface GuardContext {
  merchantId: string;
  sweepDate: string;
  takings: Kobo;
  inflows: GuardInflow[];
}
export type GuardAlertType = 'ANOMALOUS_INFLOW' | 'SUSPECTED_DUPLICATE' | 'NAME_MISMATCH' | 'LOW_BUFFER';
export type GuardVerdict = { verdict: 'CLEAR' } | { verdict: 'HOLD'; alertType: GuardAlertType; details: Record<string, unknown> };

export interface SweepGuard {
  evaluate(ctx: GuardContext): Promise<GuardVerdict>;
}

/** Default until the AI service is wired in: everything passes. */
export class AllowAllGuard implements SweepGuard {
  async evaluate(): Promise<GuardVerdict> {
    return { verdict: 'CLEAR' };
  }
}
