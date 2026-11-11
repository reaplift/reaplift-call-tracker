import type { FastifyInstance } from 'fastify';
import { sql, type Kysely } from 'kysely';
import { CompanyInput, CompanyPatch, type Company } from '@reaplift/calls-shared';
import { isUniqueViolation, type Database } from '../../lib/db.js';
import { audit } from '../../lib/audit.js';
import { sendError } from '../../lib/errors.js';

interface Row {
  id: number;
  name: string;
  status: Company['status'];
  created_at: Date;
}
const toCompany = (r: Row): Company => ({ id: r.id, name: r.name, status: r.status, createdAt: r.created_at.toISOString() });

/** Super admin only (P1, D11). A company's id is the CRM's company number. */
export function registerCompanyRoutes(app: FastifyInstance, deps: { db: Kysely<Database> }) {
  const { db } = deps;
  const readOne = async (id: number) =>
    (await sql<Row>`select id, name, status, created_at from companies where id = ${id}`.execute(db)).rows[0];

  app.get('/api/companies', async (_req, reply) => {
    const rows = (await sql<Row>`select id, name, status, created_at from companies order by name`.execute(db)).rows;
    return reply.code(200).send({ items: rows.map(toCompany) });
  });

  app.post('/api/companies', async (req, reply) => {
    const parsed = CompanyInput.safeParse(req.body);
    if (!parsed.success) return sendError(reply, 400, 'INVALID_REQUEST', "Send the CRM's company number as id, and a name");
    try {
      await sql`insert into companies (id, name) values (${parsed.data.id}, ${parsed.data.name})`.execute(db);
    } catch (err) {
      if (isUniqueViolation(err)) return sendError(reply, 409, 'COMPANY_EXISTS', `Company ${parsed.data.id} already exists`);
      throw err;
    }
    await audit(db, { companyId: parsed.data.id, userId: req.auth!.userId, action: 'company.created', targetType: 'company', targetId: String(parsed.data.id) });
    return reply.code(201).send(toCompany((await readOne(parsed.data.id))!));
  });

  app.patch('/api/companies/:id', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const existing = Number.isSafeInteger(id) ? await readOne(id) : undefined;
    if (!existing) return sendError(reply, 404, 'NOT_FOUND', 'Company not found');
    const parsed = CompanyPatch.safeParse(req.body);
    if (!parsed.success) return sendError(reply, 400, 'INVALID_REQUEST', 'Send a name or a status');
    await sql`
      update companies set name = ${parsed.data.name ?? existing.name}, status = ${parsed.data.status ?? existing.status}
      where id = ${id}
    `.execute(db);
    await audit(db, { companyId: id, userId: req.auth!.userId, action: 'company.updated', targetType: 'company', targetId: String(id), details: parsed.data });
    return reply.code(200).send(toCompany((await readOne(id))!));
  });
}
