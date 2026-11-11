import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Config } from '../config.js';
import type { Logger } from '../lib/logger.js';
import { migrate } from '../migrate/runner.js';

/** db/migrations at the repo root; MIGRATIONS_DIR overrides it (used in the Docker image). */
export const migrationsDir = () =>
  process.env.MIGRATIONS_DIR ??
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../db/migrations');

export async function runMigrate(config: Config, log: Logger) {
  const result = await migrate(config.DATABASE_URL, migrationsDir());
  log.info(result, 'migrations finished');
}
