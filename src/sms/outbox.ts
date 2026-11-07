import type { Queryable } from '../db/pool';

export type SmsKind = 'SWEEP_RECEIPT' | 'SWEEP_SKIPPED' | 'SWEEP_HELD' | 'COMMAND_REPLY' | 'WITHDRAWAL';

/**
 * Queue an SMS. Call it with the same transaction client as the event that caused it, so a text exists if and only
 * if the event committed. `dedupeKey` makes retries harmless (returns false when it was already queued).
 */
export async function enqueueSms(
  db: Queryable,
  m: { merchantId: string | null; to: string; kind: SmsKind; body: string; dedupeKey?: string },
): Promise<boolean> {
  const r = await db.query(
    `INSERT INTO sms_outbox (merchant_id, to_phone, kind, body, dedupe_key) VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (dedupe_key) DO NOTHING`,
    [m.merchantId, m.to, m.kind, m.body, m.dedupeKey ?? null],
  );
  return (r.rowCount ?? 0) > 0;
}
