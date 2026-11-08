import { parse as parseCookies } from 'cookie';
import type { FastifyInstance } from 'fastify';
import { sql, type Kysely } from 'kysely';
import type { Database } from '../../lib/db.js';
import { hashToken } from '../../lib/auth.js';
import { sendError } from '../../lib/errors.js';
import { findSession, SESSION_COOKIE, type SessionUser } from './sessions.js';

export interface DeviceAuth {
  deviceId: string;
  employeeId: string;
  pairedAt: Date;
}

declare module 'fastify' {
  interface FastifyRequest {
    /** Set for every panel route that needs a login. */
    auth?: SessionUser;
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
export const SESSION_ROUTES = ['/api/auth/logout', '/api/auth/me'];

export type RouteKind = 'public' | 'session' | 'admin' | 'manager' | 'device' | 'unscoped';

/** Managers can read M2 call history and reports, while team/admin setup stays admin-only. */
export function classifyRoute(url: string): RouteKind {
  if (PUBLIC_ROUTES.includes(url)) return 'public';
  if (SESSION_ROUTES.includes(url)) return 'session';
  if (url.startsWith('/device/v1/')) return 'device';
  if (url === '/api/calls' || url === '/api/calls/export.csv' || url.startsWith('/api/reports/')) return 'manager';
  if (url.startsWith('/api/')) return 'admin';
  return 'unscoped';
}

const STATE_CHANGING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Resolves who is calling before any handler runs. Fails closed: a route that matches no rule answers 404.
 * The panel uses a session cookie; phones use their device token.
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
    if (
      STATE_CHANGING.has(req.method) &&
      url.startsWith('/api/') &&
      req.headers.origin !== panelOrigin
    ) {
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
            await sql<{ id: string; employee_id: string; paired_at: Date; revoked_at: Date | null }>`
              select id, employee_id, paired_at, revoked_at from devices where token_hash = ${hashToken(token)}
            `.execute(db)
          ).rows[0]
        : undefined;
      if (!device) return sendError(reply, 401, 'UNAUTHENTICATED', 'Pair this phone first');
      if (device.revoked_at) return sendError(reply, 401, 'DEVICE_REVOKED', 'This phone was unpaired');
      req.device = { deviceId: device.id, employeeId: device.employee_id, pairedAt: device.paired_at };
      return;
    }

    const token = parseCookies(req.headers.cookie ?? '')[SESSION_COOKIE];
    const user = token ? await findSession(db, token, now()) : null;
    if (!user) return sendError(reply, 401, 'UNAUTHENTICATED', 'Please log in');
    req.auth = user;
    if (kind === 'admin' && user.role !== 'admin') {
      return sendError(reply, 403, 'FORBIDDEN', 'Only an admin can do this');
    }
    if (kind === 'manager' && user.role !== 'admin' && user.role !== 'manager') {
      return sendError(reply, 403, 'FORBIDDEN', 'Only an admin or manager can do this');
    }
  });
}
