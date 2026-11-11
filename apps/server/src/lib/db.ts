import { createPool as createMysqlPool, type Pool } from 'mysql2';
import { Kysely, MysqlDialect, sql } from 'kysely';

/** Table types grow here as migrations add tables (M1 onward). */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface Database {}

export type DbPool = Pool;

/**
 * A MariaDB pool (D10). Every connection works in UTC: `timezone: 'Z'` makes the driver read and write
 * datetime values as UTC, and the session time zone makes current_timestamp() UTC too.
 */
export function createPool(databaseUrl: string): Pool {
  const pool = createMysqlPool({
    uri: databaseUrl,
    connectionLimit: 10,
    timezone: 'Z',
    charset: 'utf8mb4_unicode_ci',
    // sum() comes back as DECIMAL; read it as a number, as count() already is.
    decimalNumbers: true,
    supportBigNumbers: true,
    bigNumberStrings: false,
  });
  pool.on('connection', (conn) => {
    conn.query("set time_zone = '+00:00'");
  });
  // An idle connection dropped by a database restart must not crash the process: the pool discards it,
  // and the next query reconnects or fails where it is handled.
  pool.on('error' as 'connection', () => {});
  return pool;
}

export function createDb(pool: Pool) {
  return new Kysely<Database>({ dialect: new MysqlDialect({ pool }) });
}

/** True when the database answers a trivial query. */
export async function pingDb(db: Kysely<Database>): Promise<boolean> {
  try {
    await sql`select 1`.execute(db);
    return true;
  } catch {
    return false;
  }
}

/** MariaDB's duplicate-key error: a unique key refused the row. */
export const isUniqueViolation = (err: unknown) => (err as { errno?: number }).errno === 1062;

/** MariaDB's foreign-key error on insert or update: the row points at something missing or in another company. */
export const isForeignKeyViolation = (err: unknown) => (err as { errno?: number }).errno === 1452;

/** A json column read back: MariaDB returns its text, which may also already be parsed by the driver. */
export function readJson<T>(value: unknown): T | null {
  if (value === null || value === undefined) return null;
  return (typeof value === 'string' ? JSON.parse(value) : value) as T;
}
