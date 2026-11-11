import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql, type Kysely } from 'kysely';
import { buildApp } from '../src/app.js';
import type { Database } from '../src/lib/db.js';
import { createUser } from '../src/modules/auth/users.js';
import { freshDb } from './support/db.js';

const ORIGIN = 'http://localhost:5174';
const PASSWORD = 'calls-test-password';
let clock = new Date('2026-11-09T04:30:00Z'); // 10:00 in India
let db: Kysely<Database>;
let app: ReturnType<typeof buildApp>;
let cookie = '';
let apkDir = '';

const api = (method: 'GET' | 'POST' | 'PATCH', url: string, body?: unknown, headers: Record<string, string> = {}) =>
  app.inject({ method, url, payload: body as object, headers: { origin: ORIGIN, cookie, ...headers } });
const device = (token: string, url: string, body?: unknown) =>
  app.inject({
    method: body === undefined ? 'GET' : 'POST',
    url,
    payload: body as object,
    headers: { authorization: `Bearer ${token}` },
  });

const PHONE = {
  brand: 'vivo',
  model: 'V2230',
  androidVersion: '14',
  sdkInt: 34,
  appVersion: '0.1.0',
  defaultDialer: 'com.android.dialer',
  simSlot: 1,
  simCarrier: 'Jio',
  phoneAccountId: '2',
  consentVersion: '1',
};

async function addEmployee(name: string, number: string) {
  const res = await api('POST', '/api/employees', { name, companyNumber: number });
  expect(res.statusCode).toBe(201);
  return res.json().id as string;
}

async function pairPhone(employeeId: string) {
  const code = (await api('POST', `/api/employees/${employeeId}/pairing-code`)).json().code as string;
  const res = await app.inject({ method: 'POST', url: '/device/v1/pair', payload: { code, ...PHONE } });
  expect(res.statusCode).toBe(201);
  return res.json().deviceToken as string;
}

beforeAll(async () => {
  ({ db } = await freshDb());
  await sql`insert into companies (id, name) values (1, 'ReapLift')`.execute(db);
  apkDir = await mkdtemp(path.join(tmpdir(), 'calls-apk-'));
  app = buildApp({
    version: 'test',
    checkDb: async () => true,
    db,
    cookieSecure: false,
    now: () => clock,
    publicBaseUrl: 'http://192.168.1.10:3100',
    apkDir,
  });
  await createUser(db, { email: 'admin@reaplift.local', name: 'Nikhila', role: 'admin', password: PASSWORD, companyId: 1 });
  await login();
});

/** Logs the admin in again; moving the clock past 12 hours ends the session, as it should. */
async function login() {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { email: 'admin@reaplift.local', password: PASSWORD },
    headers: { origin: ORIGIN },
  });
  expect(res.statusCode).toBe(200);
  cookie = String(res.headers['set-cookie']).split(';')[0]!;
}

afterAll(async () => {
  await app.close();
  await db.destroy();
});

describe('login', () => {
  it('refuses a wrong password and locks after 5 in a row', async () => {
    await createUser(db, { email: 'other@reaplift.local', name: 'Other', role: 'admin', password: PASSWORD, companyId: 1 });
    const attempt = (password: string) =>
      app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { email: 'other@reaplift.local', password },
        headers: { origin: ORIGIN },
      });
    for (let i = 0; i < 5; i++) expect((await attempt('wrong-password')).statusCode).toBe(401);
    expect((await attempt(PASSWORD)).statusCode).toBe(423);
    clock = new Date(clock.getTime() + 25 * 3_600_000);
    expect((await attempt(PASSWORD)).statusCode).toBe(200);
    await login();
  });

  it('refuses a state-changing request from another site', async () => {
    const res = await api('POST', '/api/employees', { name: 'X', companyNumber: '9800000000' }, { origin: 'https://evil.example' });
    expect(res.statusCode).toBe(403);
  });
});

describe('every route has an access rule', () => {
  it('needs a login for panel routes and a device token for phone routes', async () => {
    for (const { method, url } of app.routeList) {
      const concrete = url.replace(':id', '00000000-0000-0000-0000-000000000000').replace(':code', '000000');
      const res = await app.inject({ method: method as 'GET', url: concrete, headers: { origin: ORIGIN } });
      if (['/healthz', '/api/auth/login', '/i/:code', '/app/latest.apk', '/device/v1/pair'].includes(url)) continue;
      expect([url, res.statusCode]).toEqual([url, 401]);
    }
  });
});

describe('employees', () => {
  it('normalises the company number and refuses one already in use', async () => {
    const res = await api('POST', '/api/employees', { name: 'Ravi Kumar', companyNumber: '98123 45678' });
    expect(res.statusCode).toBe(201);
    expect(res.json().companyNumber).toBe('919812345678');
    const dup = await api('POST', '/api/employees', { name: 'Someone', companyNumber: '+919812345678' });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().error).toBe('NUMBER_IN_USE');
  });

  it('refuses a landline as the company number', async () => {
    const res = await api('POST', '/api/employees', { name: 'Desk', companyNumber: '04040001000' });
    expect(res.statusCode).toBe(400);
  });
});

describe('install page and pairing', () => {
  it('shows the install page for a live code, and pairs once', async () => {
    const id = await addEmployee('Asha Rao', '9700011122');
    const codeRes = await api('POST', `/api/employees/${id}/pairing-code`);
    expect(codeRes.statusCode).toBe(201);
    const { code, installUrl, qrSvg } = codeRes.json();
    expect(installUrl).toBe(`http://192.168.1.10:3100/i/${code}`);
    expect(qrSvg).toContain('<svg');

    const page = await app.inject({ method: 'GET', url: `/i/${code}` });
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain('Hi Asha');
    expect(page.body).toContain('scheme=reaplift-calls');

    const paired = await app.inject({ method: 'POST', url: '/device/v1/pair', payload: { code, ...PHONE } });
    expect(paired.statusCode).toBe(201);
    expect(paired.json().employee).toEqual({ name: 'Asha Rao', companyNumber: '919700011122' });
    expect(paired.json().company).toEqual({ name: 'ReapLift' });

    const again = await app.inject({ method: 'POST', url: '/device/v1/pair', payload: { code, ...PHONE } });
    expect(again.json().error).toBe('PAIRING_CODE_INVALID');
    expect((await app.inject({ method: 'GET', url: `/i/${code}` })).body).toContain('expired or was already used');
  });

  it('refuses an expired code', async () => {
    const id = await addEmployee('Imran Shaikh', '9600011122');
    const { code } = (await api('POST', `/api/employees/${id}/pairing-code`)).json();
    clock = new Date(clock.getTime() + 25 * 3_600_000);
    const res = await app.inject({ method: 'POST', url: '/device/v1/pair', payload: { code, ...PHONE } });
    expect(res.json().error).toBe('PAIRING_CODE_INVALID');
    await login();
  });

  it('serves the published APK, and 404 before there is one', async () => {
    expect((await app.inject({ method: 'GET', url: '/app/latest.apk' })).statusCode).toBe(404);
    await writeFile(path.join(apkDir, 'latest.apk'), 'apk-bytes');
    const res = await app.inject({ method: 'GET', url: '/app/latest.apk' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('application/vnd.android.package-archive');
  });
});

describe('call sync and call history', () => {
  let ravi = '';
  let token = '';
  const day = '2026-11-12';
  const at = (hhmm: string) => new Date(`${day}T${hhmm}:00+05:30`).toISOString();
  // M1's worked example: the company-SIM calls only. The 14:40 personal call never leaves the phone.
  const calls = [
    { deviceCallId: '101', number: '+91 99000 11111', contactName: 'Sharma Traders', type: 'outgoing', startedAt: at('14:02'), talkSeconds: 185, ringSeconds: 12 },
    { deviceCallId: '102', number: '8800022222', type: 'outgoing', startedAt: at('14:10'), talkSeconds: 0, ringSeconds: 30 },
    { deviceCallId: '103', number: '9900011111', type: 'missed', startedAt: at('14:25'), talkSeconds: 0, ringSeconds: 20 },
    { deviceCallId: '105', number: '9900011111', type: 'incoming', startedAt: at('15:00'), talkSeconds: 70, ringSeconds: 8 },
  ];

  beforeAll(async () => {
    clock = new Date(`${day}T10:00:00+05:30`);
    await login();
    const employees = (await api('GET', '/api/employees')).json().items as Array<{ id: string; name: string }>;
    ravi = employees.find((e) => e.name === 'Ravi Kumar')!.id;
    token = await pairPhone(ravi);
    clock = new Date(`${day}T15:05:00+05:30`);
  });

  it('stores each call once, even when a batch is sent twice', async () => {
    const first = await device(token, '/device/v1/calls', { calls });
    expect(first.json()).toEqual({ accepted: 4, duplicates: 0, rejected: [] });
    const resent = await device(token, '/device/v1/calls', { calls: [...calls, calls[0]] });
    expect(resent.json()).toEqual({ accepted: 0, duplicates: 5, rejected: [] });
    const count = await sql<{ n: number }>`select count(*) as n from calls where employee_id = ${ravi}`.execute(db);
    expect(count.rows[0]!.n).toBe(4);
  });

  it('rejects calls from the future or from long before pairing, and says which', async () => {
    const res = await device(token, '/device/v1/calls', {
      calls: [
        { deviceCallId: '900', number: '9800000001', type: 'outgoing', startedAt: '2026-12-01T00:00:00Z', talkSeconds: 5 },
        { deviceCallId: '901', number: '9800000001', type: 'outgoing', startedAt: '2026-10-01T00:00:00Z', talkSeconds: 5 },
      ],
    });
    expect(res.json().accepted).toBe(0);
    expect(res.json().rejected.map((r: { deviceCallId: string }) => r.deviceCallId)).toEqual(['900', '901']);
  });

  it('lists today newest first, with the filters of the worked example', async () => {
    const q = `from=${encodeURIComponent(at('00:00'))}&to=${encodeURIComponent(at('23:59'))}&employeeIds=${ravi}`;
    const all = (await api('GET', `/api/calls?${q}`)).json();
    expect(all.items.map((c: { startedAt: string }) => c.startedAt)).toEqual([at('15:00'), at('14:25'), at('14:10'), at('14:02')]);
    expect(all.items[3]).toMatchObject({ number: '919900011111', contactName: 'Sharma Traders', talkSeconds: 185, ringSeconds: 12 });

    const outgoing = (await api('GET', `/api/calls?${q}&types=outgoing`)).json();
    expect(outgoing.items).toHaveLength(2);
    const long = (await api('GET', `/api/calls?${q}&minTalk=60`)).json();
    expect(long.items.map((c: { talkSeconds: number }) => c.talkSeconds)).toEqual([70, 185]);
    const byNumber = (await api('GET', `/api/calls?${q}&numbers=9900011111`)).json();
    expect(byNumber.items).toHaveLength(3);
  });

  it('pages without repeating or skipping a call', async () => {
    const q = `from=${encodeURIComponent(at('00:00'))}&to=${encodeURIComponent(at('23:59'))}&employeeIds=${ravi}&limit=3`;
    const first = (await api('GET', `/api/calls?${q}`)).json();
    expect(first.items).toHaveLength(3);
    const second = (await api('GET', `/api/calls?${q}&cursor=${first.nextCursor}`)).json();
    expect(second.items).toHaveLength(1);
    expect(second.nextCursor).toBeNull();
  });

  it('downloads the same rows as CSV, in India time', async () => {
    const q = `from=${encodeURIComponent(at('00:00'))}&to=${encodeURIComponent(at('23:59'))}&employeeIds=${ravi}`;
    const res = await api('GET', `/api/calls/export.csv?${q}`);
    expect(res.headers['content-type']).toContain('text/csv');
    const lines = res.body.trim().split('\r\n');
    expect(lines).toHaveLength(5);
    expect(lines[4]).toBe('"12/11/2026, 14:02:00",Ravi Kumar,919900011111,Sharma Traders,outgoing,185,12,"12/11/2026, 15:05:00",,,');
  });

  it('refuses a range over 180 days', async () => {
    const res = await api('GET', '/api/calls?from=2026-01-01T00:00:00Z&to=2026-11-01T00:00:00Z');
    expect(res.json().error).toBe('RANGE_TOO_LONG');
  });

  it('stops a revoked phone, and pairing a new phone replaces the old one', async () => {
    const newToken = await pairPhone(ravi);
    const old = await device(token, '/device/v1/config');
    expect(old.json().error).toBe('DEVICE_REVOKED');
    expect((await device(newToken, '/device/v1/config')).statusCode).toBe(200);

    expect((await api('POST', `/api/employees/${ravi}/revoke-device`)).statusCode).toBe(204);
    expect((await device(newToken, '/device/v1/config')).json().error).toBe('DEVICE_REVOKED');
  });

  it('marking an employee as left unpairs their phone', async () => {
    const id = await addEmployee('Meena Iyer', '9500011122');
    const t = await pairPhone(id);
    const res = await api('PATCH', `/api/employees/${id}`, { status: 'left' });
    expect(res.json().status).toBe('left');
    expect((await device(t, '/device/v1/config')).json().error).toBe('DEVICE_REVOKED');
  });
});
