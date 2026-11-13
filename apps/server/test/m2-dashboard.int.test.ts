import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql, type Kysely } from 'kysely';
import type { DashboardPeriod } from '@reaplift/calls-shared';
import { buildApp } from '../src/app.js';
import type { Database } from '../src/lib/db.js';
import { createUser } from '../src/modules/auth/users.js';
import { createApiKey } from '../src/modules/integration/keys.js';
import { dashboardPeriods } from '../src/modules/reports/dashboard.js';
import { freshDb } from './support/db.js';

// M2 task 2.7: the panel's dashboard (client, 12 November 2026). Four cards: today, yesterday, the 7 full days before
// today, and this month. The numbers are the CRM API's call-log/summary for the same days.

const ORIGIN = 'http://localhost:5174';
const PASSWORD = 'calls-test-password';
const ist = (day: string, hhmm: string) => new Date(`${day}T${hhmm}:00+05:30`).toISOString();

let clock = new Date(ist('2026-11-08', '09:00'));
let db: Kysely<Database>;
let app: ReturnType<typeof buildApp>;
const cookies: Record<string, string> = {};
let roadsKey = '';

const as = (email: string) => (method: 'GET' | 'POST', url: string, payload?: object) =>
  app.inject({ method, url, payload, headers: { origin: ORIGIN, cookie: cookies[email] ?? '' } });
const admin = as('admin@roads.test');
const manager = as('vikram@roads.test');
const bsnl = as('admin@bsnl.test');

async function login(email: string) {
  const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password: PASSWORD }, headers: { origin: ORIGIN } });
  cookies[email] = String(res.headers['set-cookie']).split(';')[0]!;
}

async function pair(adminFn: ReturnType<typeof as>, name: string, number: string) {
  const id = (await adminFn('POST', '/api/employees', { name, companyNumber: number })).json().id as string;
  const code = (await adminFn('POST', `/api/employees/${id}/pairing-code`)).json().code;
  const res = await app.inject({
    method: 'POST',
    url: '/device/v1/pair',
    payload: { code, brand: 'vivo', model: 'I2221', androidVersion: '16', sdkInt: 36, appVersion: '0.5.0', simSlot: 0, consentVersion: '2' },
  });
  return { id, token: res.json().deviceToken as string };
}

const upload = async (token: string, calls: object[]) => {
  const res = await app.inject({ method: 'POST', url: '/device/v1/calls', payload: { calls }, headers: { authorization: `Bearer ${token}` } });
  expect(res.json().rejected).toEqual([]);
};

const card = (periods: DashboardPeriod[], key: DashboardPeriod['key']) => periods.find((p) => p.key === key)!;

beforeAll(async () => {
  ({ db } = await freshDb());
  app = buildApp({ version: 'test', checkDb: async () => true, db, cookieSecure: false, now: () => clock });
  await sql`insert into companies (id, name) values (1, 'Country Roads'), (4, 'BSNL')`.execute(db);
  await createUser(db, { email: 'admin@roads.test', name: 'Roads admin', role: 'admin', companyId: 1, password: PASSWORD });
  await createUser(db, { email: 'vikram@roads.test', name: 'Vikram', role: 'manager', companyId: 1, password: PASSWORD });
  await createUser(db, { email: 'admin@bsnl.test', name: 'BSNL admin', role: 'admin', companyId: 4, password: PASSWORD });
  for (const e of ['admin@roads.test', 'vikram@roads.test', 'admin@bsnl.test']) await login(e);

  // Phones paired on 8 November, so calls from 31 October are still inside the pairing window.
  const meena = await pair(admin, 'Meena Iyer', '9876500000');
  const ravi = await pair(admin, 'Ravi Kumar', '9812345678');
  const other = await pair(bsnl, 'BSNL person', '9700000000');
  const team = (await admin('POST', '/api/teams', { name: 'North', employeeIds: [meena.id] })).json().id as string;
  const vikramId = (await sql<{ id: string }>`select id from users where email = 'vikram@roads.test'`.execute(db)).rows[0]!.id;
  await sql`insert into team_managers (company_id, team_id, user_id) values (1, ${team}, ${vikramId})`.execute(db);
  await admin('POST', '/api/excluded-numbers', { number: '9900077777', label: 'Office' });

  clock = new Date(ist('2026-11-12', '18:00'));
  // Sessions from 8 November have expired by now.
  for (const e of ['admin@roads.test', 'vikram@roads.test', 'admin@bsnl.test']) await login(e);
  await upload(meena.token, [
    { deviceCallId: 'today', number: '9900011111', type: 'outgoing', startedAt: ist('2026-11-12', '10:00'), talkSeconds: 60, ringSeconds: 5 },
    { deviceCallId: 'y-missed', number: '9900022222', type: 'missed', startedAt: ist('2026-11-11', '11:00'), talkSeconds: 0, ringSeconds: 10 },
    { deviceCallId: 'y-in', number: '9900033333', type: 'incoming', startedAt: ist('2026-11-11', '12:00'), talkSeconds: 120, ringSeconds: 4 },
    { deviceCallId: 'y-office', number: '9900077777', type: 'outgoing', startedAt: ist('2026-11-11', '13:00'), talkSeconds: 10, ringSeconds: 2 },
    { deviceCallId: 'nov6', number: '9900044444', type: 'outgoing', startedAt: ist('2026-11-06', '10:00'), talkSeconds: 0, ringSeconds: 20 },
    { deviceCallId: 'nov1', number: '9900055555', type: 'incoming', startedAt: ist('2026-11-01', '09:00'), talkSeconds: 30, ringSeconds: 3 },
    { deviceCallId: 'oct31', number: '9900066666', type: 'outgoing', startedAt: ist('2026-10-31', '10:00'), talkSeconds: 40, ringSeconds: 3 },
  ]);
  await upload(ravi.token, [
    { deviceCallId: 'r1', number: '9900088888', type: 'outgoing', startedAt: ist('2026-11-11', '15:00'), talkSeconds: 50, ringSeconds: 6 },
  ]);
  await upload(other.token, [
    { deviceCallId: 'b1', number: '9900099999', type: 'incoming', startedAt: ist('2026-11-11', '15:00'), talkSeconds: 70, ringSeconds: 6 },
  ]);
  roadsKey = (await createApiKey(db, { companyId: 1, name: 'test', createdBy: null })).key;
});

afterAll(async () => {
  await app.close();
  await db.destroy();
});

describe('the four periods', () => {
  it('are today, yesterday, the 7 full days before today, and this month, in India time', () => {
    const p = dashboardPeriods(new Date(ist('2026-11-12', '00:30')));
    expect(p.map((x) => [x.key, x.from.toISOString(), x.to.toISOString()])).toEqual([
      ['today', ist('2026-11-12', '00:00'), ist('2026-11-13', '00:00')],
      ['yesterday', ist('2026-11-11', '00:00'), ist('2026-11-12', '00:00')],
      ['last7', ist('2026-11-05', '00:00'), ist('2026-11-12', '00:00')],
      ['month', ist('2026-11-01', '00:00'), ist('2026-11-13', '00:00')],
    ]);
    // On the 1st, "this month" is just today.
    const first = dashboardPeriods(new Date(ist('2026-12-01', '08:00')));
    expect(first[3]!.from.toISOString()).toBe(ist('2026-12-01', '00:00'));
  });
});

describe('GET /api/reports/dashboard', () => {
  it('counts each card’s calls, with the office number left out', async () => {
    const res = await admin('GET', '/api/reports/dashboard');
    expect(res.statusCode).toBe(200);
    const { periods } = res.json() as { periods: DashboardPeriod[] };
    expect(periods.map((p) => [p.key, p.label, p.firstDay, p.lastDay])).toEqual([
      ['today', 'Today', '2026-11-12', '2026-11-12'],
      ['yesterday', 'Yesterday', '2026-11-11', '2026-11-11'],
      ['last7', 'Last 7 days', '2026-11-05', '2026-11-11'],
      ['month', 'This month', '2026-11-01', '2026-11-12'],
    ]);
    expect(card(periods, 'today')).toMatchObject({ totalCalls: 1, outgoingCalls: 1, outgoingSeconds: 60, connectedCalls: 1 });
    expect(card(periods, 'yesterday')).toMatchObject({
      totalCalls: 3, // Meena's missed and incoming, Ravi's outgoing; the office call is excluded
      incomingCalls: 1,
      incomingSeconds: 120,
      outgoingCalls: 1,
      outgoingSeconds: 50,
      missedCalls: 1,
      neverAttended: 1,
      uniqueClients: 3,
      connectedCalls: 2,
      callSeconds: 170,
    });
    // 6 to 11 November: yesterday's 3, plus the unanswered 6 November call.
    expect(card(periods, 'last7')).toMatchObject({ totalCalls: 4, notPickedUp: 1 });
    // 1 to 12 November: everything but 31 October and the office call.
    expect(card(periods, 'month')).toMatchObject({ totalCalls: 6, incomingCalls: 2 });
    // Working hours: Meena on 11 November, 11:00 to 12:02:04; Ravi 15:00 to 15:00:56.
    expect(card(periods, 'yesterday').workingSeconds).toBe(3724 + 56);
  });

  it('a manager sees only their teams', async () => {
    const res = await manager('GET', '/api/reports/dashboard');
    expect(res.statusCode).toBe(200);
    const yesterday = card(res.json().periods, 'yesterday');
    expect(yesterday).toMatchObject({ totalCalls: 2, outgoingCalls: 0 }); // Ravi is not in North
  });

  it('another company sees only its own calls', async () => {
    const yesterday = card((await bsnl('GET', '/api/reports/dashboard')).json().periods, 'yesterday');
    expect(yesterday).toMatchObject({ totalCalls: 1, incomingCalls: 1 });
  });

  it('matches the CRM API’s call-log/summary for the same days', async () => {
    const { periods } = (await admin('GET', '/api/reports/dashboard')).json() as { periods: DashboardPeriod[] };
    for (const p of periods) {
      clock = new Date(clock.getTime() + 300);
      const api = (
        await app.inject({
          method: 'POST',
          url: '/api/v2.3/call-log/summary',
          payload: { call_from: Date.parse(p.from) / 1000, call_to: Date.parse(p.to) / 1000 - 1 },
          headers: { authorization: `Bearer ${roadsKey}` },
        })
      ).json().result;
      expect([p.key, p.totalCalls, p.callSeconds, p.neverAttended, p.notPickedUp, p.uniqueClients, p.connectedCalls]).toEqual([
        p.key, api.total_calls, api.total_duration, api.total_never_attended_calls, api.total_not_pickup_by_clients_calls,
        api.total_unique_clients, api.total_connected_calls,
      ]);
    }
  });

  it('needs a login', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/reports/dashboard' })).statusCode).toBe(401);
  });
});
