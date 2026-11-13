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
    /** Set for every CRM API route (`/api/v2.3/...`, M5): the key and its one company. */
    apiKey?: { id: string; companyId: number };
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

export type RouteKind = 'public' | 'session' | 'super_admin' | 'admin' | 'manager' | 'device' | 'api_key' | 'unscoped';

/** The CRM API (M5): Callyzer v2.3's paths, so a CRM built for Callyzer changes only its base URL and key. */
export const CRM_API_PREFIX = '/api/v2.3/';

/** Managers can read call history and reports; team, user and employee setup stays with admins. */
export function classifyRoute(url: string): RouteKind {
  if (PUBLIC_ROUTES.includes(url)) return 'public';
  if (SESSION_ROUTES.includes(url)) return 'session';
  if (SUPER_ADMIN_ROUTES.includes(url)) return 'super_admin';
  if (url.startsWith('/device/v1/')) return 'device';
  if (url.startsWith(CRM_API_PREFIX)) return 'api_key';
  if (url === '/api/calls' || url.startsWith('/api/calls/') || url.startsWith('/api/reports/')) return 'manager';
  if (url.startsWith('/api/')) return 'admin';
  return 'unscoped';
}

/** data-model-and-api.md: 5 requests a second per key (Callyzer allows one every 2 seconds). */
export const CRM_API_PER_SECOND = 5;

/**
 * Phones: at most this many requests a minute each. A normal sync makes a handful (calls in batches of 200, missing
 * recordings in batches of 50, settings at most every 30 minutes); this only stops a phone stuck in a loop from
 * tiring the shared hosting. The phone keeps everything and tries again later.
 */
export const DEVICE_PER_MINUTE = 120;

/** Requests per key in a sliding window, kept in memory: the app runs as one process (D10). */
export class RateLimiter {
  private hits = new Map<string, number[]>();
  constructor(
    private max: number,
    private windowMs = 1000,
  ) {}
  allow(key: string, nowMs: number): boolean {
    const recent = (this.hits.get(key) ?? []).filter((t) => nowMs - t < this.windowMs);
    if (recent.length >= this.max) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(nowMs);
    this.hits.set(key, recent);
    return true;
  }
}

/** A version or package name from a phone header: letters, digits, dots, dashes and underscores only. */
function deviceHeader(value: string | string[] | undefined): string | null {
  const v = Array.isArray(value) ? value[0] : value;
  return v && /^[\w.-]{1,100}$/.test(v) ? v : null;
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
  const rateLimiter = new RateLimiter(CRM_API_PER_SECOND);
  const deviceLimiter = new RateLimiter(DEVICE_PER_MINUTE, 60_000);

  app.addHook('onRequest', async (req, reply) => {
    const url = req.routeOptions.url;
    if (!url) return; // no route matched; Fastify answers 404
    const kind = classifyRoute(url);

    // Cookie-carrying requests from another site are refused. Phones carry a token, not a cookie.
    // The CRM API carries a key, not a cookie, so it is called from servers, not browsers.
    if (STATE_CHANGING.has(req.method) && url.startsWith('/api/') && kind !== 'api_key' && req.headers.origin !== panelOrigin) {
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
              app_version: string | null;
              default_dialer: string | null;
            }>`
              select d.id, d.employee_id, d.company_id, d.paired_at, d.revoked_at, co.status as company_status,
                     d.app_version, d.default_dialer
              from devices d join companies co on co.id = d.company_id
              where d.token_hash = ${hashToken(token)}
            `.execute(db)
          ).rows[0]
        : undefined;
      if (!device) return sendError(reply, 401, 'UNAUTHENTICATED', 'Pair this phone first');
      if (device.revoked_at) return sendError(reply, 401, 'DEVICE_REVOKED', 'This phone was unpaired');
      if (device.company_status !== 'active')
        return sendError(reply, 403, 'COMPANY_SUSPENDED', 'Your company is suspended; tracking is paused');
      if (!deviceLimiter.allow(device.id, now().getTime())) {
        reply.header('retry-after', '60');
        return sendError(reply, 429, 'RATE_LIMITED', 'Too many requests from this phone; it will try again shortly');
      }
      // App 0.6.0 sends its version and the phone's current calling app with every request, so the panel shows what
      // the phone has now, not what it had at pairing. Stored only when it changes.
      const version = deviceHeader(req.headers['x-app-version']);
      const dialer = deviceHeader(req.headers['x-default-dialer']);
      if ((version && version !== device.app_version) || (dialer && dialer !== device.default_dialer)) {
        await sql`
          update devices set app_version = ${version ?? device.app_version}, default_dialer = ${dialer ?? device.default_dialer}
          where id = ${device.id}
        `.execute(db);
      }
      req.device = {
        deviceId: device.id,
        employeeId: device.employee_id,
        companyId: device.company_id,
        pairedAt: device.paired_at,
      };
      return;
    }

    if (kind === 'api_key') {
      // Callyzer's error shape, so a CRM built for Callyzer reads it.
      const refuse = (status: number, message: string) => reply.code(status).send({ result: null, message });
      const header = req.headers.authorization ?? '';
      const key = header.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : '';
      const row = key
        ? (
            await sql<{ id: string; company_id: number; revoked_at: Date | null; company_status: string }>`
              select k.id, k.company_id, k.revoked_at, co.status as company_status
              from api_keys k join companies co on co.id = k.company_id
              where k.key_hash = ${hashToken(key)}
            `.execute(db)
          ).rows[0]
        : undefined;
      if (!row || row.revoked_at) return refuse(401, 'Invalid API key');
      if (row.company_status !== 'active') return refuse(403, 'Your company is suspended');
      if (!rateLimiter.allow(row.id, now().getTime())) {
        reply.header('retry-after', '1');
        return refuse(429, 'Too many requests: at most 5 a second for each key');
      }
      await sql`
        update api_keys set last_used_at = ${now()}
        where id = ${row.id} and (last_used_at is null or last_used_at < ${new Date(now().getTime() - 60_000)})
      `.execute(db);
      req.apiKey = { id: row.id, companyId: row.company_id };
      req.scope = { companyId: row.company_id, employeeIds: null };
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
