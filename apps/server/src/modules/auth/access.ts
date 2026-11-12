import { parse as parseCookies } from 'cookie';
import type { FastifyInstance } from 'fastify';
import { sql, type Kysely } from 'kysely';
import type { Database } from '../../lib/db.js';
import { hashToken } from '../../lib/auth.js';
import { sendError } from '../../lib/errors.js';
import { resolveScope, type Scope } from './scope.js';
import { findSession, SESSION_COOKIE, type SessionUser } from './sessions.js';

export interface DeviceAuth {
  deviceId: string;
  employeeId: string;
  /** Taken from the device row, never from the request (D11). */
  companyId: number;
  pairedAt: Date;
}

declare module 'fastify' {
  interface FastifyRequest {
    /** Set for every panel route that needs a login. */
    auth?: SessionUser;
    /** Set for every admin and manager route: the one company, and a manager's employees. */
    scope?: Scope;
    /** Set for every `/device/v1/...` route except pairing. */
    device?: DeviceAuth;
  }
}

/** Routes anyone may call (data-model-and-api.md, "Routes"). */
export const PUBLIC_ROUTES = [
  '/healthz',
  '/api/auth/login',
  '/i/:code',
  '/app/latest.apk',
  '/device/v1/pair',
  // The built panel: its login page has to load before anyone is logged in.
  '/',
  '/assets/*',
];
/** Routes any logged-in user may call; they act only on the caller's own session. */
export const SESSION_ROUTES = ['/api/auth/logout', '/api/auth/me', '/api/auth/company'];
/** Routes for the super admin only (P1): managing companies. */
export const SUPER_ADMIN_ROUTES = ['/api/companies', '/api/companies/:id'];

export type RouteKind = 'public' | 'session' | 'super_admin' | 'admin' | 'manager' | 'device' | 'unscoped';

/** Managers can read call history and reports; team, user and employee setup stays with admins. */
export function classifyRoute(url: string): RouteKind {
  if (PUBLIC_ROUTES.includes(url)) return 'public';
  if (SESSION_ROUTES.includes(url)) return 'session';
  if (SUPER_ADMIN_ROUTES.includes(url)) return 'super_admin';
  if (url.startsWith('/device/v1/')) return 'device';
  if (url === '/api/calls' || url.startsWith('/api/calls/') || url.startsWith('/api/reports/')) return 'manager';
  if (url.startsWith('/api/')) return 'admin';
  return 'unscoped';
}

const STATE_CHANGING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const ADMIN_ROLES = new Set(['super_admin', 'admin']);
const MANAGER_ROLES = new Set(['super_admin', 'admin', 'manager']);

/**
 * Resolves who is calling before any handler runs. Fails closed: a route that matches no rule answers 404.
 * The panel uses a session cookie; phones use their device token. Admin and manager routes also get the
 * request's scope (one company; a manager's team members), so no handler can forget it.
 */
export function registerAccess(
  app: FastifyInstance,
  deps: { db: Kysely<Database>; now: () => Date; panelOrigin: string },
) {
  const { db, now, panelOrigin } = deps;

  app.addHook('onRequest', async (req, reply) => {
    const url = req.routeOptions.url;
    if (!url) return; // no route matched; Fastify answers 404
    const kind = classifyRoute(url);

    // Cookie-carrying requests from another site are refused. Phones carry a token, not a cookie.
    if (STATE_CHANGING.has(req.method) && url.startsWith('/api/') && req.headers.origin !== panelOrigin) {
      return sendError(reply, 403, 'FORBIDDEN', 'Request origin not allowed');
    }

    if (kind === 'public') return;
    if (kind === 'unscoped') {
      req.log.error({ url }, 'route has no access rule');
      return sendError(reply, 404, 'NOT_FOUND', 'Not found');
    }

    if (kind === 'device') {
      const header = req.headers.authorization ?? '';
      const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : '';
      const device = token
        ? (
            await sql<{
              id: string;
              employee_id: string;
              company_id: number;
              paired_at: Date;
              revoked_at: Date | null;
              company_status: string;
            }>`
              select d.id, d.employee_id, d.company_id, d.paired_at, d.revoked_at, co.status as company_status
              from devices d join companies co on co.id = d.company_id
              where d.token_hash = ${hashToken(token)}
            `.execute(db)
          ).rows[0]
        : undefined;
      if (!device) return sendError(reply, 401, 'UNAUTHENTICATED', 'Pair this phone first');
      if (device.revoked_at) return sendError(reply, 401, 'DEVICE_REVOKED', 'This phone was unpaired');
      if (device.company_status !== 'active')
        return sendError(reply, 403, 'COMPANY_SUSPENDED', 'Your company is suspended; tracking is paused');
      req.device = {
        deviceId: device.id,
        employeeId: device.employee_id,
        companyId: device.company_id,
        pairedAt: device.paired_at,
      };
      return;
    }

    const token = parseCookies(req.headers.cookie ?? '')[SESSION_COOKIE];
    const user = token ? await findSession(db, token, now()) : null;
    if (!user) return sendError(reply, 401, 'UNAUTHENTICATED', 'Please log in');
    req.auth = user;
    if (kind === 'session') return;
    if (kind === 'super_admin') {
      if (user.role !== 'super_admin') return sendError(reply, 403, 'FORBIDDEN', 'Only a super admin can do this');
      return;
    }
    if (kind === 'admin' && !ADMIN_ROLES.has(user.role)) {
      return sendError(reply, 403, 'FORBIDDEN', 'Only an admin can do this');
    }
    if (kind === 'manager' && !MANAGER_ROLES.has(user.role)) {
      return sendError(reply, 403, 'FORBIDDEN', 'Only an admin or manager can do this');
    }
    const scoped = await resolveScope(db, user);
    if (!scoped.ok) return sendError(reply, scoped.status, scoped.error, scoped.message);
    req.scope = scoped.scope;
  });
}
