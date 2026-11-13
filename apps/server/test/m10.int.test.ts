import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql, type Kysely } from 'kysely';
import { buildApp } from '../src/app.js';
import type { Database } from '../src/lib/db.js';
import { createUser } from '../src/modules/auth/users.js';
import { freshDb } from './support/db.js';

// M10: WhatsApp message templates. A company's admins write them; phones get them with their settings and send
// back a log of what WhatsApp was opened with; call history shows it.

const ORIGIN = 'http://localhost:5174';
const PASSWORD = 'calls-test-password';
const at = (hhmm: string) => new Date(`2026-11-13T${hhmm}:00+05:30`).toISOString();

let clock = new Date('2026-11-13T09:00:00+05:30');
let db: Kysely<Database>;
let app: ReturnType<typeof buildApp>;
const cookies: Record<string, string> = {};
let roadsPhone = '';
let bsnlPhone = '';
let followUpId = '';

const as = (email: string) => (method: 'GET' | 'POST' | 'PATCH', url: string, payload?: object) =>
  app.inject({ method, url, payload, headers: { origin: ORIGIN, cookie: cookies[email] ?? '' } });
const admin = as('admin@roads.test');
const manager = as('manager@roads.test');
const bsnl = as('admin@bsnl.test');
const phone = (token: string) => (method: 'GET' | 'POST', url: string, payload?: object) =>
  app.inject({ method, url, payload, headers: { authorization: `Bearer ${token}` } });

async function login(email: string) {
  const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password: PASSWORD }, headers: { origin: ORIGIN } });
  cookies[email] = String(res.headers['set-cookie']).split(';')[0]!;
}

async function pair(adminFn: ReturnType<typeof as>, name: string, number: string) {
  const id = (await adminFn('POST', '/api/employees', { name, companyNumber: number })).json().id;
  const code = (await adminFn('POST', `/api/employees/${id}/pairing-code`)).json().code;
  const res = await app.inject({
    method: 'POST',
    url: '/device/v1/pair',
    payload: { code, brand: 'TECNO', model: 'LH8n', androidVersion: '14', sdkInt: 34, appVersion: '0.6.0', simSlot: 0, consentVersion: '2' },
  });
  return res.json().deviceToken as string;
}

const send = (id: string, extra: object = {}) => ({
  deviceSendId: id,
  templateId: followUpId,
  number: '9900011111',
  deviceCallId: '1',
  body: 'Hi Asha, this is Meena Iyer from Country Roads.',
  app: 'whatsapp_business',
  openedAt: at('11:04'),
  ...extra,
});

beforeAll(async () => {
  ({ db } = await freshDb());
  app = buildApp({ version: 'test', checkDb: async () => true, db, cookieSecure: false, now: () => clock });
  await sql`insert into companies (id, name) values (1, 'Country Roads'), (4, 'BSNL')`.execute(db);
  await createUser(db, { email: 'admin@roads.test', name: 'Roads admin', role: 'admin', companyId: 1, password: PASSWORD });
  await createUser(db, { email: 'manager@roads.test', name: 'Roads manager', role: 'manager', companyId: 1, password: PASSWORD });
  await createUser(db, { email: 'admin@bsnl.test', name: 'BSNL admin', role: 'admin', companyId: 4, password: PASSWORD });
  for (const e of ['admin@roads.test', 'manager@roads.test', 'admin@bsnl.test']) await login(e);
  roadsPhone = await pair(admin, 'Meena Iyer', '9876500000');
  bsnlPhone = await pair(bsnl, 'Ravi Kumar', '9812345678');
  clock = new Date('2026-11-13T12:00:00+05:30');
  await phone(roadsPhone)('POST', '/device/v1/calls', { calls: [{ deviceCallId: '1', number: '9900011111', contactName: 'Asha Builders', type: 'outgoing', startedAt: at('11:00'), talkSeconds: 185 }] });
});

afterAll(async () => {
  await app.close();
  await db.destroy();
});

describe('templates in the panel', () => {
  it('an admin adds, edits and switches off templates; a manager cannot', async () => {
    const res = await admin('POST', '/api/message-templates', {
      title: 'Follow-up',
      body: "Hi {{name}}, this is {{employee_name}} from {{company_name}}. I'll call you on {{follow_up_date}} about {{site_name}}.",
    });
    expect(res.statusCode).toBe(201);
    followUpId = res.json().id;
    expect(res.json()).toMatchObject({ title: 'Follow-up', active: true });
    expect((await admin('POST', '/api/message-templates', { title: 'Welcome', body: 'Hi {{name}}, welcome!' })).statusCode).toBe(201);
    expect((await admin('POST', '/api/message-templates', { title: 'Follow-up', body: 'x' })).json().error).toBe('TEMPLATE_EXISTS');
    const bad = (await admin('POST', '/api/message-templates', { title: 'Bad', body: 'Hi {{Client Name}}' })).json();
    expect(bad.error).toBe('TEMPLATE_BLANK_INVALID');
    expect(bad.message).toContain('{{Client Name}}');
    const welcomeId = (await admin('GET', '/api/message-templates')).json().items.find((t: { title: string }) => t.title === 'Welcome').id;
    expect((await admin('PATCH', `/api/message-templates/${welcomeId}`, { active: false })).json().active).toBe(false);
    expect((await manager('GET', '/api/message-templates')).statusCode).toBe(403);
    expect((await manager('POST', '/api/message-templates', { title: 'X', body: 'Y' })).statusCode).toBe(403);
    // Another company sees none of them and can't change them.
    expect((await bsnl('GET', '/api/message-templates')).json().items).toEqual([]);
    expect((await bsnl('PATCH', `/api/message-templates/${followUpId}`, { title: 'Hijack' })).statusCode).toBe(404);
  });
});

describe('templates on the phone', () => {
  it('come with the settings: only active ones, plus the names for the automatic blanks', async () => {
    const config = (await phone(roadsPhone)('GET', '/device/v1/config')).json();
    expect(config.messageTemplates).toEqual([{ id: followUpId, title: 'Follow-up', body: expect.stringContaining('{{site_name}}') }]);
    expect(config.employeeName).toBe('Meena Iyer');
    expect(config.companyName).toBe('Country Roads');
    expect((await phone(bsnlPhone)('GET', '/device/v1/config')).json().messageTemplates).toEqual([]);
  });
});

describe('the WhatsApp send log', () => {
  it('is kept once per send, linked to the phone’s own call, and shown in call history and the CSV', async () => {
    const res = await phone(roadsPhone)('POST', '/device/v1/message-sends', { sends: [send('s1'), send('s1')] });
    expect(res.json()).toEqual({ accepted: 1, duplicates: 1, rejected: [] });
    const row = (await sql<{ number: string; call_id: number | null; app: string }>`select number, call_id, app from message_sends`.execute(db)).rows[0]!;
    expect(row).toMatchObject({ number: '919900011111', app: 'whatsapp_business' });
    expect(row.call_id).not.toBeNull();
    const range = `from=${encodeURIComponent(at('00:00'))}&to=${encodeURIComponent(at('23:59'))}`;
    const calls = (await admin('GET', `/api/calls?${range}`)).json().items;
    expect(calls[0].whatsapp).toEqual([{ title: 'Follow-up', sentAt: at('11:04') }]);
    const csv = (await admin('GET', `/api/calls/export.csv?${range}`)).body;
    expect(csv.split('\n')[0]).toContain('WhatsApp');
    expect(csv).toContain('Follow-up');
  });

  it('a send without a call or template is kept; another phone’s call is never linked', async () => {
    const res = await phone(bsnlPhone)('POST', '/device/v1/message-sends', {
      sends: [send('b1', { templateId: null, deviceCallId: '1', number: '9900099999' })],
    });
    expect(res.json().accepted).toBe(1);
    const row = (await sql<{ call_id: number | null; company_id: number }>`select call_id, company_id from message_sends where device_send_id = 'b1'`.execute(db)).rows[0]!;
    expect(row).toEqual({ call_id: null, company_id: 4 });
  });

  it('nothing is kept for a never-record number', async () => {
    await admin('POST', '/api/never-record-numbers', { number: '9900077777' });
    const res = await phone(roadsPhone)('POST', '/device/v1/message-sends', { sends: [send('s2', { number: '+91 99000 77777', deviceCallId: null })] });
    expect(res.json()).toEqual({ accepted: 0, duplicates: 0, rejected: [{ deviceSendId: 's2', reason: 'never record' }] });
  });
});
