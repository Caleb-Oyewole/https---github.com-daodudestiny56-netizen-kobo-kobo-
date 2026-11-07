import { loadConfig } from './config';
import { createPool } from './db/pool';
import type { Deps } from './deps';
import { HttpExecutor } from './executors/http';
import { MockExecutor } from './executors/mock';
import { AllowAllGuard } from './guard';
import { buildServer } from './server';
import { startScheduler } from './sweeps/scheduler';

const config = loadConfig();
const pool = createPool(config.databaseUrl);

const executor =
  config.executorMode === 'http' ? new HttpExecutor(config.railsBaseUrl, config.railsServiceToken) : new MockExecutor();
if (executor instanceof MockExecutor) console.warn('[boot] EXECUTOR_MODE=mock: no real money moves. Set EXECUTOR_MODE=http for the Rails executor.');

const deps: Deps = { db: pool, config, clock: () => new Date(), executor, guard: new AllowAllGuard() };

const app = buildServer(deps);
const scheduler = config.scheduler.enabled ? startScheduler(deps) : null;

await app.listen({ port: config.port, host: '0.0.0.0' });
console.log(`[boot] kobo-core listening on :${config.port} (scheduler ${scheduler ? 'on' : 'off'})`);

const shutdown = async (signal: string) => {
  console.log(`[boot] ${signal}: shutting down`);
  scheduler?.stop();
  await app.close();
  await pool.end();
  process.exit(0);
};
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
