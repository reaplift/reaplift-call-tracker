import { sql, type Kysely } from 'kysely';
import type { Database } from '../../lib/db.js';
import { createSessionToken, hashToken } from '../../lib/auth.js';
import type { UserRole } from './users.js';

export const SESSION_COOKIE = 'rl_calls_session';
/** A session ends 12 hours after the last request... */
export const IDLE_MS = 12 * 60 * 60 * 1000;
/** ...and never lasts more than 7 days in total. */
export const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
/** last_seen_at is written at most once a minute, not on every request. */
const TOUCH_EVERY_MS = 60 * 1000;

export interface SessionUser {
  sessionId: string;
  userId: string;
  name: string;
  email: string;
  role: UserRole;
  /** The user's own company; null for a super admin. */
  companyId: number | null;
  /** A super admin's chosen company for this session (P1). */
  selectedCompanyId: number | null;
}

function expiryFrom(createdAt: Date, now: Date): Date {
  return new Date(Math.min(now.getTime() + IDLE_MS, createdAt.getTime() + MAX_AGE_MS));
}

export async function createSession(
  db: Kysely<Database>,
  userId: string,
  now: Date,
  meta: { userAgent?: string; ip?: string },
): Promise<{ token: string }> {
  const token = createSessionToken();
  await sql`
    insert into auth_sessions (user_id, token_hash, created_at, last_seen_at, expires_at, user_agent, ip_address)
    values (${userId}, ${hashToken(token)}, ${now}, ${now}, ${expiryFrom(now, now)},
            ${meta.userAgent?.slice(0, 500) ?? null}, ${meta.ip ?? null})
  `.execute(db);
  return { token };
}

/** Returns the session's user when the token is live and the user is not disabled, and slides the idle expiry. */
export async function findSession(db: Kysely<Database>, token: string, now: Date): Promise<SessionUser | null> {
  const row = (
    await sql<{
      session_id: string;
      created_at: Date;
      last_seen_at: Date;
      selected_company_id: number | null;
      user_id: string;
      name: string;
      email: string;
      role: UserRole;
      company_id: number | null;
    }>`
      select s.id as session_id, s.created_at, s.last_seen_at, s.selected_company_id,
             u.id as user_id, u.name, u.email, u.role, u.company_id
      from auth_sessions s join users u on u.id = s.user_id
      where s.token_hash = ${hashToken(token)} and s.revoked_at is null and s.expires_at > ${now}
        and u.disabled_at is null
    `.execute(db)
  ).rows[0];
  if (!row) return null;
  if (now.getTime() - row.last_seen_at.getTime() >= TOUCH_EVERY_MS) {
    await sql`
      update auth_sessions set last_seen_at = ${now}, expires_at = ${expiryFrom(row.created_at, now)}
      where id = ${row.session_id}
    `.execute(db);
  }
  return {
    sessionId: row.session_id,
    userId: row.user_id,
    name: row.name,
    email: row.email,
    role: row.role,
    companyId: row.company_id,
    selectedCompanyId: row.role === 'super_admin' ? row.selected_company_id : null,
  };
}

export async function revokeSession(db: Kysely<Database>, sessionId: string, now: Date): Promise<void> {
  await sql`update auth_sessions set revoked_at = ${now} where id = ${sessionId} and revoked_at is null`.execute(db);
}
