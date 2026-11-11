import type { FastifyInstance } from 'fastify';
import { sql, type Kysely } from 'kysely';
import { z } from 'zod';
import { createUser, UserInputError } from '../auth/users.js';
import { scopeSql } from '../auth/scope.js';
import { isForeignKeyViolation, isUniqueViolation, type Database } from '../../lib/db.js';
import { audit } from '../../lib/audit.js';
import { sendError } from '../../lib/errors.js';
import { normalizeNumber } from '../../lib/phone.js';
import { FilterError, filterSql, parseCallFilter } from '../calls/filter.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const teamInput = z
  .object({
    name: z.string().trim().min(1).max(100),
    employeeIds: z.array(z.string().uuid()).max(500).optional(),
  })
  .strict();

const excludedNumberInput = z
  .object({
    number: z.string().min(3).max(30),
    label: z.string().trim().max(200).optional(),
  })
  .strict();

/** Company admins create admins and managers in their own company; super admins are made with the CLI. */
const userInput = z
  .object({
    email: z.string().email(),
    name: z.string().trim().min(1).max(100),
    role: z.enum(['admin', 'manager']),
    password: z.string().min(10),
  })
  .strict();

type UserRow = { id: string; email: string; name: string; role: 'admin' | 'manager'; created_at: Date };
const toUser = (row: UserRow) => ({ id: row.id, email: row.email, name: row.name, role: row.role, createdAt: row.created_at.toISOString() });

/** Excluded numbers are left out of reports unless `includeExcluded=true` (HLD section 6). */
function excludedSql(companyId: number, includeExcluded: unknown) {
  return includeExcluded === 'true' || includeExcluded === true
    ? sql``
    : sql`and not exists (select 1 from excluded_numbers ex where ex.company_id = ${companyId} and ex.number = c.number)`;
}

export function registerReportsRoutes(app: FastifyInstance, deps: { db: Kysely<Database>; now: () => Date }) {
  const { db, now } = deps;

  const readFilter = (query: unknown): ReturnType<typeof parseCallFilter> | FilterError => {
    try {
      return parseCallFilter(query, now());
    } catch (err) {
      if (err instanceof FilterError) return err;
      throw err;
    }
  };

  app.get('/api/teams', async (req, reply) => {
    const { companyId } = req.scope!;
    const teams = (
      await sql<{ id: string; name: string; created_at: Date }>`
        select id, name, created_at from teams where company_id = ${companyId} order by name
      `.execute(db)
    ).rows;
    const memberRows = (
      await sql<{ team_id: string; employee_id: string }>`
        select team_id, employee_id from team_members where company_id = ${companyId}
      `.execute(db)
    ).rows;
    const managerRows = (
      await sql<{ team_id: string; user_id: string }>`
        select team_id, user_id from team_managers where company_id = ${companyId}
      `.execute(db)
    ).rows;
    const members = new Map<string, string[]>();
    for (const row of memberRows) members.set(row.team_id, [...(members.get(row.team_id) ?? []), row.employee_id]);
    const managers = new Map<string, string[]>();
    for (const row of managerRows) managers.set(row.team_id, [...(managers.get(row.team_id) ?? []), row.user_id]);
    return reply.code(200).send({
      items: teams.map((team) => ({
        id: team.id,
        name: team.name,
        createdAt: team.created_at.toISOString(),
        employeeIds: members.get(team.id) ?? [],
        managerIds: managers.get(team.id) ?? [],
      })),
    });
  });

  app.post('/api/teams', async (req, reply) => {
    const { companyId } = req.scope!;
    const parsed = teamInput.safeParse(req.body);
    if (!parsed.success) return sendError(reply, 400, 'INVALID_REQUEST', 'Send a team name and optional employee ids');
    const employeeIds = Array.from(new Set(parsed.data.employeeIds ?? []));
    try {
      const team = await db.transaction().execute(async (trx) => {
        const row = (
          await sql<{ id: string; name: string; created_at: Date }>`
            insert into teams (company_id, name) values (${companyId}, ${parsed.data.name}) returning id, name, created_at
          `.execute(trx)
        ).rows[0]!;
        // The composite foreign key refuses an employee from another company.
        if (employeeIds.length) {
          await sql`
            insert into team_members (company_id, team_id, employee_id)
            values ${sql.join(employeeIds.map((id) => sql`(${companyId}, ${row.id}, ${id})`))}
          `.execute(trx);
        }
        return row;
      });
      await audit(db, { companyId, userId: req.auth!.userId, action: 'team.created', targetType: 'team', targetId: team.id });
      return reply.code(201).send({
        id: team.id,
        name: team.name,
        createdAt: team.created_at.toISOString(),
        employeeIds,
        managerIds: [],
      });
    } catch (err) {
      if (isUniqueViolation(err)) return sendError(reply, 409, 'TEAM_EXISTS', 'A team with this name already exists');
      if (isForeignKeyViolation(err)) return sendError(reply, 400, 'INVALID_REQUEST', 'One of the employees was not found');
      throw err;
    }
  });

  app.delete('/api/teams/:id', async (req, reply) => {
    const { companyId } = req.scope!;
    const { id } = req.params as { id: string };
    if (!UUID.test(id)) return sendError(reply, 404, 'NOT_FOUND', 'Team not found');
    const deleted = await sql`delete from teams where company_id = ${companyId} and id = ${id}`.execute(db);
    if (Number(deleted.numAffectedRows ?? 0) === 0) return sendError(reply, 404, 'NOT_FOUND', 'Team not found');
    await audit(db, { companyId, userId: req.auth!.userId, action: 'team.deleted', targetType: 'team', targetId: id });
    return reply.code(204).send();
  });

  app.get('/api/excluded-numbers', async (req, reply) => {
    const rows = (
      await sql<{ number: string; label: string | null; created_by: string; created_at: Date }>`
        select number, label, created_by, created_at from excluded_numbers where company_id = ${req.scope!.companyId} order by number
      `.execute(db)
    ).rows;
    return reply.code(200).send({
      items: rows.map((r) => ({ number: r.number, label: r.label, createdBy: r.created_by, createdAt: r.created_at.toISOString() })),
    });
  });

  app.post('/api/excluded-numbers', async (req, reply) => {
    const { companyId } = req.scope!;
    const parsed = excludedNumberInput.safeParse(req.body);
    if (!parsed.success) return sendError(reply, 400, 'INVALID_REQUEST', 'Send a number and optional label');
    const normalized = normalizeNumber(parsed.data.number);
    if (!normalized.number) return sendError(reply, 400, 'INVALID_REQUEST', 'Use a valid phone number');
    await sql`
      insert into excluded_numbers (company_id, number, label, created_by)
      values (${companyId}, ${normalized.number}, ${parsed.data.label ?? null}, ${req.auth!.userId})
      on duplicate key update label = values(label), created_by = values(created_by)
    `.execute(db);
    const row = (
      await sql<{ number: string; label: string | null; created_by: string; created_at: Date }>`
        select number, label, created_by, created_at from excluded_numbers where company_id = ${companyId} and number = ${normalized.number}
      `.execute(db)
    ).rows[0]!;
    return reply.code(201).send({ number: row.number, label: row.label, createdBy: row.created_by, createdAt: row.created_at.toISOString() });
  });

  app.delete('/api/excluded-numbers/:number', async (req, reply) => {
    const { companyId } = req.scope!;
    const { number } = req.params as { number: string };
    const normalized = normalizeNumber(number).number;
    const deleted = await sql`delete from excluded_numbers where company_id = ${companyId} and number = ${normalized}`.execute(db);
    if (Number(deleted.numAffectedRows ?? 0) === 0) return sendError(reply, 404, 'NOT_FOUND', 'Excluded number not found');
    return reply.code(204).send();
  });

  app.get('/api/users', async (req, reply) => {
    const rows = (
      await sql<UserRow>`
        select id, email, name, role, created_at from users where company_id = ${req.scope!.companyId} order by name
      `.execute(db)
    ).rows;
    return reply.code(200).send({ items: rows.map(toUser) });
  });

  app.post('/api/users', async (req, reply) => {
    const { companyId } = req.scope!;
    const parsed = userInput.safeParse(req.body);
    if (!parsed.success) return sendError(reply, 400, 'INVALID_REQUEST', 'Check the user fields');
    try {
      const created = await createUser(db, { ...parsed.data, companyId });
      const user = (
        await sql<UserRow>`select id, email, name, role, created_at from users where id = ${created.id}`.execute(db)
      ).rows[0]!;
      await audit(db, { companyId, userId: req.auth!.userId, action: 'user.created', targetType: 'user', targetId: user.id, details: { role: user.role } });
      return reply.code(201).send(toUser(user));
    } catch (err) {
      if (err instanceof UserInputError) return sendError(reply, 400, 'INVALID_REQUEST', err.message);
      throw err;
    }
  });

  app.delete('/api/users/:id', async (req, reply) => {
    const { companyId } = req.scope!;
    const { id } = req.params as { id: string };
    if (!UUID.test(id)) return sendError(reply, 404, 'NOT_FOUND', 'User not found');
    const deleted = await sql`
      delete from users where company_id = ${companyId} and id = ${id} and id != ${req.auth!.userId}
    `.execute(db);
    if (Number(deleted.numAffectedRows ?? 0) === 0) return sendError(reply, 404, 'NOT_FOUND', 'User not found');
    await audit(db, { companyId, userId: req.auth!.userId, action: 'user.deleted', targetType: 'user', targetId: id });
    return reply.code(204).send();
  });

  app.get('/api/reports/summary', async (req, reply) => {
    const scope = req.scope!;
    const query = (req.query ?? {}) as Record<string, unknown>;
    const filter = readFilter(query);
    if (filter instanceof FilterError) return sendError(reply, 400, filter.code, filter.message);
    const row = (
      await sql<{
        total_calls: number;
        incoming_calls: number | null;
        outgoing_calls: number | null;
        missed_calls: number | null;
        rejected_calls: number | null;
        connected_calls: number | null;
        talk_seconds: number;
        unique_numbers: number;
        employee_count: number;
      }>`
        select
          count(*) as total_calls,
          sum(case when c.type = 'incoming' then 1 else 0 end) as incoming_calls,
          sum(case when c.type = 'outgoing' then 1 else 0 end) as outgoing_calls,
          sum(case when c.type = 'missed' then 1 else 0 end) as missed_calls,
          sum(case when c.type = 'rejected' then 1 else 0 end) as rejected_calls,
          sum(case when c.type in ('incoming', 'outgoing') and c.talk_seconds > 0 then 1 else 0 end) as connected_calls,
          coalesce(sum(c.talk_seconds), 0) as talk_seconds,
          count(distinct c.number) as unique_numbers,
          count(distinct c.employee_id) as employee_count
        from calls c
        where ${scopeSql(scope)} and ${filterSql(filter)} ${excludedSql(scope.companyId, query.includeExcluded)}
      `.execute(db)
    ).rows[0]!;

    // sum() over no rows is null; the report shows 0.
    return reply.code(200).send({
      from: filter.from.toISOString(),
      to: filter.to.toISOString(),
      totalCalls: Number(row.total_calls),
      incomingCalls: Number(row.incoming_calls ?? 0),
      outgoingCalls: Number(row.outgoing_calls ?? 0),
      missedCalls: Number(row.missed_calls ?? 0),
      rejectedCalls: Number(row.rejected_calls ?? 0),
      connectedCalls: Number(row.connected_calls ?? 0),
      talkSeconds: Number(row.talk_seconds),
      uniqueNumbers: Number(row.unique_numbers),
      employeeCount: Number(row.employee_count),
    });
  });

  app.get('/api/reports/employees', async (req, reply) => {
    const scope = req.scope!;
    const query = (req.query ?? {}) as Record<string, unknown>;
    const filter = readFilter(query);
    if (filter instanceof FilterError) return sendError(reply, 400, filter.code, filter.message);
    const rows = (
      await sql<{
        employee_id: string;
        employee_name: string;
        total_calls: number;
        talk_seconds: number;
        unique_numbers: number;
        connected_calls: number;
      }>`
        select
          c.employee_id,
          e.name as employee_name,
          count(*) as total_calls,
          coalesce(sum(c.talk_seconds), 0) as talk_seconds,
          count(distinct c.number) as unique_numbers,
          sum(case when c.talk_seconds > 0 then 1 else 0 end) as connected_calls
        from calls c
        join employees e on e.id = c.employee_id and e.company_id = c.company_id
        where ${scopeSql(scope)} and ${filterSql(filter)} ${excludedSql(scope.companyId, query.includeExcluded)}
        group by c.employee_id, e.name
        order by total_calls desc, e.name
      `.execute(db)
    ).rows;
    return reply.code(200).send({
      items: rows.map((row) => ({
        employeeId: row.employee_id,
        employeeName: row.employee_name,
        totalCalls: Number(row.total_calls),
        talkSeconds: Number(row.talk_seconds),
        uniqueNumbers: Number(row.unique_numbers),
        connectedCalls: Number(row.connected_calls),
      })),
    });
  });
}
