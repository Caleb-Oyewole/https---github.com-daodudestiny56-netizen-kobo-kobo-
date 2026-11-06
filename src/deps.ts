import type { AppConfig } from './config';
import type { Pool } from './db/pool';

/** Everything a service or route needs. Tests build this with a mock clock and in-memory collaborators. */
export interface Deps {
  db: Pool;
  config: AppConfig;
  clock: () => Date;
}
