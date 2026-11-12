import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { sql, type Kysely } from 'kysely';
import { z } from 'zod';
import type { Database } from '../../lib/db.js';
import { audit } from '../../lib/audit.js';
import { hashToken } from '../../lib/auth.js';
import { sendError } from '../../lib/errors.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** A company may keep this many live keys (one per system that reads its calls, plus one being rotated in). */
export const MAX_LIVE_KEYS = 5;

export interface ApiKeyRow {
  id: string;
  name: string;
  key_prefix: string;
  created_at: Date;
  last_used_at: Date | null;
  revoked_at: Date | null;
}

export const toApiKey = (r: ApiKeyRow) => ({
  id: r.id,
  name: r.name,
  keyPrefix: r.key_prefix,
  createdAt: r.created_at.toISOString(),
  lastUsedAt: r.last_used_at?.toISOString() ?? null,
  revokedAt: r.revoked_at?.toISOString() ?? null,
});

/** `rlk_` and 43 random characters (32 bytes). Returned once; only its hash is kept. */
export async function createApiKey(
  db: Kysely<Database>,
  input: { companyId: number; name: string; createdBy: string | null },
): Promise<{ id: string; key: string }> {
  const key = `rlk_${randomBytes(32).toString('base64url')}`;
  const prefix = key.slice(0, 10);
  await sql`
    insert into api_keys (company_id, name, key_prefix, key_hash, created_by)
    values (${input.companyId}, ${input.name}, ${prefix}, ${hashToken(key)}, ${input.createdBy})
  `.execute(db);
  const row = (await sql<{ id: string }>`select id from api_keys where key_hash = ${hashToken(key)}`.execute(db)).rows[0]!;
  return { id: row.id, key };
}

const keyInput = z.object({ name: z.string().trim().min(1).max(100) }).strict();

/** Panel routes (admin): list, create (key shown once), revoke. */
export function registerApiKeyRoutes(app: FastifyInstance, deps: { db: Kysely<Database> }) {
  const { db } = deps;

  app.get('/api/integrations/api-keys', async (req, reply) => {
    const rows = (
      await sql<ApiKeyRow>`
        select id, name, key_prefix, created_at, last_used_at, revoked_at
        from api_keys where company_id = ${req.scope!.companyId} order by revoked_at is not null, created_at desc
      `.execute(db)
    ).rows;
    return reply.code(200).send({ items: rows.map(toApiKey) });
  });

  app.post('/api/integrations/api-keys', async (req, reply) => {
    const { companyId } = req.scope!;
    const parsed = keyInput.safeParse(req.body);
    if (!parsed.success) return sendError(reply, 400, 'INVALID_REQUEST', 'Give the key a name, for example "Our CRM"');
    const live = (
      await sql<{ n: number }>`select count(*) as n from api_keys where company_id = ${companyId} and revoked_at is null`.execute(db)
    ).rows[0]!;
    if (Number(live.n) >= MAX_LIVE_KEYS)
      return sendError(reply, 409, 'TOO_MANY_KEYS', `At most ${MAX_LIVE_KEYS} keys; revoke one you no longer use`);
    const { id, key } = await createApiKey(db, { companyId, name: parsed.data.name, createdBy: req.auth!.userId });
    await audit(db, { companyId, userId: req.auth!.userId, action: 'api_key.created', targetType: 'api_key', targetId: id });
    const row = (
      await sql<ApiKeyRow>`select id, name, key_prefix, created_at, last_used_at, revoked_at from api_keys where id = ${id}`.execute(db)
    ).rows[0]!;
    return reply.code(201).send({ ...toApiKey(row), key });
  });

  app.delete('/api/integrations/api-keys/:id', async (req, reply) => {
    const { companyId } = req.scope!;
    const { id } = req.params as { id: string };
    if (!UUID.test(id)) return sendError(reply, 404, 'NOT_FOUND', 'Key not found');
    const done = await sql`
      update api_keys set revoked_at = current_timestamp(3) where company_id = ${companyId} and id = ${id} and revoked_at is null
    `.execute(db);
    if (Number(done.numAffectedRows ?? 0) === 0) return sendError(reply, 404, 'NOT_FOUND', 'Key not found');
    await audit(db, { companyId, userId: req.auth!.userId, action: 'api_key.revoked', targetType: 'api_key', targetId: id });
    return reply.code(204).send();
  });
}
