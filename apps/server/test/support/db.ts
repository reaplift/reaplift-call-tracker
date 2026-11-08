import { createDb, createPool } from '../../src/lib/db.js';
import { migrate } from '../../src/migrate/runner.js';
import { migrationsDir } from '../../src/modes/migrate.js';

/** A fresh schema with every migration applied. Drops the schema: use a database you can lose (CLAUDE.md). */
export async function freshDb() {
  const pool = createPool(process.env.DATABASE_URL ?? 'postgres://calls:calls@localhost:5433/calls_test');
  await pool.query('drop schema public cascade; create schema public;');
  await migrate(pool, migrationsDir());
  return { pool, db: createDb(pool) };
}
