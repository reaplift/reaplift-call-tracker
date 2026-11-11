import type { FastifyInstance } from 'fastify';
import { sql, type Kysely } from 'kysely';
import { CallOutcomeInput, CallOutcomePatch, type CallOutcome } from '@reaplift/calls-shared';
import { isUniqueViolation, type Database } from '../../lib/db.js';
import { audit } from '../../lib/audit.js';
import { sendError } from '../../lib/errors.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface Row {
  id: string;
  label: string;
  sort_order: number;
  active: number;
}
const toOutcome = (r: Row): CallOutcome => ({ id: r.id, label: r.label, sortOrder: r.sort_order, active: r.active === 1 });

/** The company's outcomes for the after-call form (M4). Admins edit them; an outcome in use is switched off, not deleted. */
export function registerOutcomeRoutes(app: FastifyInstance, deps: { db: Kysely<Database> }) {
  const { db } = deps;
  const readOne = async (companyId: number, id: string) =>
    UUID.test(id)
      ? (await sql<Row>`select id, label, sort_order, active from call_outcomes where company_id = ${companyId} and id = ${id}`.execute(db)).rows[0]
      : undefined;

  app.get('/api/call-outcomes', async (req, reply) => {
    const rows = (
      await sql<Row>`
        select id, label, sort_order, active from call_outcomes where company_id = ${req.scope!.companyId} order by sort_order, label
      `.execute(db)
    ).rows;
    return reply.code(200).send({ items: rows.map(toOutcome) });
  });

  app.post('/api/call-outcomes', async (req, reply) => {
    const { companyId } = req.scope!;
    const parsed = CallOutcomeInput.safeParse(req.body);
    if (!parsed.success) return sendError(reply, 400, 'INVALID_REQUEST', 'Send a label of up to 60 characters');
    try {
      const id = (
        await sql<{ id: string }>`
          insert into call_outcomes (company_id, label, sort_order)
          values (${companyId}, ${parsed.data.label}, ${parsed.data.sortOrder ?? 100}) returning id
        `.execute(db)
      ).rows[0]!.id;
      await audit(db, { companyId, userId: req.auth!.userId, action: 'call_outcome.created', targetType: 'call_outcome', targetId: id });
      return reply.code(201).send(toOutcome((await readOne(companyId, id))!));
    } catch (err) {
      if (isUniqueViolation(err)) return sendError(reply, 409, 'OUTCOME_EXISTS', 'This outcome already exists');
      throw err;
    }
  });

  app.patch('/api/call-outcomes/:id', async (req, reply) => {
    const { companyId } = req.scope!;
    const { id } = req.params as { id: string };
    const existing = await readOne(companyId, id);
    if (!existing) return sendError(reply, 404, 'NOT_FOUND', 'Outcome not found');
    const parsed = CallOutcomePatch.safeParse(req.body);
    if (!parsed.success) return sendError(reply, 400, 'INVALID_REQUEST', 'Send a label, sortOrder or active');
    const p = parsed.data;
    try {
      await sql`
        update call_outcomes set
          label = ${p.label ?? existing.label},
          sort_order = ${p.sortOrder ?? existing.sort_order},
          active = ${p.active === undefined ? existing.active : p.active ? 1 : 0}
        where company_id = ${companyId} and id = ${id}
      `.execute(db);
    } catch (err) {
      if (isUniqueViolation(err)) return sendError(reply, 409, 'OUTCOME_EXISTS', 'This outcome already exists');
      throw err;
    }
    await audit(db, { companyId, userId: req.auth!.userId, action: 'call_outcome.updated', targetType: 'call_outcome', targetId: id, details: p });
    return reply.code(200).send(toOutcome((await readOne(companyId, id))!));
  });
}
