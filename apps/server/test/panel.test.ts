import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { unusedDb } from './support/unused-db.js';

describe('the built panel', () => {
  it('is served from / and /assets without a login, with a policy that lets it run', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'panel-'));
    await mkdir(path.join(dir, 'assets'));
    await writeFile(path.join(dir, 'index.html'), '<html><script src="/assets/app.js"></script></html>');
    await writeFile(path.join(dir, 'assets', 'app.js'), 'console.log(1)');
    const app = buildApp({ version: 't', checkDb: async () => true, db: unusedDb(), panelDir: dir });

    const page = await app.inject({ method: 'GET', url: '/' });
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain('/assets/app.js');
    expect(page.headers['content-security-policy']).toContain("default-src 'self'");

    const asset = await app.inject({ method: 'GET', url: '/assets/app.js' });
    expect(asset.statusCode).toBe(200);
    expect(asset.body).toBe('console.log(1)');

    // The API keeps its strict policy.
    const health = await app.inject({ method: 'GET', url: '/healthz' });
    expect(health.headers['content-security-policy']).toBe("default-src 'none'; frame-ancestors 'none'");
  });
});
