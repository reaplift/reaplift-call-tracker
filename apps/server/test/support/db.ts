import { createDb, createPool } from '../../src/lib/db.js';
import { dropAllTables, migrate } from '../../src/migrate/runner.js';
import { migrationsDir } from '../../src/modes/migrate.js';

/**
 * The test database, which every integration test empties. It is TEST_DATABASE_URL, never DATABASE_URL, so the
 * development database in .env is never dropped by accident (CLAUDE.md). `pnpm db:up` creates calls_test.
 */
export const testDatabaseUrl = () => process.env.TEST_DATABASE_URL || 'mysql://calls:calls@localhost:3307/calls_test';

/** Every table dropped, then every migration applied. */
export async function freshDb() {
  const url = testDatabaseUrl();
  await dropAllTables(url);
  await migrate(url, migrationsDir());
  const pool = createPool(url);
  return { pool, db: createDb(pool) };
}
