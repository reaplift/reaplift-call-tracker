import { randomInt } from 'node:crypto';
import { sql, type Kysely } from 'kysely';
import type { Database } from '../../lib/db.js';
import { hashToken } from '../../lib/auth.js';

/** A 6-digit code, unique among live codes. Typed by hand as a fallback, so digits only. */
export async function createPairingCode(
  db: Kysely<Database>,
  input: { employeeId: string; createdBy: string; hours: number; now: Date },
): Promise<{ code: string; expiresAt: Date }> {
  const expiresAt = new Date(input.now.getTime() + input.hours * 3_600_000);
  return db.transaction().execute(async (trx) => {
    // A new code replaces the employee's earlier ones.
    await sql`
      update pairing_codes set used_at = ${input.now}
      where employee_id = ${input.employeeId} and used_at is null
    `.execute(trx);
    for (let attempt = 0; attempt < 20; attempt++) {
      const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
      const clash = await sql`
        select 1 from pairing_codes
        where code_hash = ${hashToken(code)} and used_at is null and expires_at > ${input.now}
      `.execute(trx);
      if (clash.rows.length) continue;
      await sql`
        insert into pairing_codes (employee_id, code_hash, expires_at, created_by)
        values (${input.employeeId}, ${hashToken(code)}, ${expiresAt}, ${input.createdBy})
      `.execute(trx);
      return { code, expiresAt };
    }
    throw new Error('could not find a free pairing code');
  });
}

/** The live code's employee, or null when the code is wrong, used or expired. */
export async function findLiveCode(
  db: Kysely<Database>,
  code: string,
  now: Date,
): Promise<{ id: string; employeeId: string; employeeName: string } | null> {
  const row = (
    await sql<{ id: string; employee_id: string; name: string }>`
      select p.id, p.employee_id, e.name from pairing_codes p join employees e on e.id = p.employee_id
      where p.code_hash = ${hashToken(code)} and p.used_at is null and p.expires_at > ${now}
        and e.status = 'active'
    `.execute(db)
  ).rows[0];
  return row ? { id: row.id, employeeId: row.employee_id, employeeName: row.name } : null;
}
