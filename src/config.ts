import 'dotenv/config';

const int = (v: string | undefined, d: number): number => (v === undefined || v === '' ? d : Number(v));
const bool = (v: string | undefined, d: boolean): boolean => (v === undefined || v === '' ? d : v === 'true');

export interface SweepTuning {
  /** Merchants processed in parallel during the nightly batch. */
  batchConcurrency: number;
  /** Debit attempts inside a single run (with exponential backoff between them). */
  inRunTries: number;
  /** Total debit attempts across all runs of the night before a sweep is marked FAILED. */
  maxAttempts: number;
  backoffBaseMs: number;
}

export interface AppConfig {
  databaseUrl: string;
  port: number;
  serviceToken: string;
  webhookToken: string;
  executorMode: 'mock' | 'http';
  railsBaseUrl: string;
  railsServiceToken: string;
  scheduler: { enabled: boolean; sweepCron: string; retryCron: string };
  sweep: SweepTuning;
  sms: {
    provider: 'console' | 'africastalking';
    atUsername: string;
    atApiKey: string;
    atSenderId: string;
    dispatchIntervalMs: number;
    maxAttempts: number;
  };
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return {
    databaseUrl: env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/kobo',
    port: int(env.PORT, 3000),
    serviceToken: env.SERVICE_TOKEN ?? '',
    webhookToken: env.WEBHOOK_TOKEN ?? '',
    executorMode: env.EXECUTOR_MODE === 'http' ? 'http' : 'mock',
    railsBaseUrl: env.RAILS_BASE_URL ?? 'http://localhost:3001',
    railsServiceToken: env.RAILS_SERVICE_TOKEN ?? '',
    scheduler: {
      enabled: bool(env.SCHEDULER_ENABLED, true),
      sweepCron: env.SWEEP_CRON ?? '0 23 * * *',
      retryCron: env.SWEEP_RETRY_CRON ?? '30 23 * * *',
    },
    sweep: {
      batchConcurrency: int(env.SWEEP_BATCH_CONCURRENCY, 10),
      inRunTries: int(env.SWEEP_IN_RUN_TRIES, 3),
      maxAttempts: int(env.SWEEP_MAX_ATTEMPTS, 6),
      backoffBaseMs: int(env.SWEEP_BACKOFF_BASE_MS, 1000),
    },
    sms: {
      provider: env.SMS_PROVIDER === 'africastalking' ? 'africastalking' : 'console',
      atUsername: env.AT_USERNAME ?? 'sandbox',
      atApiKey: env.AT_API_KEY ?? '',
      atSenderId: env.AT_SENDER_ID ?? '',
      dispatchIntervalMs: int(env.SMS_DISPATCH_INTERVAL_MS, 5000),
      maxAttempts: int(env.SMS_MAX_ATTEMPTS, 5),
    },
  };
}
