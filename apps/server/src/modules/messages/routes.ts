import type { FastifyInstance } from 'fastify';
import { sql, type Kysely } from 'kysely';
import {
  invalidBlanks,
  MessageSendBatch,
  MessageTemplateInput,
  MessageTemplatePatch,
  type MessageSendBatchResult,
  type MessageTemplate,
} from '@reaplift/calls-shared';
import { isUniqueViolation, type Database } from '../../lib/db.js';
import { audit } from '../../lib/audit.js';
import { sendError } from '../../lib/errors.js';
import { normalizeNumber } from '../../lib/phone.js';
import { neverRecordNumbers } from '../never-record/routes.js';

/** A company keeps at most this many templates switched on; the app's list stays short enough to pick from. */
export const MAX_ACTIVE_TEMPLATES = 50;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface Row {
  id: string;
  title: string;
  body: string;
  active: number;
  updated_at: Date;
}
const toTemplate = (r: Row): MessageTemplate => ({ id: r.id, title: r.title, body: r.body, active: Boolean(r.active), updatedAt: r.updated_at.toISOString() });

/** The active templates phones get in their settings. */
export async function activeTemplates(db: Kysely<Database>, companyId: number) {
  return (
    await sql<{ id: string; title: string; body: string }>`
      select id, title, body from message_templates where company_id = ${companyId} and active = 1 order by sort_order, title
    `.execute(db)
  ).rows;
}

/** The WhatsApp templates sent for these calls, for call history (oldest first). */
export async function sendsForCalls(db: Kysely<Database>, companyId: number, callIds: number[]) {
  const byCall = new Map<number, Array<{ title: string | null; sentAt: string }>>();
  // In batches, so a 100,000-row CSV export doesn't send one enormous query.
  for (let i = 0; i < callIds.length; i += 1000) {
    const batch = callIds.slice(i, i + 1000);
    const rows = (
      await sql<{ call_id: number; title: string | null; opened_at: Date }>`
        select s.call_id, t.title, s.opened_at
        from message_sends s left join message_templates t on t.id = s.template_id and t.company_id = s.company_id
        where s.company_id = ${companyId} and s.call_id in (${sql.join(batch)})
        order by s.opened_at
      `.execute(db)
    ).rows;
    for (const r of rows) byCall.set(r.call_id, [...(byCall.get(r.call_id) ?? []), { title: r.title, sentAt: r.opened_at.toISOString() }]);
  }
  return byCall;
}

/**
 * M10: WhatsApp message templates. A company's admins (and the super admin for the company picked) write them;
 * phones get the active ones and send back a log of what WhatsApp was opened with.
 */
export function registerMessageRoutes(app: FastifyInstance, deps: { db: Kysely<Database>; now: () => Date }) {
  const { db, now } = deps;

  const blanksError = (body: string) => {
    const bad = invalidBlanks(body);
    return bad.length
      ? `Blank names use lowercase letters, digits and underscores, for example {{site_name}}. Fix: ${bad.map((b) => `{{${b}}}`).join(', ')}`
      : null;
  };
  const activeCount = async (companyId: number) =>
    Number((await sql<{ n: number }>`select count(*) as n from message_templates where company_id = ${companyId} and active = 1`.execute(db)).rows[0]!.n);

  app.get('/api/message-templates', async (req, reply) => {
    const rows = (
      await sql<Row>`select id, title, body, active, updated_at from message_templates where company_id = ${req.scope!.companyId} order by active desc, sort_order, title`.execute(db)
    ).rows;
    return reply.code(200).send({ items: rows.map(toTemplate) });
  });

  app.post('/api/message-templates', async (req, reply) => {
    const { companyId } = req.scope!;
    const parsed = MessageTemplateInput.safeParse(req.body);
    if (!parsed.success) return sendError(reply, 400, 'INVALID_REQUEST', 'Give the template a title and a message (up to 1,000 characters)');
    const bad = blanksError(parsed.data.body);
    if (bad) return sendError(reply, 400, 'TEMPLATE_BLANK_INVALID', bad);
    if ((await activeCount(companyId)) >= MAX_ACTIVE_TEMPLATES)
      return sendError(reply, 409, 'TOO_MANY_TEMPLATES', `At most ${MAX_ACTIVE_TEMPLATES} templates can be on; switch one off first`);
    try {
      await sql`
        insert into message_templates (company_id, title, body, sort_order, created_by)
        values (${companyId}, ${parsed.data.title}, ${parsed.data.body},
                (select coalesce(max(m.sort_order), 0) + 1 from message_templates m where m.company_id = ${companyId}), ${req.auth!.userId})
      `.execute(db);
    } catch (err) {
      if (isUniqueViolation(err)) return sendError(reply, 409, 'TEMPLATE_EXISTS', 'A template with this title already exists');
      throw err;
    }
    const row = (await sql<Row>`select id, title, body, active, updated_at from message_templates where company_id = ${companyId} and title = ${parsed.data.title}`.execute(db)).rows[0]!;
    await audit(db, { companyId, userId: req.auth!.userId, action: 'message_template.created', targetType: 'message_template', targetId: row.id });
    return reply.code(201).send(toTemplate(row));
  });

  app.patch('/api/message-templates/:id', async (req, reply) => {
    const { companyId } = req.scope!;
    const { id } = req.params as { id: string };
    if (!UUID.test(id)) return sendError(reply, 404, 'NOT_FOUND', 'Template not found');
    const parsed = MessageTemplatePatch.safeParse(req.body);
    if (!parsed.success) return sendError(reply, 400, 'INVALID_REQUEST', 'Check the template');
    const p = parsed.data;
    const current = (await sql<Row>`select id, title, body, active, updated_at from message_templates where company_id = ${companyId} and id = ${id}`.execute(db)).rows[0];
    if (!current) return sendError(reply, 404, 'NOT_FOUND', 'Template not found');
    if (p.body !== undefined) {
      const bad = blanksError(p.body);
      if (bad) return sendError(reply, 400, 'TEMPLATE_BLANK_INVALID', bad);
    }
    if (p.active === true && !current.active && (await activeCount(companyId)) >= MAX_ACTIVE_TEMPLATES)
      return sendError(reply, 409, 'TOO_MANY_TEMPLATES', `At most ${MAX_ACTIVE_TEMPLATES} templates can be on; switch one off first`);
    try {
      await sql`
        update message_templates
        set title = ${p.title ?? current.title}, body = ${p.body ?? current.body},
            active = ${p.active === undefined ? current.active : p.active ? 1 : 0}, updated_at = ${now()}
        where company_id = ${companyId} and id = ${id}
      `.execute(db);
    } catch (err) {
      if (isUniqueViolation(err)) return sendError(reply, 409, 'TEMPLATE_EXISTS', 'A template with this title already exists');
      throw err;
    }
    const row = (await sql<Row>`select id, title, body, active, updated_at from message_templates where company_id = ${companyId} and id = ${id}`.execute(db)).rows[0]!;
    await audit(db, { companyId, userId: req.auth!.userId, action: 'message_template.updated', targetType: 'message_template', targetId: id });
    return reply.code(200).send(toTemplate(row));
  });

  /**
   * The phone's log of WhatsApp sends, from its outbox (up to 50 at once). Idempotent on (device, deviceSendId).
   * The company and employee come from the device row; the call, when given, must be this phone's own.
   */
  app.post('/device/v1/message-sends', async (req, reply) => {
    const device = req.device!;
    const parsed = MessageSendBatch.safeParse(req.body);
    if (!parsed.success) return sendError(reply, 400, 'INVALID_REQUEST', 'Check the WhatsApp sends');
    const result: MessageSendBatchResult = { accepted: 0, duplicates: 0, rejected: [] };
    const neverRecord = await neverRecordNumbers(db, device.companyId);
    for (const s of parsed.data.sends) {
      const { number } = normalizeNumber(s.number);
      if (!number) {
        result.rejected.push({ deviceSendId: s.deviceSendId, reason: 'no number' });
        continue;
      }
      // M12: nothing is kept about a never-record number.
      if (neverRecord.has(number)) {
        result.rejected.push({ deviceSendId: s.deviceSendId, reason: 'never record' });
        continue;
      }
      const callId = s.deviceCallId
        ? ((await sql<{ id: number }>`select id from calls where device_id = ${device.deviceId} and device_call_id = ${s.deviceCallId}`.execute(db)).rows[0]?.id ?? null)
        : null;
      const templateId = s.templateId
        ? ((await sql<{ id: string }>`select id from message_templates where company_id = ${device.companyId} and id = ${s.templateId}`.execute(db)).rows[0]?.id ?? null)
        : null;
      const done = await sql`
        insert ignore into message_sends (company_id, employee_id, device_id, device_send_id, template_id, number, call_id, body, app, opened_at)
        values (${device.companyId}, ${device.employeeId}, ${device.deviceId}, ${s.deviceSendId}, ${templateId}, ${number}, ${callId},
                ${s.body}, ${s.app}, ${new Date(s.openedAt)})
      `.execute(db);
      if (Number(done.numAffectedRows ?? 0) === 1) result.accepted += 1;
      else result.duplicates += 1;
    }
    return reply.code(200).send(result);
  });
}
