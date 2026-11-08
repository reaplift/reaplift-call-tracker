import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { Kysely } from 'kysely';
import type { Database } from '../../lib/db.js';
import { findLiveCode } from '../employees/pairing.js';

/** The app's Android package; the install page's "Open the app" link names it. */
export const APP_PACKAGE = 'com.reaplift.calls';
export const APK_FILE = 'latest.apk';

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** The install page sets its own policy: inline styles only, no scripts. */
const PAGE_CSP = "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'";

const page = (title: string, body: string) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
  body { font-family: system-ui, sans-serif; margin: 0; padding: 24px 16px; background: #f6f7f9; color: #14171f; }
  main { max-width: 420px; margin: 0 auto; }
  h1 { font-size: 22px; margin: 0 0 8px; }
  .code { font-size: 34px; letter-spacing: 6px; font-weight: 700; background: #fff; border-radius: 12px; padding: 12px; text-align: center; margin: 16px 0; }
  ol { padding-left: 20px; line-height: 1.6; }
  a.button { display: block; text-align: center; background: #4b2bd6; color: #fff; text-decoration: none; padding: 14px; border-radius: 10px; font-weight: 600; margin: 12px 0; }
  a.secondary { background: #fff; color: #4b2bd6; border: 2px solid #4b2bd6; }
  .muted { color: #5b6170; font-size: 14px; }
</style></head><body><main>${body}</main></body></html>`;

export function registerInstallRoutes(
  app: FastifyInstance,
  deps: { db: Kysely<Database>; now: () => Date; publicBaseUrl: string; apkDir: string },
) {
  const { db, now, publicBaseUrl, apkDir } = deps;
  const base = publicBaseUrl.replace(/\/$/, '');

  app.get('/i/:code', async (req, reply) => {
    const { code } = req.params as { code: string };
    const live = /^\d{6}$/.test(code) ? await findLiveCode(db, code, now()) : null;
    reply.header('content-type', 'text/html; charset=utf-8').header('content-security-policy', PAGE_CSP);
    if (!live) {
      return reply.code(200).send(
        page(
          'Ask for a new code',
          `<h1>This code has expired or was already used</h1><p>Ask your admin to click <b>Pair phone</b> again and scan the new code.</p>`,
        ),
      );
    }
    const firstName = escapeHtml(live.employeeName.split(/\s+/)[0] ?? '');
    const apkUrl = `${base}/app/${APK_FILE}`;
    // Chrome opens the installed app with the code; before it is installed, the link falls back to the download.
    const openApp =
      `intent://pair?code=${code}&server=${encodeURIComponent(base)}` +
      `#Intent;scheme=reaplift-calls;package=${APP_PACKAGE};S.browser_fallback_url=${encodeURIComponent(apkUrl)};end`;
    return reply.code(200).send(
      page(
        'Install ReapLift Calls',
        `<h1>Hi ${firstName}, install ReapLift Calls</h1>
         <p class="muted">It records your work calls on your company SIM. Nothing from your personal SIM is collected.</p>
         <ol>
           <li>Tap <b>Download the app</b>. If Android asks, allow installing from this browser.</li>
           <li>Open the downloaded file and tap <b>Install</b>.</li>
           <li>Come back here and tap <b>Open the app</b>. Follow the steps on screen.</li>
         </ol>
         <a class="button" href="${apkUrl}">Download the app</a>
         <a class="button secondary" href="${escapeHtml(openApp)}">Open the app</a>
         <p class="muted">If the app asks for a code, type:</p>
         <div class="code">${code.slice(0, 3)} ${code.slice(3)}</div>
         <p class="muted">The code works once and expires in 24 hours.</p>`,
      ),
    );
  });

  app.get('/app/latest.apk', async (_req, reply) => {
    const file = path.join(apkDir, APK_FILE);
    const info = await stat(file).catch(() => null);
    if (!info?.isFile()) return reply.code(404).send({ error: 'NOT_FOUND', message: 'No app has been published yet' });
    return reply
      .code(200)
      .header('content-type', 'application/vnd.android.package-archive')
      .header('content-length', info.size)
      .header('content-disposition', 'attachment; filename="ReapLift-Calls.apk"')
      .send(createReadStream(file));
  });
}
