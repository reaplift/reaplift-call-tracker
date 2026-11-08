import { readFile } from 'node:fs/promises';
import path from 'node:path';
import fastifyStatic from '@fastify/static';
import type { FastifyInstance } from 'fastify';

/** The panel needs its own scripts and styles, and inline styles for the QR code; it still may not be framed. */
export const PANEL_CSP =
  "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'";

export const isPanelPath = (url: string) => url === '/' || url.startsWith('/assets/');

/**
 * Serves the built panel (`apps/web/dist`) from the server itself, so one address carries the panel, the
 * install page and the phone API (needed once the server is on the internet; locally Vite serves the panel).
 */
export async function registerPanel(app: FastifyInstance, panelDir: string) {
  const index = await readFile(path.join(panelDir, 'index.html'), 'utf8');
  await app.register(fastifyStatic, { root: path.join(panelDir, 'assets'), prefix: '/assets/', decorateReply: false });
  app.get('/', async (_req, reply) => reply.code(200).header('content-type', 'text/html; charset=utf-8').send(index));
}
