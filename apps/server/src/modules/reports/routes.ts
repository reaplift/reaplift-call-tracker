import type { FastifyInstance } from 'fastify';
import { sql, type Kysely } from 'kysely';
import { z } from 'zod';
import { createUser, UserInputError } from '../auth/users.js';
import type { Database } from '../../lib/db.js';
import { sendError } from '../../lib/errors.js';
import { normalizeNumber } from '../../lib/phone.js';
import { FilterError, filterSql, parseCallFilter } from '../calls/filter.js';

const teamInput = z
  .object({
    name: z.string().trim().min(1).max(100),
    employeeIds: z.array(z.string().uuid()).optional(),
  })
  .strict();

const excludedNumberInput = z
  .object({
    number: z.string().min(3).max(30),
    label: z.string().trim().max(200).optional(),
  })
  .strict();

const userInput = z
  .object({
    email: z.string().email(),
    name: z.string().trim().min(1).max(100),
    role: z.enum(['admin', 'manager']),
    password: z.string().min(10),
  })
  .strict();

async function visibleEmployeeIds(db: Kysely<Database>, userId: string): Promise<string[]> {
  const rows = await sql<{ employee_id: string }>`
    select distinct tm.employee_id
    from team_members tm
    join team_managers tmgr on tmgr.team_id = tm.team_id
    where tmgr.user_id = ${userId}
  `.execute(db);
  return rows.rows.map((r) => r.employee_id);
}

function applyManagerScope(filter: ReturnType<typeof parseCallFilter>, visible: string[]) {
  if (!visible.length) return { ...filter, employeeIds: [] };
  const employeeIds = filter.employeeIds.length ? filter.employeeIds.filter((id) => visible.includes(id)) : visible;
  return { ...filter, employeeIds };
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

  app.get('/api/teams', async (_req, reply) => {
    const teams = (
      await sql<{ id: string; name: string; created_at: Date }>`select id, name, created_at from teams order by name`.execute(db)
    ).rows;
    const memberRows = (
      await sql<{ team_id: string; employee_id: string }>`select team_id, employee_id from team_members`.execute(db)
    ).rows;
    const managerRows = (
      await sql<{ team_id: string; user_id: string }>`select team_id, user_id from team_managers`.execute(db)
    ).rows;
    const members = new Map<string, string[]>();
    for (const row of memberRows) {
      const list = members.get(row.team_id) ?? [];
      list.push(row.employee_id);
      members.set(row.team_id, list);
    }
    const managers = new Map<string, string[]>();
    for (const row of managerRows) {
      const list = managers.get(row.team_id) ?? [];
      list.push(row.user_id);
      managers.set(row.team_id, list);
    }
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
    const parsed = teamInput.safeParse(req.body);
    if (!parsed.success) return sendError(reply, 400, 'INVALID_REQUEST', 'Send a team name and optional employee ids');
    const team = (
      await sql<{ id: string; name: string; created_at: Date }>`
        insert into teams (name) values (${parsed.data.name}) returning id, name, created_at
      `.execute(db)
    ).rows[0]!;
    const employeeIds = Array.from(new Set(parsed.data.employeeIds ?? []));
    if (employeeIds.length) {
      await sql`
        insert into team_members (team_id, employee_id)
        select ${team.id}, employee_id from unnest(${employeeIds}::uuid[]) as employee_id
      `.execute(db);
    }
    return reply.code(201).send({
      id: team.id,
      name: team.name,
      createdAt: team.created_at.toISOString(),
      employeeIds,
      managerIds: [],
    });
  });

  app.delete('/api/teams/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const deleted = await sql`delete from teams where id = ${id} returning id`.execute(db);
    if (!deleted.rows.length) return sendError(reply, 404, 'NOT_FOUND', 'Team not found');
    return reply.code(204).send();
  });

  app.get('/api/excluded-numbers', async (_req, reply) => {
    const rows = (
      await sql<{ number: string; label: string | null; created_by: string; created_at: Date }>`
        select number, label, created_by, created_at from excluded_numbers order by number
      `.execute(db)
    ).rows;
    return reply.code(200).send({ items: rows.map((r) => ({ number: r.number, label: r.label, createdBy: r.created_by, createdAt: r.created_at.toISOString() })) });
  });

  app.post('/api/excluded-numbers', async (req, reply) => {
    const parsed = excludedNumberInput.safeParse(req.body);
    if (!parsed.success) return sendError(reply, 400, 'INVALID_REQUEST', 'Send a number and optional label');
    const normalized = normalizeNumber(parsed.data.number);
    if (!normalized.number) return sendError(reply, 400, 'INVALID_REQUEST', 'Use a valid phone number');
    const row = (
      await sql<{ number: string; label: string | null; created_by: string; created_at: Date }>`
        insert into excluded_numbers (number, label, created_by)
        values (${normalized.number}, ${parsed.data.label ?? null}, ${req.auth!.userId})
        on conflict (number) do update set label = excluded.label, created_by = excluded.created_by
        returning number, label, created_by, created_at
      `.execute(db)
    ).rows[0]!;
    return reply.code(201).send({
      number: row.number,
      label: row.label,
      createdBy: row.created_by,
      createdAt: row.created_at.toISOString(),
    });
  });

  app.delete('/api/excluded-numbers/:number', async (req, reply) => {
    const { number } = req.params as { number: string };
    const normalized = normalizeNumber(number).number;
    const deleted = await sql`delete from excluded_numbers where number = ${normalized} returning number`.execute(db);
    if (!deleted.rows.length) return sendError(reply, 404, 'NOT_FOUND', 'Excluded number not found');
    return reply.code(204).send();
  });

  app.get('/api/users', async (_req, reply) => {
    const rows = (
      await sql<{ id: string; email: string; name: string; role: 'admin' | 'manager'; created_at: Date }>`
        select id, email, name, role, created_at from users order by name
      `.execute(db)
    ).rows;
    return reply.code(200).send({ items: rows.map((row) => ({ id: row.id, email: row.email, name: row.name, role: row.role, createdAt: row.created_at.toISOString() })) });
  });

  app.post('/api/users', async (req, reply) => {
    const parsed = userInput.safeParse(req.body);
    if (!parsed.success) return sendError(reply, 400, 'INVALID_REQUEST', 'Check the user fields');
    try {
      const created = await createUser(db, parsed.data);
      const user = (
        await sql<{ id: string; email: string; name: string; role: 'admin' | 'manager'; created_at: Date }>`
          select id, email, name, role, created_at from users where id = ${created.id}
        `.execute(db)
      ).rows[0]!;
      return reply.code(201).send({ id: user.id, email: user.email, name: user.name, role: user.role, createdAt: user.created_at.toISOString() });
    } catch (err) {
      if (err instanceof UserInputError) return sendError(reply, 400, 'INVALID_REQUEST', err.message);
      throw err;
    }
  });

  app.delete('/api/users/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const deleted = await sql`delete from users where id = ${id} and id != ${req.auth!.userId} returning id`.execute(db);
    if (!deleted.rows.length) return sendError(reply, 404, 'NOT_FOUND', 'User not found');
    return reply.code(204).send();
  });

  app.get('/api/reports/summary', async (req, reply) => {
    const query = (req.query ?? {}) as Record<string, unknown>;
    const filter = readFilter(query);
    if (filter instanceof FilterError) return sendError(reply, 400, filter.code, filter.message);
    const managerScope = req.auth?.role === 'manager' ? await visibleEmployeeIds(db, req.auth.userId) : [];
    const scoped = req.auth?.role === 'manager' ? applyManagerScope(filter, managerScope) : filter;
    const scopeSql = req.auth?.role === 'manager' && managerScope.length ? sql`and c.employee_id = any(${managerScope}::uuid[])` : sql``;
    const includeExcluded = query.includeExcluded;
    const excludedSql = includeExcluded === 'true' || includeExcluded === true ? sql`` : sql`and not exists (select 1 from excluded_numbers ex where ex.number = c.number)`;
    const rows = (
      await sql<{ total_calls: number; incoming_calls: number; outgoing_calls: number; missed_calls: number; rejected_calls: number; connected_calls: number; talk_seconds: number; unique_numbers: number; employee_count: number }>`
        select
          count(*)::int as total_calls,
          count(*) filter (where c.type = 'incoming')::int as incoming_calls,
          count(*) filter (where c.type = 'outgoing')::int as outgoing_calls,
          count(*) filter (where c.type = 'missed')::int as missed_calls,
          count(*) filter (where c.type = 'rejected')::int as rejected_calls,
          count(*) filter (where c.type in ('incoming', 'outgoing') and c.talk_seconds > 0)::int as connected_calls,
          coalesce(sum(c.talk_seconds), 0)::int as talk_seconds,
          count(distinct c.number)::int as unique_numbers,
          count(distinct c.employee_id)::int as employee_count
        from calls c
        where ${filterSql(scoped)} ${scopeSql} ${excludedSql}
      `.execute(db)
    ).rows[0]!;

    return reply.code(200).send({
      from: filter.from.toISOString(),
      to: filter.to.toISOString(),
      totalCalls: rows.total_calls,
      incomingCalls: rows.incoming_calls,
      outgoingCalls: rows.outgoing_calls,
      missedCalls: rows.missed_calls,
      rejectedCalls: rows.rejected_calls,
      connectedCalls: rows.connected_calls,
      talkSeconds: rows.talk_seconds,
      uniqueNumbers: rows.unique_numbers,
      employeeCount: rows.employee_count,
    });
  });

  app.get('/api/reports/employees', async (req, reply) => {
    const query = (req.query ?? {}) as Record<string, unknown>;
    const filter = readFilter(query);
    if (filter instanceof FilterError) return sendError(reply, 400, filter.code, filter.message);
    const managerScope = req.auth?.role === 'manager' ? await visibleEmployeeIds(db, req.auth.userId) : [];
    const scoped = req.auth?.role === 'manager' ? applyManagerScope(filter, managerScope) : filter;
    const scopeSql = req.auth?.role === 'manager' && managerScope.length ? sql`and c.employee_id = any(${managerScope}::uuid[])` : sql``;
    const includeExcluded = query.includeExcluded;
    const excludedSql = includeExcluded === 'true' || includeExcluded === true ? sql`` : sql`and not exists (select 1 from excluded_numbers ex where ex.number = c.number)`;
    const rows = (
      await sql<{ employee_id: string; employee_name: string; total_calls: number; talk_seconds: number; unique_numbers: number; connected_calls: number }>`
        select
          c.employee_id,
          e.name as employee_name,
          count(*)::int as total_calls,
          coalesce(sum(c.talk_seconds), 0)::int as talk_seconds,
          count(distinct c.number)::int as unique_numbers,
          count(*) filter (where c.talk_seconds > 0)::int as connected_calls
        from calls c
        join employees e on e.id = c.employee_id
        where ${filterSql(scoped)} ${scopeSql} ${excludedSql}
        group by c.employee_id, e.name
        order by total_calls desc, e.name
      `.execute(db)
    ).rows;
    return reply.code(200).send({
      items: rows.map((row) => ({
        employeeId: row.employee_id,
        employeeName: row.employee_name,
        totalCalls: row.total_calls,
        talkSeconds: row.talk_seconds,
        uniqueNumbers: row.unique_numbers,
        connectedCalls: row.connected_calls,
      })),
    });
  });
}
