import { beforeAll, describe, expect, it } from 'vitest';
import { dropAllTables, migrate, splitStatements } from '../src/migrate/runner.js';
import { migrationsDir } from '../src/modes/migrate.js';
import { testDatabaseUrl } from './support/db.js';

// Drops every table: point DATABASE_URL at a database you can lose (CLAUDE.md).
const url = testDatabaseUrl();

beforeAll(async () => {
  await dropAllTables(url);
});

describe('migrate', () => {
  it('applies every file once, and a second run changes nothing', async () => {
    const first = await migrate(url, migrationsDir());
    expect(first.applied).toContain('0001_init.sql');
    const second = await migrate(url, migrationsDir());
    expect(second.applied).toEqual([]);
    expect(second.skipped).toEqual(first.applied);
  });

  it('splits a file on statement ends and drops comment lines', () => {
    expect(splitStatements('-- note\ncreate table a (x int);\n\ncreate table b (\n  y int -- inline\n);\n')).toEqual([
      'create table a (x int)',
      'create table b (\n  y int -- inline\n)',
    ]);
  });
});
