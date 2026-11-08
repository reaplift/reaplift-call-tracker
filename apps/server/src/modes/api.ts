import { buildApp } from '../app.js';
import type { Config } from '../config.js';
import { createDb, createPool, pingDb } from '../lib/db.js';
import type { Logger } from '../lib/logger.js';

/** Pairing codes travel in the install page's path; they stay out of the log. */
export const logUrl = (url: string) => url.split('?')[0]!.replace(/^\/i\/\d+/, '/i/:code');

export async function runApi(config: Config, log: Logger) {
  const pool = createPool(config.DATABASE_URL);
  const db = createDb(pool);
  const app = buildApp({
    version: config.APP_VERSION,
    logger: {
      level: config.LOG_LEVEL,
      serializers: { req: (req) => ({ method: req.method, url: logUrl(req.url), remoteAddress: req.ip }) },
    },
    checkDb: () => pingDb(db),
    db,
    panelOrigin: config.PANEL_ORIGIN,
    cookieSecure: config.SESSION_COOKIE_SECURE,
    publicBaseUrl: config.PUBLIC_BASE_URL,
    apkDir: config.APK_DIR,
    pairingCodeHours: config.PAIRING_CODE_HOURS,
    deviceSettings: { initialSyncDays: config.INITIAL_SYNC_DAYS, syncIntervalMinutes: 15 },
    panelDir: config.PANEL_DIR,
  });

  const shutdown = async () => {
    log.info('shutting down');
    await app.close();
    await db.destroy();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  // 0.0.0.0, so a phone on the same Wi-Fi can reach a developer's laptop.
  await app.listen({ host: '0.0.0.0', port: config.PORT });
  log.info({ port: config.PORT, version: config.APP_VERSION }, 'api listening');
}
