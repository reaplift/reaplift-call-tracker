import type { FastifyInstance } from 'fastify';
import { sql, type Kysely } from 'kysely';
import { NoteTemplateInput, NoteTemplatePatch, type NoteTemplate } from '@reaplift/calls-shared';
import { isUniqueViolation, type Database } from '../../lib/db.js';
import { audit } from '../../lib/audit.js';
import { sendError } from '../../lib/errors.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface Row {
  id: string;
  text: string;
  sort_order: number;
  active: number;
}
const toTemplate = (r: Row): NoteTemplate => ({ id: r.id, text: r.text, sortOrder: r.sort_order, active: r.active === 1 });

/** The company's ready-made notes for the after-call pop-up. Admins edit them; one in use is switched off, not deleted. */
export function registerNoteTemplateRoutes(app: FastifyInstance, deps: { db: Kysely<Database> }) {
  const { db } = deps;
  const readOne = async (companyId: number, id: string) =>
    UUID.test(id)
      ? (await sql<Row>`select id, text, sort_order, active from note_templates where company_id = ${companyId} and id = ${id}`.execute(db)).rows[0]
      : undefined;

  app.get('/api/note-templates', async (req, reply) => {
    const rows = (
      await sql<Row>`
        select id, text, sort_order, active from note_templates where company_id = ${req.scope!.companyId} order by sort_order, text
      `.execute(db)
    ).rows;
    return reply.code(200).send({ items: rows.map(toTemplate) });
  });

  app.post('/api/note-templates', async (req, reply) => {
    const { companyId } = req.scope!;
    const parsed = NoteTemplateInput.safeParse(req.body);
    if (!parsed.success) return sendError(reply, 400, 'INVALID_REQUEST', 'Send a note of up to 200 characters');
    try {
      const id = (
        await sql<{ id: string }>`
          insert into note_templates (company_id, text, sort_order) values (${companyId}, ${parsed.data.text}, ${parsed.data.sortOrder ?? 100})
          returning id
        `.execute(db)
      ).rows[0]!.id;
      await audit(db, { companyId, userId: req.auth!.userId, action: 'note_template.created', targetType: 'note_template', targetId: id });
      return reply.code(201).send(toTemplate((await readOne(companyId, id))!));
    } catch (err) {
      if (isUniqueViolation(err)) return sendError(reply, 409, 'TEMPLATE_EXISTS', 'This note already exists');
      throw err;
    }
  });

  app.patch('/api/note-templates/:id', async (req, reply) => {
    const { companyId } = req.scope!;
    const { id } = req.params as { id: string };
    const existing = await readOne(companyId, id);
    if (!existing) return sendError(reply, 404, 'NOT_FOUND', 'Note not found');
    const parsed = NoteTemplatePatch.safeParse(req.body);
    if (!parsed.success) return sendError(reply, 400, 'INVALID_REQUEST', 'Send text, sortOrder or active');
    const p = parsed.data;
    try {
      await sql`
        update note_templates set text = ${p.text ?? existing.text}, sort_order = ${p.sortOrder ?? existing.sort_order},
          active = ${p.active === undefined ? existing.active : p.active ? 1 : 0}
        where company_id = ${companyId} and id = ${id}
      `.execute(db);
    } catch (err) {
      if (isUniqueViolation(err)) return sendError(reply, 409, 'TEMPLATE_EXISTS', 'This note already exists');
      throw err;
    }
    await audit(db, { companyId, userId: req.auth!.userId, action: 'note_template.updated', targetType: 'note_template', targetId: id, details: p });
    return reply.code(200).send(toTemplate((await readOne(companyId, id))!));
  });
}
