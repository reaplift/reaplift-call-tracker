import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql, type Kysely } from 'kysely';
import { buildApp } from '../src/app.js';
import type { Database } from '../src/lib/db.js';
import type { RecordingStore } from '../src/lib/storage.js';
import { DEVICE_PER_MINUTE } from '../src/modules/auth/access.js';
import { createUser } from '../src/modules/auth/users.js';
import { freshDb } from './support/db.js';

// M12: numbers whose calls are never recorded or kept. A company's admins (or the super admin) list them; phones get hashes and drop the
// calls; the server refuses any that still arrive and can delete past calls with their recordings.
// Also the phone limits that keep shared hosting from being overloaded.

const ORIGIN = 'http://localhost:5174';
const PASSWORD = 'calls-test-password';
const DIRECTOR = '919811100000';
const at = (hhmm: string) => new Date(`2026-11-12T${hhmm}:00+05:30`).toISOString();

let clock = new Date('2026-11-12T09:00:00+05:30');
let db: Kysely<Database>;
let app: ReturnType<typeof buildApp>;
const cookies: Record<string, string> = {};
const removed: string[] = [];
const store: RecordingStore = {
  uploadUrl: async (key) => `https://storage.test/put/${key}`,
  playUrl: async (key) => `https://storage.test/get/${key}`,
  size: async () => 1000,
  remove: async (key) => {
    removed.push(key);
  },
};
let roadsPhone = '';
let bsnlPhone = '';

const as = (email: string) => (method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: object) =>
  app.inject({ method, url, payload, headers: { origin: ORIGIN, cookie: cookies[email] ?? '' } });
const superAdmin = as('super@reaplift.test');
const admin = as('admin@roads.test');
const bsnl = as('admin@bsnl.test');
const manager = as('manager@roads.test');
const phone = (token: string) => (method: 'GET' | 'POST', url: string, payload?: object) =>
  app.inject({ method, url, payload, headers: { authorization: `Bearer ${token}` } });

async function login(email: string) {
  const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password: PASSWORD }, headers: { origin: ORIGIN } });
  cookies[email] = String(res.headers['set-cookie']).split(';')[0]!;
}

async function pair(adminFn: ReturnType<typeof as>, number: string) {
  const id = (await adminFn('POST', '/api/employees', { name: `Emp ${number}`, companyNumber: number })).json().id;
  const code = (await adminFn('POST', `/api/employees/${id}/pairing-code`)).json().code;
  const res = await app.inject({
    method: 'POST',
    url: '/device/v1/pair',
    payload: { code, brand: 'OPPO', model: 'CPH2721', androidVersion: '16', sdkInt: 36, appVersion: '0.5.2', simSlot: 0, consentVersion: '2' },
  });
  return res.json().deviceToken as string;
}

const call = (id: string, number: string, hhmm: string, talk = 60) => ({ deviceCallId: id, number, type: 'outgoing', startedAt: at(hhmm), talkSeconds: talk });

beforeAll(async () => {
  ({ db } = await freshDb());
  app = buildApp({ version: 'test', checkDb: async () => true, db, cookieSecure: false, now: () => clock, recordingStore: store });
  await sql`insert into companies (id, name) values (1, 'Country Roads'), (4, 'BSNL')`.execute(db);
  await createUser(db, { email: 'super@reaplift.test', name: 'ReapLift', role: 'super_admin', companyId: null, password: PASSWORD });
  await createUser(db, { email: 'admin@roads.test', name: 'Roads admin', role: 'admin', companyId: 1, password: PASSWORD });
  await createUser(db, { email: 'admin@bsnl.test', name: 'BSNL admin', role: 'admin', companyId: 4, password: PASSWORD });
  await createUser(db, { email: 'manager@roads.test', name: 'Roads manager', role: 'manager', companyId: 1, password: PASSWORD });
  for (const e of ['super@reaplift.test', 'admin@roads.test', 'admin@bsnl.test', 'manager@roads.test']) await login(e);
  expect((await superAdmin('PUT', '/api/auth/company', { companyId: 1 })).statusCode).toBe(200);
  roadsPhone = await pair(admin, '9876500000');
  bsnlPhone = await pair(bsnl, '9812345678');

  clock = new Date('2026-11-12T18:00:00+05:30');
  // A call with the director already stored before the number is listed, with an uploaded recording.
  expect((await phone(roadsPhone)('POST', '/device/v1/calls', { calls: [call('1', '98111 00000', '10:00'), call('2', '9900011111', '11:00')] })).json().accepted).toBe(2);
  const directorCall = (await sql<{ id: number }>`select id from calls where number = ${DIRECTOR}`.execute(db)).rows[0]!.id;
  await sql`
    insert into recordings (company_id, call_id, status, object_key, size_bytes, mime_type, reported_at, uploaded_at)
    values (1, ${directorCall}, 'uploaded', 'c1/2026/11/director.m4a', 1000, 'audio/mp4', ${clock}, ${clock})
  `.execute(db);
});

afterAll(async () => {
  await app.close();
  await db.destroy();
});

describe('the never-record list', () => {
  it('a company admin and the super admin can use it; managers cannot; each company has its own', async () => {
    expect((await admin('GET', '/api/never-record-numbers')).json()).toEqual({ items: [] });
    expect((await superAdmin('GET', '/api/never-record-numbers')).json()).toEqual({ items: [] });
    expect((await manager('GET', '/api/never-record-numbers')).statusCode).toBe(403);
    expect((await manager('POST', '/api/never-record-numbers', { number: DIRECTOR })).statusCode).toBe(403);
    const added = await bsnl('POST', '/api/never-record-numbers', { number: '9700011111', label: 'BSNL office' });
    expect(added.statusCode).toBe(201);
    expect((await admin('GET', '/api/never-record-numbers')).json().items).toEqual([]);
    expect((await bsnl('DELETE', '/api/never-record-numbers/919700011111')).statusCode).toBe(204);
  });

  it('adding a number with "delete past calls" removes the stored call and its recording', async () => {
    const res = await admin('POST', '/api/never-record-numbers', { number: '+91 98111 00000', label: 'Director', deletePastCalls: true });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({ number: DIRECTOR, label: 'Director', deletedCalls: 1, deletedRecordings: 1 });
    expect(removed).toEqual(['c1/2026/11/director.m4a']);
    expect((await sql`select 1 from calls where number = ${DIRECTOR}`.execute(db)).rows).toHaveLength(0);
    expect((await sql`select 1 from calls where number = '919900011111'`.execute(db)).rows).toHaveLength(1);
    // The audit log keeps who did it, but only the last four digits.
    const entry = (await sql<{ target_id: string; details: string }>`select target_id, details from audit_logs where action = 'never_record.added' and company_id = 1`.execute(db)).rows[0]!;
    expect(entry.target_id).toBe('…0000');
    expect(JSON.stringify(entry)).not.toContain(DIRECTOR);
    expect((await superAdmin('GET', '/api/never-record-numbers')).json().items).toEqual([
      { number: DIRECTOR, label: 'Director', createdAt: expect.any(String) },
    ]);
  });

  it('phones get the hash, never the number', async () => {
    const config = (await phone(roadsPhone)('GET', '/device/v1/config')).json();
    expect(config.neverRecord).toEqual([createHash('sha256').update(DIRECTOR).digest('hex')]);
    expect(JSON.stringify(config)).not.toContain('98111');
    // Another company's phones are not affected.
    expect((await phone(bsnlPhone)('GET', '/device/v1/config')).json().neverRecord).toEqual([]);
  });

  it('the server refuses a listed number from a phone that still sends it, and keeps the rest', async () => {
    const res = (await phone(roadsPhone)('POST', '/device/v1/calls', { calls: [call('3', '09811100000', '12:00'), call('4', '9900022222', '12:30')] })).json();
    expect(res.accepted).toBe(1);
    expect(res.rejected).toEqual([{ deviceCallId: '3', reason: 'never record' }]);
    expect((await sql`select 1 from calls where number = ${DIRECTOR}`.execute(db)).rows).toHaveLength(0);
    // BSNL's list is its own: the same number is stored there.
    expect((await phone(bsnlPhone)('POST', '/device/v1/calls', { calls: [call('9', DIRECTOR, '12:00')] })).json().accepted).toBe(1);
  });

  it('removing the number lets its calls in again', async () => {
    expect((await superAdmin('DELETE', `/api/never-record-numbers/${DIRECTOR}`)).statusCode).toBe(204);
    expect((await phone(roadsPhone)('POST', '/device/v1/calls', { calls: [call('5', DIRECTOR, '13:00')] })).json().accepted).toBe(1);
    expect((await superAdmin('DELETE', `/api/never-record-numbers/${DIRECTOR}`)).statusCode).toBe(404);
  });
});

describe('calls from before pairing (client, 13 November 2026)', () => {
  it('are refused: only calls from the moment of pairing count, with 10 minutes for a slow phone clock', async () => {
    // roadsPhone was paired at 09:00 on 12 November.
    const res = (
      await phone(roadsPhone)('POST', '/device/v1/calls', {
        calls: [call('old', '9900033333', '08:00'), call('slack', '9900044444', '08:55'), call('after', '9900055555', '09:30')],
      })
    ).json();
    expect(res.rejected).toEqual([{ deviceCallId: 'old', reason: 'before this phone was paired' }]);
    expect(res.accepted).toBe(2);
  });

  it('a newly paired phone is told to send no history', async () => {
    const res = await app.inject({ method: 'GET', url: '/device/v1/config', headers: { authorization: `Bearer ${roadsPhone}` } });
    expect(res.json().settings.initialSyncDays).toBe(0);
  });
});

describe('keeping the shared hosting light', () => {
  it('takes up to 50 missing recordings in one request', async () => {
    const res = await phone(roadsPhone)('POST', '/device/v1/recordings/missing', {
      items: [
        { deviceCallId: '2', diagnostics: { filesInWindow: 0 } },
        { deviceCallId: '4', diagnostics: { filesInWindow: 2, bestScore: 50, bestFolder: 'Music/Recordings/Call Recordings/' } },
        { deviceCallId: 'not-yet' },
      ],
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ saved: 2, notSynced: ['not-yet'] });
    const rows = (await sql<{ status: string; files_in_window: number }>`select status, files_in_window from recordings order by files_in_window`.execute(db)).rows;
    expect(rows).toEqual([{ status: 'missing', files_in_window: 0 }, { status: 'missing', files_in_window: 2 }]);
    const tooMany = { items: Array.from({ length: 51 }, (_, i) => ({ deviceCallId: String(i) })) };
    expect((await phone(roadsPhone)('POST', '/device/v1/recordings/missing', tooMany)).statusCode).toBe(400);
  });

  it(`answers a phone in a loop with 429 after ${DEVICE_PER_MINUTE} requests a minute`, async () => {
    clock = new Date(clock.getTime() + 120_000);
    const codes: number[] = [];
    for (let i = 0; i < DEVICE_PER_MINUTE + 1; i++) codes.push((await phone(roadsPhone)('GET', '/device/v1/config')).statusCode);
    expect(codes.slice(0, DEVICE_PER_MINUTE).every((c) => c === 200)).toBe(true);
    const last = await phone(roadsPhone)('GET', '/device/v1/config');
    expect(last.statusCode).toBe(429);
    expect(last.json().error).toBe('RATE_LIMITED');
    expect(last.headers['retry-after']).toBe('60');
    // Another phone is unaffected, and a minute later this one works again.
    expect((await phone(bsnlPhone)('GET', '/device/v1/config')).statusCode).toBe(200);
    clock = new Date(clock.getTime() + 61_000);
    expect((await phone(roadsPhone)('GET', '/device/v1/config')).statusCode).toBe(200);
  });
});
