import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql, type Kysely } from 'kysely';
import { buildApp } from '../src/app.js';
import type { Database } from '../src/lib/db.js';
import { createUser } from '../src/modules/auth/users.js';
import { freshDb } from './support/db.js';

// P1 (D11): two companies on one server must never see or change each other's data.
// Company 4 is "BSNL", company 7 is "Country Roads"; the ids stand for the CRM's company numbers.

const ORIGIN = 'http://localhost:5174';
const PASSWORD = 'calls-test-password';
const DAY = '2026-11-12';
const at = (hhmm: string) => new Date(`${DAY}T${hhmm}:00+05:30`).toISOString();
const RANGE = `from=${encodeURIComponent(at('00:00'))}&to=${encodeURIComponent(at('23:59'))}`;
const ZERO_UUID = '00000000-0000-0000-0000-000000000000';

let clock = new Date(`${DAY}T10:00:00+05:30`);
let db: Kysely<Database>;
let app: ReturnType<typeof buildApp>;
const cookies: Record<string, string> = {};

const PHONE = {
  brand: 'samsung',
  model: 'SM-A146',
  androidVersion: '14',
  sdkInt: 34,
  appVersion: '0.1.0',
  simSlot: 1,
  consentVersion: '1',
};

async function login(email: string) {
  const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password: PASSWORD }, headers: { origin: ORIGIN } });
  if (res.statusCode !== 200) return res;
  cookies[email] = String(res.headers['set-cookie']).split(';')[0]!;
  return res;
}

const as = (email: string) => (method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', url: string, body?: unknown) =>
  app.inject({ method, url, payload: body as object, headers: { origin: ORIGIN, cookie: cookies[email] ?? '' } });
const bsnl = as('admin@bsnl.test');
const roads = as('admin@roads.test');
const superAdmin = as('super@reaplift.test');
const teamManager = as('manager@bsnl.test');
const loneManager = as('lonely@bsnl.test');

const device = (token: string, url: string, body?: unknown) =>
  app.inject({ method: body === undefined ? 'GET' : 'POST', url, payload: body as object, headers: { authorization: `Bearer ${token}` } });

async function pair(admin: ReturnType<typeof as>, employeeId: string) {
  const code = (await admin('POST', `/api/employees/${employeeId}/pairing-code`)).json().code as string;
  const res = await app.inject({ method: 'POST', url: '/device/v1/pair', payload: { code, ...PHONE } });
  expect(res.statusCode).toBe(201);
  return res.json() as { deviceToken: string; company: { name: string } };
}

let ravi = ''; // BSNL, in the North team
let asha = ''; // BSNL, in no team
let meena = ''; // Country Roads
let raviToken = '';
let ashaToken = '';
let meenaToken = '';
let northTeam = '';

beforeAll(async () => {
  ({ db } = await freshDb());
  app = buildApp({ version: 'test', checkDb: async () => true, db, cookieSecure: false, now: () => clock, publicBaseUrl: 'https://callit.test' });
  await sql`insert into companies (id, name) values (4, 'BSNL'), (7, 'Country Roads')`.execute(db);
  await createUser(db, { email: 'super@reaplift.test', name: 'ReapLift', role: 'super_admin', companyId: null, password: PASSWORD });
  await createUser(db, { email: 'admin@bsnl.test', name: 'BSNL admin', role: 'admin', companyId: 4, password: PASSWORD });
  await createUser(db, { email: 'admin@roads.test', name: 'Roads admin', role: 'admin', companyId: 7, password: PASSWORD });
  const manager = await createUser(db, { email: 'manager@bsnl.test', name: 'Vikram', role: 'manager', companyId: 4, password: PASSWORD });
  await createUser(db, { email: 'lonely@bsnl.test', name: 'No-team manager', role: 'manager', companyId: 4, password: PASSWORD });
  for (const email of ['super@reaplift.test', 'admin@bsnl.test', 'admin@roads.test', 'manager@bsnl.test', 'lonely@bsnl.test'])
    expect((await login(email)).statusCode).toBe(200);

  ravi = (await bsnl('POST', '/api/employees', { name: 'Ravi Kumar', companyNumber: '9812345678' })).json().id;
  asha = (await bsnl('POST', '/api/employees', { name: 'Asha Rao', companyNumber: '9700011122' })).json().id;
  meena = (await roads('POST', '/api/employees', { name: 'Meena Iyer', companyNumber: '9876500000' })).json().id;
  northTeam = (await bsnl('POST', '/api/teams', { name: 'North', employeeIds: [ravi] })).json().id;
  await sql`insert into team_managers (company_id, team_id, user_id) values (4, ${northTeam}, ${manager.id})`.execute(db);

  const raviPair = await pair(bsnl, ravi);
  expect(raviPair.company).toEqual({ name: 'BSNL' });
  raviToken = raviPair.deviceToken;
  ashaToken = (await pair(bsnl, asha)).deviceToken;
  meenaToken = (await pair(roads, meena)).deviceToken;
  clock = new Date(`${DAY}T16:00:00+05:30`);

  const call = (id: string, number: string, hhmm: string, talk: number) => ({
    deviceCallId: id, number, type: 'outgoing', startedAt: at(hhmm), talkSeconds: talk, ringSeconds: 5,
  });
  expect((await device(raviToken, '/device/v1/calls', { calls: [call('1', '9900011111', '11:00', 120), call('2', '9900022222', '12:00', 0)] })).json().accepted).toBe(2);
  expect((await device(ashaToken, '/device/v1/calls', { calls: [call('1', '9900033333', '13:00', 60)] })).json().accepted).toBe(1);
  expect((await device(meenaToken, '/device/v1/calls', { calls: [call('1', '9900044444', '14:00', 300)] })).json().accepted).toBe(1);
});

afterAll(async () => {
  await app.close();
  await db.destroy();
});

describe('a company admin sees only their own company', () => {
  it('lists only their own employees', async () => {
    const names = (await roads('GET', '/api/employees')).json().items.map((e: { name: string }) => e.name);
    expect(names).toEqual(['Meena Iyer']);
  });

  it("gets 404 for another company's employee on every employee route", async () => {
    expect((await roads('PATCH', `/api/employees/${ravi}`, { name: 'Hijacked' })).statusCode).toBe(404);
    expect((await roads('POST', `/api/employees/${ravi}/pairing-code`)).statusCode).toBe(404);
    expect((await roads('POST', `/api/employees/${ravi}/revoke-device`)).statusCode).toBe(404);
    // Ravi's phone still works.
    expect((await device(raviToken, '/device/v1/config')).statusCode).toBe(200);
  });

  it("never sees another company's calls, even when asking for that employee by id", async () => {
    const own = (await roads('GET', `/api/calls?${RANGE}`)).json().items;
    expect(own.map((c: { employeeName: string }) => c.employeeName)).toEqual(['Meena Iyer']);
    expect((await roads('GET', `/api/calls?${RANGE}&employeeIds=${ravi}`)).json().items).toEqual([]);
    const csv = (await roads('GET', `/api/calls/export.csv?${RANGE}`)).body.trim().split('\r\n');
    expect(csv).toHaveLength(2);
    expect(csv[1]).toContain('Meena Iyer');
  });

  it('counts only their own calls in reports', async () => {
    const summary = (await roads('GET', `/api/reports/summary?${RANGE}`)).json();
    expect(summary).toMatchObject({ totalCalls: 1, talkSeconds: 300, employeeCount: 1 });
    const bsnlSummary = (await bsnl('GET', `/api/reports/summary?${RANGE}`)).json();
    expect(bsnlSummary).toMatchObject({ totalCalls: 3, outgoingCalls: 3, connectedCalls: 2, talkSeconds: 180, employeeCount: 2 });
    const rows = (await roads('GET', `/api/reports/employees?${RANGE}`)).json().items;
    expect(rows.map((r: { employeeName: string }) => r.employeeName)).toEqual(['Meena Iyer']);
  });

  it('keeps teams, users and excluded numbers apart', async () => {
    expect((await roads('GET', '/api/teams')).json().items).toEqual([]);
    expect((await roads('DELETE', `/api/teams/${northTeam}`)).statusCode).toBe(404);
    const users = (await roads('GET', '/api/users')).json().items.map((u: { email: string }) => u.email);
    expect(users).toEqual(['admin@roads.test']);
    // An excluded number in BSNL does not hide Country Roads' calls to it.
    expect((await bsnl('POST', '/api/excluded-numbers', { number: '9900044444', label: 'BSNL office' })).statusCode).toBe(201);
    expect((await roads('GET', '/api/excluded-numbers')).json().items).toEqual([]);
    expect((await roads('GET', `/api/reports/summary?${RANGE}`)).json().totalCalls).toBe(1);
  });

  it("cannot put another company's employee in a team", async () => {
    const res = await roads('POST', '/api/teams', { name: 'Raid', employeeIds: [ravi] });
    expect(res.statusCode).toBe(400);
    expect((await roads('GET', '/api/teams')).json().items).toEqual([]);
  });

  it('cannot delete a user from another company', async () => {
    const bsnlAdmin = (await bsnl('GET', '/api/users')).json().items.find((u: { email: string }) => u.email === 'admin@bsnl.test');
    expect((await roads('DELETE', `/api/users/${bsnlAdmin.id}`)).statusCode).toBe(404);
  });
});

describe('a company SIM number belongs to one employee in one company (D11)', () => {
  it('refuses a number already used in another company', async () => {
    const res = await roads('POST', '/api/employees', { name: 'Copy', companyNumber: '+91 98123 45678' });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('NUMBER_IN_USE');
  });
});

describe('phones write only into their own company', () => {
  it('stores a call under the device row, whatever the request claims', async () => {
    const res = await device(raviToken, '/device/v1/calls', {
      calls: [{ deviceCallId: '9', number: '9900055555', type: 'incoming', startedAt: at('15:00'), talkSeconds: 10, companyId: 7, employeeId: meena }],
    });
    expect(res.statusCode).toBe(200);
    const row = (await sql<{ company_id: number; employee_id: string }>`
      select company_id, employee_id from calls where number = '919900055555'
    `.execute(db)).rows[0]!;
    expect(row).toEqual({ company_id: 4, employee_id: ravi });
  });

  it('the database refuses a link across companies even if the server had a bug', async () => {
    await expect(
      sql`insert into team_members (company_id, team_id, employee_id) values (4, ${northTeam}, ${meena})`.execute(db),
    ).rejects.toMatchObject({ errno: 1452 });
    await expect(
      sql`insert into team_members (company_id, team_id, employee_id) values (7, ${northTeam}, ${meena})`.execute(db),
    ).rejects.toMatchObject({ errno: 1452 });
  });
});

describe('managers see only their teams', () => {
  it("a manager sees their team member's calls and nobody else's", async () => {
    const items = (await teamManager('GET', `/api/calls?${RANGE}`)).json().items;
    expect(new Set(items.map((c: { employeeName: string }) => c.employeeName))).toEqual(new Set(['Ravi Kumar']));
    expect((await teamManager('GET', `/api/calls?${RANGE}&employeeIds=${asha}`)).json().items).toEqual([]);
    expect((await teamManager('GET', `/api/reports/summary?${RANGE}`)).json().employeeCount).toBe(1);
  });

  it('a manager with no team sees nothing, not everything', async () => {
    expect((await loneManager('GET', `/api/calls?${RANGE}`)).json().items).toEqual([]);
    expect((await loneManager('GET', `/api/reports/summary?${RANGE}`)).json().totalCalls).toBe(0);
    const csv = (await loneManager('GET', `/api/calls/export.csv?${RANGE}`)).body.trim().split('\r\n');
    expect(csv).toHaveLength(1);
  });

  it('a manager cannot use admin routes', async () => {
    expect((await teamManager('GET', '/api/employees')).statusCode).toBe(403);
  });
});

describe('the super admin', () => {
  it('must pick a company before seeing any company data', async () => {
    const res = await superAdmin('GET', `/api/calls?${RANGE}`);
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('COMPANY_REQUIRED');
  });

  it('sees exactly what the picked company sees', async () => {
    const picked = await superAdmin('PUT', '/api/auth/company', { companyId: 7 });
    expect(picked.json().user).toMatchObject({ role: 'super_admin', companyId: 7, companyName: 'Country Roads' });
    const names = (await superAdmin('GET', '/api/employees')).json().items.map((e: { name: string }) => e.name);
    expect(names).toEqual(['Meena Iyer']);
    expect((await superAdmin('GET', `/api/reports/summary?${RANGE}`)).json().totalCalls).toBe(1);
    expect((await superAdmin('PUT', '/api/auth/company', { companyId: 999 })).statusCode).toBe(404);
  });

  it('manages companies; nobody else can', async () => {
    const created = await superAdmin('POST', '/api/companies', { id: 12, name: 'Teacher Academy' });
    expect(created.statusCode).toBe(201);
    expect((await superAdmin('POST', '/api/companies', { id: 12, name: 'Again' })).statusCode).toBe(409);
    const list = (await superAdmin('GET', '/api/companies')).json().items.map((c: { id: number }) => c.id);
    expect(list.sort()).toEqual([12, 4, 7].sort());
    expect((await bsnl('GET', '/api/companies')).statusCode).toBe(403);
    expect((await bsnl('PUT', '/api/auth/company', { companyId: 7 })).statusCode).toBe(403);
  });
});

describe('a suspended company', () => {
  it('cannot log in, sync or pair, and comes back when reactivated', async () => {
    const code = (await roads('POST', `/api/employees/${meena}/pairing-code`)).json().code as string;
    expect((await superAdmin('PATCH', '/api/companies/7', { status: 'suspended' })).json().status).toBe('suspended');

    expect((await login('admin@roads.test')).json().error).toBe('COMPANY_SUSPENDED');
    expect((await roads('GET', '/api/employees')).json().error).toBe('COMPANY_SUSPENDED');
    expect((await device(meenaToken, '/device/v1/config')).json().error).toBe('COMPANY_SUSPENDED');
    const paired = await app.inject({ method: 'POST', url: '/device/v1/pair', payload: { code, ...PHONE } });
    expect(paired.json().error).toBe('PAIRING_CODE_INVALID');
    // The super admin can still look at it.
    expect((await superAdmin('GET', '/api/employees')).statusCode).toBe(200);

    await superAdmin('PATCH', '/api/companies/7', { status: 'active' });
    expect((await roads('GET', '/api/employees')).statusCode).toBe(200);
  });
});

describe('every route has an access rule', () => {
  it('needs a login for panel routes and a device token for phone routes', async () => {
    const open = ['/healthz', '/api/auth/login', '/i/:code', '/app/latest.apk', '/device/v1/pair'];
    for (const { method, url } of app.routeList) {
      if (open.includes(url)) continue;
      const concrete = url.replace(':id', ZERO_UUID).replace(':code', '000000').replace(':number', '919800000000');
      const res = await app.inject({ method: method as 'GET', url: concrete, headers: { origin: ORIGIN } });
      expect([url, res.statusCode]).toEqual([url, 401]);
    }
  });
});
