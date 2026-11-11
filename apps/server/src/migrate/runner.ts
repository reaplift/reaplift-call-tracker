import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { createConnection, type Connection } from 'mysql2/promise';

/** Name of the MariaDB lock that stops two migrate runs from overlapping. */
const LOCK_NAME = 'reaplift_calls_migrate';

export interface MigrateResult {
  applied: string[];
  skipped: string[];
}

/**
 * Splits a migration file into statements on semicolons at the end of a line. Comment lines are dropped.
 * Migration files keep to that shape (no semicolons inside strings at line ends, no procedures).
 */
export function splitStatements(body: string): string[] {
  return body
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n')
    .split(/;\s*$/m)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Applies every `NNNN_name.sql` file in `dir` that is not yet recorded in schema_migrations, in name order.
 * MariaDB commits each `create table` at once, so a failed file can leave part of itself applied; the file is
 * recorded only after all its statements succeed, and the error names the file and the statement.
 */
export async function migrate(databaseUrl: string, dir: string): Promise<MigrateResult> {
  const conn: Connection = await createConnection({ uri: databaseUrl, timezone: 'Z', multipleStatements: false });
  try {
    await conn.query("set time_zone = '+00:00'");
    const [[lock]] = (await conn.query('select get_lock(?, 60) as got', [LOCK_NAME])) as unknown as [[{ got: number }]];
    if (lock?.got !== 1) throw new Error('Another migrate run holds the lock');
    await conn.query(`
      create table if not exists schema_migrations (
        name varchar(200) not null primary key,
        applied_at datetime(3) not null default current_timestamp(3)
      ) engine = InnoDB default charset = utf8mb4 collate = utf8mb4_unicode_ci`);
    const [doneRows] = (await conn.query('select name from schema_migrations')) as unknown as [{ name: string }[]];
    const done = new Set(doneRows.map((r) => r.name));
    const files = (await readdir(dir)).filter((f) => /^\d{4}_.+\.sql$/.test(f)).sort();
    const result: MigrateResult = { applied: [], skipped: [] };
    for (const file of files) {
      if (done.has(file)) {
        result.skipped.push(file);
        continue;
      }
      const statements = splitStatements(await readFile(path.join(dir, file), 'utf8'));
      for (const [i, statement] of statements.entries()) {
        try {
          await conn.query(statement);
        } catch (err) {
          throw new Error(`Migration ${file} failed at statement ${i + 1}: ${(err as Error).message}`, { cause: err });
        }
      }
      await conn.query('insert into schema_migrations (name) values (?)', [file]);
      result.applied.push(file);
    }
    return result;
  } finally {
    await conn.query('select release_lock(?)', [LOCK_NAME]).catch(() => {});
    await conn.end();
  }
}

/** Drops every table in the connected database. Tests only: point it at a database you can lose (CLAUDE.md). */
export async function dropAllTables(databaseUrl: string): Promise<void> {
  const conn = await createConnection({ uri: databaseUrl });
  try {
    const [rows] = (await conn.query(
      'select table_name as name from information_schema.tables where table_schema = database()',
    )) as unknown as [{ name: string }[]];
    await conn.query('set foreign_key_checks = 0');
    for (const { name } of rows) await conn.query(`drop table if exists \`${name}\``);
    await conn.query('set foreign_key_checks = 1');
  } finally {
    await conn.end();
  }
}
