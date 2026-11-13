import Fastify, { type FastifyServerOptions } from 'fastify';
import type { Kysely } from 'kysely';
import type { DeviceSettings, HealthResponse } from '@reaplift/calls-shared';
import type { Database } from './lib/db.js';
import { CRM_API_PREFIX, registerAccess } from './modules/auth/access.js';
import { registerAuthRoutes } from './modules/auth/routes.js';
import { registerCallRoutes } from './modules/calls/routes.js';
import { registerCompanyRoutes } from './modules/companies/routes.js';
import { registerDeviceRoutes } from './modules/device/routes.js';
import { registerEmployeeRoutes } from './modules/employees/routes.js';
import { registerInstallRoutes } from './modules/install/routes.js';
import { registerOutcomeRoutes } from './modules/outcomes/routes.js';
import { registerNoteTemplateRoutes } from './modules/outcomes/templates.js';
import { registerRecordingRoutes } from './modules/recordings/routes.js';
import type { RecordingStore } from './lib/storage.js';
import { registerReportsRoutes } from './modules/reports/routes.js';
import { registerDashboardRoutes } from './modules/reports/dashboard.js';
import { registerCallyzerRoutes } from './modules/integration/callyzer.js';
import { registerApiKeyRoutes } from './modules/integration/keys.js';
import { isPanelPath, PANEL_CSP, registerPanel } from './modules/panel/routes.js';

declare module 'fastify' {
  interface FastifyInstance {
    /** Every route registered, so the route-walking test can check each one's access rule. */
    routeList: Array<{ method: string; url: string }>;
  }
}

export interface AppDeps {
  version: string;
  checkDb: () => Promise<boolean>;
  db: Kysely<Database>;
  logger?: FastifyServerOptions['logger'];
  /** The panel's address; state-changing panel requests from any other origin are refused. */
  panelOrigin?: string;
  /** Secure flag on the session cookie; off only for plain-http local development. */
  cookieSecure?: boolean;
  /** Clock, replaceable in tests (session expiry, lockout, pairing codes). */
  now?: () => Date;
  /** The address phones and the install page use; it goes into the pairing QR code. */
  publicBaseUrl?: string;
  /** Folder holding `latest.apk` for the install page. */
  apkDir?: string;
  pairingCodeHours?: number;
  deviceSettings?: DeviceSettings;
  /** The built panel to serve from `/`; unset locally, where Vite serves it. */
  panelDir?: string;
  /** Where call recordings are stored (M6); null switches recordings off. */
  recordingStore?: RecordingStore | null;
}

export const DEFAULT_DEVICE_SETTINGS: DeviceSettings = { initialSyncDays: 7, syncIntervalMinutes: 15 };

/** Builds the HTTP app. Dependencies are passed in so tests can replace them. */
export function buildApp({
  version,
  checkDb,
  db,
  logger = false,
  panelOrigin = 'http://localhost:5174',
  cookieSecure = true,
  now = () => new Date(),
  publicBaseUrl = 'http://localhost:3100',
  apkDir = './apk',
  pairingCodeHours = 24,
  deviceSettings = DEFAULT_DEVICE_SETTINGS,
  panelDir,
  recordingStore = null,
}: AppDeps) {
  const app = Fastify({ logger, trustProxy: true });
  app.decorate('routeList', []);
  app.addHook('onRoute', (route) => {
    for (const method of [route.method].flat()) {
      if (method !== 'HEAD') app.routeList.push({ method, url: route.url });
    }
  });

  // The API answers data, never pages: nothing may frame it, guess its type, or keep a copy of it.
  // The install page sets its own content policy, which is kept.
  app.addHook('onSend', async (req, reply, payload) => {
    reply.header('x-content-type-options', 'nosniff');
    reply.header('x-frame-options', 'DENY');
    if (!reply.hasHeader('content-security-policy'))
      reply.header(
        'content-security-policy',
        isPanelPath(req.url) ? PANEL_CSP : "default-src 'none'; frame-ancestors 'none'",
      );
    reply.header('referrer-policy', 'no-referrer');
    reply.header('cache-control', 'no-store');
    return payload;
  });
  // An unexpected error answers in general terms: its message can carry SQL or file paths. The log keeps the detail.
  app.setErrorHandler((err: { statusCode?: number; code?: string; message: string }, req, reply) => {
    const status = err.statusCode ?? 500;
    // The CRM API answers in Callyzer's shape, errors included.
    if (req.url.startsWith(CRM_API_PREFIX)) {
      if (status >= 500) req.log.error({ err }, 'request failed');
      return reply.code(status >= 500 ? 500 : status).send({ result: null, message: status >= 500 ? 'Something went wrong. Please try again.' : err.message });
    }
    if (status >= 500) {
      req.log.error({ err }, 'request failed');
      return reply.code(500).send({ error: 'INTERNAL', message: 'Something went wrong. Please try again.' });
    }
    return reply.code(status).send({ error: 'INVALID_REQUEST', message: err.message });
  });

  registerAccess(app, { db, now, panelOrigin });
  registerAuthRoutes(app, { db, now, cookieSecure });
  registerCompanyRoutes(app, { db });
  registerEmployeeRoutes(app, { db, now, publicBaseUrl, pairingCodeHours });
  registerDeviceRoutes(app, { db, now, settings: deviceSettings });
  registerCallRoutes(app, { db, now });
  registerReportsRoutes(app, { db, now });
  registerDashboardRoutes(app, { db, now });
  registerOutcomeRoutes(app, { db });
  registerNoteTemplateRoutes(app, { db });
  registerRecordingRoutes(app, { db, now, store: recordingStore });
  registerApiKeyRoutes(app, { db });
  registerCallyzerRoutes(app, { db, now, store: recordingStore });
  registerInstallRoutes(app, { db, now, publicBaseUrl, apkDir });
  if (panelDir) app.register((instance) => registerPanel(instance, panelDir));

  app.get('/healthz', async (_req, reply) => {
    const dbOk = await checkDb();
    const body: HealthResponse = { status: dbOk ? 'ok' : 'error', version, db: dbOk ? 'ok' : 'down' };
    return reply.code(dbOk ? 200 : 503).send(body);
  });

  return app;
}
