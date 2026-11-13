import { createHash } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { sql, type Kysely } from 'kysely';
import { NeverRecordInput, type NeverRecordNumber } from '@reaplift/calls-shared';
import type { Database } from '../../lib/db.js';
import { audit } from '../../lib/audit.js';
import { sendError } from '../../lib/errors.js';
import { normalizeNumber } from '../../lib/phone.js';
import type { RecordingStore } from '../../lib/storage.js';

/**
 * M12: numbers whose calls are never recorded or kept (client, 12 November 2026). The company's admins manage them
 * (client, 13 November 2026: moved from the super admin), and the super admin can for the company picked; managers
 * can't (these are admin routes). Phones drop these calls before storing them; the server refuses any that arrive.
 */

/** What phones get instead of the number: SHA-256 of the digits with country code. The app hashes the same way. */
export const numberHash = (number: string) => createHash('sha256').update(number, 'utf8').digest('hex');

/** The company's never-record numbers, normalised. */
export async function neverRecordNumbers(db: Kysely<Database>, companyId: number): Promise<Set<string>> {
  const rows = (await sql<{ number: string }>`select number from never_record_numbers where company_id = ${companyId}`.execute(db)).rows;
  return new Set(rows.map((r) => r.number));
}

export function registerNeverRecordRoutes(app: FastifyInstance, deps: { db: Kysely<Database>; store: RecordingStore | null }) {
  const { db, store } = deps;

  app.get('/api/never-record-numbers', async (req, reply) => {
    const rows = (
      await sql<{ number: string; label: string | null; created_at: Date }>`
        select number, label, created_at from never_record_numbers where company_id = ${req.scope!.companyId} order by number
      `.execute(db)
    ).rows;
    const items: NeverRecordNumber[] = rows.map((r) => ({ number: r.number, label: r.label, createdAt: r.created_at.toISOString() }));
    return reply.code(200).send({ items });
  });

  app.post('/api/never-record-numbers', async (req, reply) => {
    const { companyId } = req.scope!;
    const parsed = NeverRecordInput.safeParse(req.body);
    if (!parsed.success) return sendError(reply, 400, 'INVALID_REQUEST', 'Send a number and an optional label');
    const { number } = normalizeNumber(parsed.data.number);
    if (!number) return sendError(reply, 400, 'INVALID_REQUEST', 'Use a valid phone number');
    await sql`
      insert into never_record_numbers (company_id, number, label, created_by)
      values (${companyId}, ${number}, ${parsed.data.label || null}, ${req.auth!.userId})
      on duplicate key update label = values(label)
    `.execute(db);

    let deletedCalls = 0;
    let deletedRecordings = 0;
    if (parsed.data.deletePastCalls) {
      const recordings = (
        await sql<{ call_id: number; object_key: string | null }>`
          select r.call_id, r.object_key from recordings r join calls c on c.id = r.call_id and c.company_id = r.company_id
          where c.company_id = ${companyId} and c.number = ${number}
        `.execute(db)
      ).rows;
      // The audio goes first: if storage fails, the rows stay and the super admin can try again.
      if (store) for (const r of recordings) if (r.object_key) await store.remove(r.object_key);
      await db.transaction().execute(async (trx) => {
        if (recordings.length) {
          const del = await sql`delete from recordings where company_id = ${companyId} and call_id in (${sql.join(recordings.map((r) => r.call_id))})`.execute(trx);
          deletedRecordings = Number(del.numAffectedRows ?? 0);
        }
        const calls = await sql`delete from calls where company_id = ${companyId} and number = ${number}`.execute(trx);
        deletedCalls = Number(calls.numAffectedRows ?? 0);
      });
    }
    await audit(db, {
      companyId,
      userId: req.auth!.userId,
      action: 'never_record.added',
      targetType: 'number',
      // The audit log keeps only the last four digits.
      targetId: `…${number.slice(-4)}`,
      details: { deletedCalls, deletedRecordings },
    });
    return reply.code(201).send({ number, label: parsed.data.label || null, deletedCalls, deletedRecordings });
  });

  app.delete('/api/never-record-numbers/:number', async (req, reply) => {
    const { companyId } = req.scope!;
    const { number } = normalizeNumber((req.params as { number: string }).number);
    const done = await sql`delete from never_record_numbers where company_id = ${companyId} and number = ${number}`.execute(db);
    if (Number(done.numAffectedRows ?? 0) === 0) return sendError(reply, 404, 'NOT_FOUND', 'Number not on the list');
    await audit(db, { companyId, userId: req.auth!.userId, action: 'never_record.removed', targetType: 'number', targetId: `…${number.slice(-4)}` });
    return reply.code(204).send();
  });
}
