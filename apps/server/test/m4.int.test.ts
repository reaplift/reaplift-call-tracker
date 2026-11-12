import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql, type Kysely } from 'kysely';
import { buildApp } from '../src/app.js';
import type { Database } from '../src/lib/db.js';
import { createUser } from '../src/modules/auth/users.js';
import { seedOutcomes } from '../src/modules/outcomes/defaults.js';
import { freshDb } from './support/db.js';

// M4 task 4.5: the after-call form. The phone sends an outcome, a comment and a follow-up date for a synced call.

const ORIGIN = 'http://localhost:5174';
const PASSWORD = 'calls-test-password';
const DAY = '2026-11-12';
const at = (hhmm: string) => new Date(`${DAY}T${hhmm}:00+05:30`).toISOString();
const RANGE = `from=${encodeURIComponent(at('00:00'))}&to=${encodeURIComponent(at('23:59'))}`;

let clock = new Date(`${DAY}T10:00:00+05:30`);
let db: Kysely<Database>;
let app: ReturnType<typeof buildApp>;
const cookies: Record<string, string> = {};
let token = '';
let otherToken = '';

const as = (email: string) => (method: 'GET' | 'POST' | 'PATCH', url: string, body?: unknown) =>
  app.inject({ method, url, payload: body as object, headers: { origin: ORIGIN, cookie: cookies[email] ?? '' } });
const admin = as('admin@roads.test');
const otherAdmin = as('admin@bsnl.test');
const phone = (t: string) => (method: 'GET' | 'POST' | 'PATCH', url: string, body?: unknown) =>
  app.inject({ method, url, payload: body as object, headers: { authorization: `Bearer ${t}` } });

async function login(email: string) {
  const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password: PASSWORD }, headers: { origin: ORIGIN } });
  cookies[email] = String(res.headers['set-cookie']).split(';')[0]!;
}

async function pairNew(adminFn: ReturnType<typeof as>, name: string, number: string) {
  const id = (await adminFn('POST', '/api/employees', { name, companyNumber: number })).json().id;
  const code = (await adminFn('POST', `/api/employees/${id}/pairing-code`)).json().code;
  const res = await app.inject({
    method: 'POST',
    url: '/device/v1/pair',
    payload: { code, brand: 'oppo', model: 'CPH2591', androidVersion: '14', sdkInt: 34, appVersion: '0.3.0', simSlot: 0, consentVersion: '1' },
  });
  return res.json().deviceToken as string;
}

beforeAll(async () => {
  ({ db } = await freshDb());
  app = buildApp({ version: 'test', checkDb: async () => true, db, cookieSecure: false, now: () => clock });
  await sql`insert into companies (id, name) values (1, 'Country Roads'), (4, 'BSNL')`.execute(db);
  await seedOutcomes(db, 1);
  await seedOutcomes(db, 4);
  await createUser(db, { email: 'admin@roads.test', name: 'Roads admin', role: 'admin', companyId: 1, password: PASSWORD });
  await createUser(db, { email: 'admin@bsnl.test', name: 'BSNL admin', role: 'admin', companyId: 4, password: PASSWORD });
  await login('admin@roads.test');
  await login('admin@bsnl.test');
  token = await pairNew(admin, 'Meena Iyer', '9876500000');
  otherToken = await pairNew(otherAdmin, 'Ravi Kumar', '9812345678');
  clock = new Date(`${DAY}T16:00:00+05:30`);
  const calls = [
    { deviceCallId: '11', number: '9900011111', type: 'outgoing', startedAt: at('11:00'), talkSeconds: 120 },
    { deviceCallId: '12', number: '9900022222', type: 'incoming', startedAt: at('12:00'), talkSeconds: 45 },
    { deviceCallId: '13', number: '9900033333', type: 'missed', startedAt: at('13:00'), talkSeconds: 0 },
  ];
  expect((await phone(token)('POST', '/device/v1/calls', { calls })).json().accepted).toBe(3);
  expect((await phone(otherToken)('POST', '/device/v1/calls', { calls: [calls[0]] })).json().accepted).toBe(1);
});

afterAll(async () => {
  await app.close();
  await db.destroy();
});

const outcomesFor = async (t: string) => (await phone(t)('GET', '/device/v1/config')).json().outcomes as Array<{ id: string; label: string }>;

describe('outcomes', () => {
  it('every company starts with the six default outcomes, in order', async () => {
    expect((await outcomesFor(token)).map((o) => o.label)).toEqual([
      'Interested', 'Call back later', 'Not interested', 'No answer / busy', 'Wrong number', 'Other',
    ]);
  });

  it("an admin edits their company's list; the phone sees only active ones", async () => {
    const added = await admin('POST', '/api/call-outcomes', { label: 'Site visit booked', sortOrder: 0 });
    expect(added.statusCode).toBe(201);
    expect((await admin('POST', '/api/call-outcomes', { label: 'Site visit booked' })).statusCode).toBe(409);
    const wrong = (await admin('GET', '/api/call-outcomes')).json().items.find((o: { label: string }) => o.label === 'Wrong number');
    expect((await admin('PATCH', `/api/call-outcomes/${wrong.id}`, { active: false })).json().active).toBe(false);
    const labels = (await outcomesFor(token)).map((o) => o.label);
    expect(labels[0]).toBe('Site visit booked');
    expect(labels).not.toContain('Wrong number');
    // The other company's list is untouched and cannot be edited from here.
    expect((await outcomesFor(otherToken)).map((o) => o.label)).toContain('Wrong number');
    expect((await otherAdmin('PATCH', `/api/call-outcomes/${wrong.id}`, { label: 'Hijack' })).statusCode).toBe(404);
  });
});

describe('the after-call form', () => {
  it('saves the outcome, comment and follow-up, and shows them in call history and the CSV', async () => {
    const interested = (await outcomesFor(token)).find((o) => o.label === 'Interested')!;
    const res = await phone(token)('PATCH', '/device/v1/calls/11/comment', {
      outcomeId: interested.id,
      note: 'Wants a 2BHK quote, call after 6 pm',
      followUpAt: '2026-11-13T18:00:00+05:30',
    });
    expect(res.statusCode).toBe(204);
    const call = (await admin('GET', `/api/calls?${RANGE}`)).json().items.find((c: { number: string }) => c.number === '919900011111');
    expect(call).toMatchObject({
      outcome: 'Interested',
      note: 'Wants a 2BHK quote, call after 6 pm',
      followUpAt: '2026-11-13T12:30:00.000Z',
      commentedAt: clock.toISOString(),
    });
    const csv = (await admin('GET', `/api/calls/export.csv?${RANGE}`)).body;
    expect(csv).toContain('Interested,"Wants a 2BHK quote, call after 6 pm","13/11/2026, 18:00:00"');
  });

  it('lists every call still waiting for a comment, missed calls included', async () => {
    const waiting = (await admin('GET', `/api/calls?${RANGE}&commented=no`)).json().items.map((c: { number: string }) => c.number);
    expect(waiting).toEqual(['919900033333', '919900022222']);
    const done = (await admin('GET', `/api/calls?${RANGE}&commented=yes`)).json().items.map((c: { number: string }) => c.number);
    expect(done).toEqual(['919900011111']);
  });

  it('a comment can be changed by sending it again', async () => {
    expect((await phone(token)('PATCH', '/device/v1/calls/11/comment', { outcomeId: null, note: 'Changed my mind', followUpAt: null })).statusCode).toBe(204);
    const call = (await admin('GET', `/api/calls?${RANGE}&commented=yes`)).json().items[0];
    expect(call).toMatchObject({ outcome: null, note: 'Changed my mind', followUpAt: null });
  });

  it('says CALL_NOT_SYNCED for a call the server does not have yet, so the phone retries', async () => {
    const res = await phone(token)('PATCH', '/device/v1/calls/999/comment', { outcomeId: null, note: 'Early', followUpAt: null });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe('CALL_NOT_SYNCED');
  });

  it("refuses an empty form, a switched-off outcome and another company's outcome", async () => {
    expect((await phone(token)('PATCH', '/device/v1/calls/12/comment', { outcomeId: null, note: '  ', followUpAt: null })).statusCode).toBe(400);
    const otherCompanyOutcome = (await outcomesFor(otherToken))[0]!;
    const foreign = await phone(token)('PATCH', '/device/v1/calls/12/comment', { outcomeId: otherCompanyOutcome.id, note: null, followUpAt: null });
    expect(foreign.json().error).toBe('OUTCOME_UNKNOWN');
    const off = (await admin('GET', '/api/call-outcomes')).json().items.find((o: { active: boolean }) => !o.active);
    expect((await phone(token)('PATCH', '/device/v1/calls/12/comment', { outcomeId: off.id, note: null, followUpAt: null })).json().error).toBe('OUTCOME_UNKNOWN');
  });

  it("a phone can comment only on its own calls", async () => {
    // Ravi's phone (BSNL) has its own call 11; commenting changes only that one.
    expect((await phone(otherToken)('PATCH', '/device/v1/calls/12/comment', { outcomeId: null, note: 'Not mine', followUpAt: null })).statusCode).toBe(404);
    const roadsCall12 = (await admin('GET', `/api/calls?${RANGE}`)).json().items.find((c: { number: string }) => c.number === '919900022222');
    expect(roadsCall12.note).toBeNull();
  });
});
