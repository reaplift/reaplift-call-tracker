import { serialize as serializeCookie } from 'cookie';
import type { FastifyInstance } from 'fastify';
import { sql, type Kysely } from 'kysely';
import { z } from 'zod';
import type { SessionUserView } from '@reaplift/calls-shared';
import type { Database } from '../../lib/db.js';
import { verifyPassword } from '../../lib/auth.js';
import { sendError } from '../../lib/errors.js';
import { audit } from '../../lib/audit.js';
import { createSession, MAX_AGE_MS, revokeSession, SESSION_COOKIE, type SessionUser } from './sessions.js';
import type { UserRole } from './users.js';

/** 5 wrong passwords in a row lock the login for 24 hours, as in reaplift-bsp; `cli unlock-user` opens it sooner. */
export const LOCKOUT_FAILURES = 5;
export const LOCKOUT_MS = 24 * 60 * 60 * 1000;

const LoginBody = z.object({ email: z.string().min(1), password: z.string().min(1) }).strict();
const CompanyChoice = z.object({ companyId: z.number().int().positive() }).strict();

async function companyName(db: Kysely<Database>, id: number | null): Promise<string | null> {
  if (id === null) return null;
  return (await sql<{ name: string }>`select name from companies where id = ${id}`.execute(db)).rows[0]?.name ?? null;
}

async function view(db: Kysely<Database>, u: SessionUser): Promise<SessionUserView> {
  const companyId = u.role === 'super_admin' ? u.selectedCompanyId : u.companyId;
  return { id: u.userId, name: u.name, email: u.email, role: u.role, companyId, companyName: await companyName(db, companyId) };
}

export function registerAuthRoutes(
  app: FastifyInstance,
  deps: { db: Kysely<Database>; now: () => Date; cookieSecure: boolean },
) {
  const { db, now, cookieSecure } = deps;
  const cookie = (value: string, maxAge: number) =>
    serializeCookie(SESSION_COOKIE, value, { httpOnly: true, secure: cookieSecure, sameSite: 'lax', path: '/', maxAge });

  app.post('/api/auth/login', async (req, reply) => {
    const parsed = LoginBody.safeParse(req.body);
    if (!parsed.success) return sendError(reply, 400, 'INVALID_REQUEST', 'Send email and password only');

    const at = now();
    const email = parsed.data.email.trim().toLowerCase();
    const user = (
      await sql<{
        id: string;
        name: string;
        email: string;
        role: UserRole;
        company_id: number | null;
        company_status: string | null;
        disabled_at: Date | null;
        password_hash: string;
        failed_login_count: number | null;
        login_locked_at: Date | null;
      }>`
        select u.id, u.name, u.email, u.role, u.company_id, co.status as company_status, u.disabled_at,
               u.password_hash, u.failed_login_count, u.login_locked_at
        from users u left join companies co on co.id = u.company_id
        where u.email = ${email}
      `.execute(db)
    ).rows[0];

    if (user?.login_locked_at && at.getTime() - user.login_locked_at.getTime() < LOCKOUT_MS) {
      return sendError(reply, 423, 'LOGIN_LOCKED', 'This login is locked for 24 hours after too many wrong passwords');
    }

    const passwordOk = await verifyPassword(parsed.data.password, user?.password_hash ?? null);
    const invalid = () => sendError(reply, 401, 'INVALID_CREDENTIALS', 'Wrong email or password');
    if (!user) return invalid();

    if (!passwordOk) {
      // A lock that has run out starts a new count, so the next lock is a fresh 24 hours.
      const count = user.login_locked_at ? 1 : (user.failed_login_count ?? 0) + 1;
      const locked = !user.login_locked_at && count >= LOCKOUT_FAILURES;
      await sql`
        update users set failed_login_count = ${locked ? null : count}, login_locked_at = ${locked ? at : null}
        where id = ${user.id}
      `.execute(db);
      if (locked) {
        await audit(db, { companyId: user.company_id, userId: user.id, action: 'user.locked', targetType: 'user', targetId: user.id });
      }
      return invalid();
    }
    if (user.disabled_at) return invalid();
    if (user.company_status && user.company_status !== 'active')
      return sendError(reply, 403, 'COMPANY_SUSPENDED', 'Your company is suspended. Contact ReapLift');

    await sql`
      update users set failed_login_count = null, login_locked_at = null, last_login_at = ${at} where id = ${user.id}
    `.execute(db);
    const { token } = await createSession(db, user.id, at, { userAgent: req.headers['user-agent'], ip: req.ip });
    reply.header('set-cookie', cookie(token, MAX_AGE_MS / 1000));
    const body: SessionUserView = {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      companyId: user.company_id,
      companyName: await companyName(db, user.company_id),
    };
    return reply.code(200).send({ user: body });
  });

  app.post('/api/auth/logout', async (req, reply) => {
    await revokeSession(db, req.auth!.sessionId, now());
    reply.header('set-cookie', cookie('', 0));
    return reply.code(204).send();
  });

  app.get('/api/auth/me', async (req, reply) => reply.code(200).send({ user: await view(db, req.auth!) }));

  /** The super admin's company picker: every later request in this session works on that company. */
  app.put('/api/auth/company', async (req, reply) => {
    const auth = req.auth!;
    if (auth.role !== 'super_admin') return sendError(reply, 403, 'FORBIDDEN', 'Only a super admin can pick a company');
    const parsed = CompanyChoice.safeParse(req.body);
    if (!parsed.success) return sendError(reply, 400, 'INVALID_REQUEST', 'Send { companyId }');
    const name = await companyName(db, parsed.data.companyId);
    if (name === null) return sendError(reply, 404, 'NOT_FOUND', 'Company not found');
    await sql`update auth_sessions set selected_company_id = ${parsed.data.companyId} where id = ${auth.sessionId}`.execute(db);
    await audit(db, { companyId: parsed.data.companyId, userId: auth.userId, action: 'company.selected', targetType: 'company', targetId: String(parsed.data.companyId) });
    return reply.code(200).send({ user: await view(db, { ...auth, selectedCompanyId: parsed.data.companyId }) });
  });
}
