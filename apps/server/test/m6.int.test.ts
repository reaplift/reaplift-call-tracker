import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql, type Kysely } from 'kysely';
import { buildApp } from '../src/app.js';
import type { Database } from '../src/lib/db.js';
import type { RecordingStore } from '../src/lib/storage.js';
import { createUser } from '../src/modules/auth/users.js';
import { freshDb } from './support/db.js';

// M6: call recordings. The phone uploads straight to storage with a link from the server; the panel plays through
// a 5-minute link. Storage is a fake here: what was "uploaded" is a map of key to size.

const ORIGIN = 'http://localhost:5174';
const PASSWORD = 'calls-test-password';
const DAY = '2026-11-12';
const at = (hhmm: string) => new Date(`${DAY}T${hhmm}:00+05:30`).toISOString();
const RANGE = `from=${encodeURIComponent(at('00:00'))}&to=${encodeURIComponent(at('23:59'))}`;

let clock = new Date(`${DAY}T10:00:00+05:30`);
let db: Kysely<Database>;
let app: ReturnType<typeof buildApp>;
const cookies: Record<string, string> = {};
const stored = new Map<string, number>();
const store: RecordingStore = {
  uploadUrl: async (key, contentType) => `https://storage.test/put/${key}?type=${encodeURIComponent(contentType)}`,
  playUrl: async (key) => `https://storage.test/get/${key}`,
  size: async (key) => stored.get(key) ?? null,
};
let token = '';
let otherToken = '';

const as = (email: string) => (method: 'GET' | 'POST', url: string) =>
  app.inject({ method, url, headers: { origin: ORIGIN, cookie: cookies[email] ?? '' } });
const admin = as('admin@roads.test');
const otherAdmin = as('admin@bsnl.test');
const phone = (t: string) => (url: string, body: unknown) =>
  app.inject({ method: 'POST', url, payload: body as object, headers: { authorization: `Bearer ${t}` } });

async function login(email: string) {
  const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password: PASSWORD }, headers: { origin: ORIGIN } });
  cookies[email] = String(res.headers['set-cookie']).split(';')[0]!;
}

async function pairNew(adminFn: ReturnType<typeof as>, name: string, number: string, companyAdmin: string) {
  const res = await app.inject({ method: 'POST', url: '/api/employees', payload: { name, companyNumber: number }, headers: { origin: ORIGIN, cookie: cookies[companyAdmin]! } });
  const id = res.json().id;
  const code = (await adminFn('POST', `/api/employees/${id}/pairing-code`)).json().code;
  const paired = await app.inject({
    method: 'POST',
    url: '/device/v1/pair',
    payload: { code, brand: 'vivo', model: 'I2221', androidVersion: '16', sdkInt: 36, appVersion: '0.4.0', simSlot: 0, consentVersion: '1' },
  });
  return paired.json().deviceToken as string;
}

const callIdOf = async (number: string) =>
  (await sql<{ id: number }>`select id from calls where number = ${number}`.execute(db)).rows[0]!.id;

beforeAll(async () => {
  ({ db } = await freshDb());
  app = buildApp({ version: 'test', checkDb: async () => true, db, cookieSecure: false, now: () => clock, recordingStore: store });
  await sql`insert into companies (id, name) values (1, 'Country Roads'), (4, 'BSNL')`.execute(db);
  await createUser(db, { email: 'admin@roads.test', name: 'Roads admin', role: 'admin', companyId: 1, password: PASSWORD });
  await createUser(db, { email: 'admin@bsnl.test', name: 'BSNL admin', role: 'admin', companyId: 4, password: PASSWORD });
  await login('admin@roads.test');
  await login('admin@bsnl.test');
  token = await pairNew(admin, 'Meena Iyer', '9876500000', 'admin@roads.test');
  otherToken = await pairNew(otherAdmin, 'Ravi Kumar', '9812345678', 'admin@bsnl.test');
  clock = new Date(`${DAY}T16:00:00+05:30`);
  const calls = [
    { deviceCallId: '21', number: '9900011111', type: 'outgoing', startedAt: at('11:00'), talkSeconds: 185 },
    { deviceCallId: '22', number: '9900022222', type: 'incoming', startedAt: at('12:00'), talkSeconds: 60 },
  ];
  expect((await phone(token)('/device/v1/calls', { calls })).json().accepted).toBe(2);
  expect((await phone(otherToken)('/device/v1/calls', { calls: [{ ...calls[0], number: '9900033333' }] })).json().accepted).toBe(1);
});

afterAll(async () => {
  await app.close();
  await db.destroy();
});

const upload = { deviceCallId: '21', sizeBytes: 1_480_000, mimeType: 'audio/mp4', audioSeconds: 184, matchScore: 90 };

describe('uploading a recording', () => {
  let key = '';

  it('gives the phone a short-lived upload link, under a key grouped by company and month', async () => {
    const res = await phone(token)('/device/v1/recordings/upload-url', upload);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.headers).toEqual({ 'content-type': 'audio/mp4' });
    key = decodeURIComponent(new URL(body.uploadUrl).pathname.replace('/put/', ''));
    expect(key).toMatch(new RegExp(`^c1/2026/11/${await callIdOf('919900011111')}-[0-9a-f]{16}\\.m4a$`));
    expect(new Date(body.expiresAt).getTime() - clock.getTime()).toBe(15 * 60 * 1000);
  });

  it('refuses "done" until the file has really arrived', async () => {
    const early = await phone(token)('/device/v1/recordings/complete', { deviceCallId: '21' });
    expect(early.json().error).toBe('UPLOAD_NOT_FOUND');
    stored.set(key, 1_480_000);
    expect((await phone(token)('/device/v1/recordings/complete', { deviceCallId: '21' })).statusCode).toBe(204);
    const row = (await sql<{ status: string; size_bytes: number }>`select status, size_bytes from recordings`.execute(db)).rows[0];
    expect(row).toEqual({ status: 'uploaded', size_bytes: 1_480_000 });
    // Saying "done" twice is harmless; asking to upload again is refused.
    expect((await phone(token)('/device/v1/recordings/complete', { deviceCallId: '21' })).statusCode).toBe(204);
    expect((await phone(token)('/device/v1/recordings/upload-url', upload)).json().error).toBe('RECORDING_EXISTS');
  });

  it('refuses a call the server does not have, a file that is not audio, and one that is too big', async () => {
    expect((await phone(token)('/device/v1/recordings/upload-url', { ...upload, deviceCallId: '99' })).json().error).toBe('CALL_NOT_SYNCED');
    expect((await phone(token)('/device/v1/recordings/upload-url', { ...upload, deviceCallId: '22', mimeType: 'image/jpeg' })).statusCode).toBe(400);
    expect((await phone(token)('/device/v1/recordings/upload-url', { ...upload, deviceCallId: '22', sizeBytes: 400 * 1024 * 1024 })).statusCode).toBe(400);
  });

  it("a phone cannot upload for another phone's call", async () => {
    // BSNL's phone has its own call 21; Country Roads' call 22 is not its call.
    expect((await phone(otherToken)('/device/v1/recordings/upload-url', { ...upload, deviceCallId: '22' })).json().error).toBe('CALL_NOT_SYNCED');
  });
});

describe('a missing recording', () => {
  it('is flagged, shown in call history and filterable; an arrived upload is never overwritten', async () => {
    expect((await phone(token)('/device/v1/recordings/missing', { deviceCallId: '22' })).statusCode).toBe(204);
    expect((await phone(token)('/device/v1/recordings/missing', { deviceCallId: '21' })).statusCode).toBe(204);
    const items = (await admin('GET', `/api/calls?${RANGE}`)).json().items as Array<{ number: string; recording: string | null }>;
    expect(Object.fromEntries(items.map((c) => [c.number, c.recording]))).toEqual({ '919900011111': 'uploaded', '919900022222': 'missing' });
    expect((await admin('GET', `/api/calls?${RANGE}&recording=missing`)).json().items.map((c: { number: string }) => c.number)).toEqual(['919900022222']);
    expect((await admin('GET', `/api/calls?${RANGE}&recording=yes`)).json().items.map((c: { number: string }) => c.number)).toEqual(['919900011111']);
  });
});

describe('playing a recording in the panel', () => {
  it('gives a 5-minute link and writes the play to the audit log', async () => {
    const id = await callIdOf('919900011111');
    const res = await admin('GET', `/api/calls/${id}/recording`);
    expect(res.statusCode).toBe(200);
    expect(res.json().url).toMatch(/^https:\/\/storage\.test\/get\/c1\//);
    expect(new Date(res.json().expiresAt).getTime() - clock.getTime()).toBe(5 * 60 * 1000);
    const plays = (await sql<{ n: number }>`select count(*) as n from audit_logs where action = 'recording.played'`.execute(db)).rows[0]!.n;
    expect(Number(plays)).toBe(1);
  });

  it("another company's admin gets 404, and a call without a recording says so", async () => {
    expect((await otherAdmin('GET', `/api/calls/${await callIdOf('919900011111')}/recording`)).statusCode).toBe(404);
    expect((await admin('GET', `/api/calls/${await callIdOf('919900022222')}/recording`)).json().error).toBe('NO_RECORDING');
  });

  it('is refused 12 months after upload, when R2 has deleted it (D4)', async () => {
    const saved = clock;
    clock = new Date(saved.getTime() + 366 * 86_400_000);
    await login('admin@roads.test');
    const res = await admin('GET', `/api/calls/${await callIdOf('919900011111')}/recording`);
    expect(res.statusCode).toBe(410);
    expect(res.json().error).toBe('RECORDING_EXPIRED');
    clock = saved;
    await login('admin@roads.test');
  });
});

describe('with recordings switched off', () => {
  it('the phone is told to try later', async () => {
    const off = buildApp({ version: 'test', checkDb: async () => true, db, now: () => clock });
    const res = await off.inject({ method: 'POST', url: '/device/v1/recordings/upload-url', payload: { ...upload, deviceCallId: '22' }, headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(503);
    expect(res.json().error).toBe('RECORDINGS_NOT_CONFIGURED');
    await off.close();
  });
});
