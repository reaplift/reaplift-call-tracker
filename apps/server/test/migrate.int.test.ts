import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPool } from '../src/lib/db.js';
import { migrate } from '../src/migrate/runner.js';
import { migrationsDir } from '../src/modes/migrate.js';

// Drops the whole schema: point DATABASE_URL at a database you can lose (CLAUDE.md).
const pool = createPool(process.env.DATABASE_URL ?? 'postgres://calls:calls@localhost:5433/calls');

beforeAll(async () => {
  await pool.query('drop schema public cascade; create schema public;');
});
afterAll(async () => {
  await pool.end();
});

describe('migrate', () => {
  it('applies every file once, and a second run changes nothing', async () => {
    const first = await migrate(pool, migrationsDir());
    expect(first.applied).toContain('0001_init.sql');
    const second = await migrate(pool, migrationsDir());
    expect(second.applied).toEqual([]);
    expect(second.skipped).toEqual(first.applied);
  });
});
