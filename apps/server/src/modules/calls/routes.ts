import type { FastifyInstance } from 'fastify';
import { sql, type Kysely } from 'kysely';
import type { CallRow, Page } from '@reaplift/calls-shared';
import type { Database } from '../../lib/db.js';
import { csvLine } from '../../lib/csv.js';
import { sendError } from '../../lib/errors.js';
import { formatIst } from '../../lib/time.js';
import { scopeSql } from '../auth/scope.js';
import { FilterError, filterSql, parseCallFilter, type CallFilter } from './filter.js';
import { sendsForCalls } from '../messages/routes.js';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 500;
/** A CSV is for a spreadsheet; past this the filter should be narrower. */
export const CSV_MAX_ROWS = 100_000;

interface Row {
  id: number;
  employee_id: string;
  employee_name: string;
  number: string;
  number_kind: CallRow['numberKind'];
  contact_name: string | null;
  type: CallRow['type'];
  started_at: Date;
  talk_seconds: number;
  ring_seconds: number | null;
  synced_at: Date;
  outcome: string | null;
  note: string | null;
  follow_up_at: Date | null;
  commented_at: Date | null;
  recording: CallRow['recording'];
}

const toCallRow = (r: Row): CallRow => ({
  id: r.id,
  employeeId: r.employee_id,
  employeeName: r.employee_name,
  number: r.number,
  numberKind: r.number_kind,
  contactName: r.contact_name,
  type: r.type,
  startedAt: r.started_at.toISOString(),
  talkSeconds: r.talk_seconds,
  ringSeconds: r.ring_seconds,
  syncedAt: r.synced_at.toISOString(),
  outcome: r.outcome,
  note: r.note,
  followUpAt: r.follow_up_at?.toISOString() ?? null,
  commentedAt: r.commented_at?.toISOString() ?? null,
  recording: r.recording,
});

/** Newest first. The cursor is the last row's start time and ID, so a page never repeats or skips a call. */
function encodeCursor(r: Row) {
  return Buffer.from(`${r.started_at.toISOString()}|${r.id}`).toString('base64url');
}
function decodeCursor(cursor: string | undefined): { startedAt: Date; id: number } | null {
  if (!cursor) return null;
  const [at, id] = Buffer.from(cursor, 'base64url').toString().split('|');
  const startedAt = new Date(at ?? '');
  const n = Number(id);
  return Number.isNaN(startedAt.getTime()) || !Number.isSafeInteger(n) ? null : { startedAt, id: n };
}

const SELECT = sql`
  select c.id, c.employee_id, e.name as employee_name, c.number, c.number_kind, c.contact_name, c.type,
         c.started_at, c.talk_seconds, c.ring_seconds, c.synced_at,
         o.label as outcome, c.note, c.follow_up_at, c.commented_at, rec.status as recording
  from calls c join employees e on e.id = c.employee_id and e.company_id = c.company_id
  left join call_outcomes o on o.id = c.outcome_id and o.company_id = c.company_id
  left join recordings rec on rec.call_id = c.id and rec.company_id = c.company_id
`;

export function registerCallRoutes(app: FastifyInstance, deps: { db: Kysely<Database>; now: () => Date }) {
  const { db, now } = deps;

  const readFilter = (query: unknown): CallFilter | FilterError => {
    try {
      return parseCallFilter(query, now());
    } catch (err) {
      if (err instanceof FilterError) return err;
      throw err;
    }
  };

  app.get('/api/calls', async (req, reply) => {
    const filter = readFilter(req.query);
    if (filter instanceof FilterError) return sendError(reply, 400, filter.code, filter.message);
    const q = req.query as { limit?: string; cursor?: string };
    const asked = Number(q.limit);
    const limit = Number.isInteger(asked) && asked > 0 ? Math.min(asked, MAX_LIMIT) : DEFAULT_LIMIT;
    const after = decodeCursor(q.cursor);
    const rows = (
      await sql<Row>`
        ${SELECT}
        where ${scopeSql(req.scope!)} and ${filterSql(filter)}
          ${after ? sql`and (c.started_at, c.id) < (${after.startedAt}, ${after.id})` : sql``}
        order by c.started_at desc, c.id desc
        limit ${limit + 1}
      `.execute(db)
    ).rows;
    const items = rows.slice(0, limit);
    const sends = await sendsForCalls(db, req.scope!.companyId, items.map((r) => r.id));
    const page: Page<CallRow> = {
      items: items.map((r) => ({ ...toCallRow(r), whatsapp: sends.get(r.id) ?? [] })),
      nextCursor: rows.length > limit ? encodeCursor(items.at(-1)!) : null,
    };
    return reply.code(200).send(page);
  });

  app.get('/api/calls/export.csv', async (req, reply) => {
    const filter = readFilter(req.query);
    if (filter instanceof FilterError) return sendError(reply, 400, filter.code, filter.message);
    const rows = (
      await sql<Row>`
        ${SELECT} where ${scopeSql(req.scope!)} and ${filterSql(filter)} order by c.started_at desc, c.id desc limit ${CSV_MAX_ROWS}
      `.execute(db)
    ).rows;
    let body = csvLine([
      'Date and time (IST)', 'Employee', 'Number', 'Contact', 'Type', 'Talk (s)', 'Ring (s)', 'Synced (IST)',
      'Outcome', 'Comment', 'Follow-up (IST)', 'Recording', 'WhatsApp',
    ]);
    const sends = await sendsForCalls(db, req.scope!.companyId, rows.map((r) => r.id));
    for (const r of rows) {
      body += csvLine([
        formatIst(r.started_at),
        r.employee_name,
        r.number_kind === 'private' ? 'Private number' : r.number,
        r.contact_name,
        r.type,
        r.talk_seconds,
        r.ring_seconds,
        formatIst(r.synced_at),
        r.outcome,
        r.note,
        r.follow_up_at ? formatIst(r.follow_up_at) : '',
        r.recording === 'uploaded' ? 'yes' : r.recording === 'missing' ? 'missing' : '',
        (sends.get(r.id) ?? []).map((s) => s.title ?? 'WhatsApp').join('; '),
      ]);
    }
    return reply
      .code(200)
      .header('content-type', 'text/csv; charset=utf-8')
      .header('content-disposition', 'attachment; filename="calls.csv"')
      .send(body);
  });
}
