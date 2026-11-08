import { serialize as serializeCookie } from 'cookie';
import type { FastifyInstance } from 'fastify';
import { sql, type Kysely } from 'kysely';
import { z } from 'zod';
import type { Database } from '../../lib/db.js';
import { verifyPassword } from '../../lib/auth.js';
import { sendError } from '../../lib/errors.js';
import { audit } from '../../lib/audit.js';
import { createSession, MAX_AGE_MS, revokeSession, SESSION_COOKIE } from './sessions.js';
import type { UserRole } from './users.js';

/** 5 wrong passwords in a row lock the login for 24 hours, as in reaplift-bsp; `cli unlock-user` opens it sooner. */
export const LOCKOUT_FAILURES = 5;
export const LOCKOUT_MS = 24 * 60 * 60 * 1000;

const LoginBody = z.object({ email: z.string().min(1), password: z.string().min(1) }).strict();

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
        disabled_at: Date | null;
        password_hash: string;
        login_locked_at: Date | null;
      }>`select id, name, email, role, disabled_at, password_hash, login_locked_at from users where email = ${email}`.execute(db)
    ).rows[0];

    if (user?.login_locked_at && at.getTime() - user.login_locked_at.getTime() < LOCKOUT_MS) {
      return sendError(reply, 423, 'LOGIN_LOCKED', 'This login is locked for 24 hours after too many wrong passwords');
    }

    const passwordOk = await verifyPassword(parsed.data.password, user?.password_hash ?? null);
    const invalid = () => sendError(reply, 401, 'INVALID_CREDENTIALS', 'Wrong email or password');
    if (!user) return invalid();

    if (!passwordOk) {
      const locked = (
        await sql<{ locked: boolean }>`
          update users set
            -- A lock that has run out starts a new count, so the next lock is a fresh 24 hours.
            failed_login_count = case when login_locked_at is not null then 1 else coalesce(failed_login_count, 0) + 1 end,
            login_locked_at = case
              when login_locked_at is null and coalesce(failed_login_count, 0) + 1 >= ${LOCKOUT_FAILURES} then ${at}::timestamptz
            end
          where id = ${user.id}
          returning login_locked_at is not null as locked
        `.execute(db)
      ).rows[0]!.locked;
      if (locked) {
        await sql`update users set failed_login_count = null where id = ${user.id}`.execute(db);
        await audit(db, { userId: user.id, action: 'user.locked', targetType: 'user', targetId: user.id });
      }
      return invalid();
    }
    if (user.disabled_at) return invalid();

    await sql`
      update users set failed_login_count = null, login_locked_at = null, last_login_at = ${at} where id = ${user.id}
    `.execute(db);
    const { token } = await createSession(db, user.id, at, { userAgent: req.headers['user-agent'], ip: req.ip });
    reply.header('set-cookie', cookie(token, MAX_AGE_MS / 1000));
    return reply.code(200).send({ user: { id: user.id, name: user.name, email: user.email, role: user.role } });
  });

  app.post('/api/auth/logout', async (req, reply) => {
    await revokeSession(db, req.auth!.sessionId, now());
    reply.header('set-cookie', cookie('', 0));
    return reply.code(204).send();
  });

  app.get('/api/auth/me', async (req, reply) => {
    const { userId, name, email, role } = req.auth!;
    return reply.code(200).send({ user: { id: userId, name, email, role } });
  });
}
