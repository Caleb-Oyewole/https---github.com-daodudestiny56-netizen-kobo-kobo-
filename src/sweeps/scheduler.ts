import cron from 'node-cron';
import type { Deps } from '../deps';
import { toWatDate, WAT_TZ } from '../time';
import { retryPendingWithdrawals } from '../withdrawals/service';
import { runNightlyBatch } from './batch';

/**
 * 23:00 WAT: the nightly sweep. 23:30 WAT: the same job again, which is the retry (finished sweeps are skipped,
 * PENDING ones resume with the same idempotency key). Both complete inside the 23:00-23:59 window.
 */
export function startScheduler(deps: Deps): { stop(): void } {
  const { sweepCron, retryCron } = deps.config.scheduler;
  for (const expr of [sweepCron, retryCron]) {
    if (!cron.validate(expr)) throw new Error(`Invalid cron expression: ${expr}`);
  }

  const run = async (label: string) => {
    const date = toWatDate(deps.clock());
    try {
      const r = await runNightlyBatch(deps, date);
      console.log(`[scheduler] ${label} ${date}:`, r.alreadyRunning ? 'another instance is running it' : JSON.stringify(r.summary));
    } catch (e) {
      console.error(`[scheduler] ${label} ${date} failed:`, e);
    }
  };

  const tasks = [
    cron.schedule(sweepCron, () => void run('nightly'), { timezone: WAT_TZ }),
    cron.schedule(retryCron, () => void run('retry'), { timezone: WAT_TZ }),
  ];
  // Withdrawals whose bank outcome was unknown are replayed (same idempotency key) every minute.
  const withdrawalTimer = setInterval(() => {
    retryPendingWithdrawals(deps).catch((e) => console.error('[scheduler] withdrawal retry failed:', e));
  }, 60_000);
  withdrawalTimer.unref();
  return {
    stop: () => {
      tasks.forEach((t) => t.stop());
      clearInterval(withdrawalTimer);
    },
  };
}
