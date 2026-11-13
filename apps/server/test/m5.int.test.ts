import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql, type Kysely } from 'kysely';
import { buildApp } from '../src/app.js';
import type { Database } from '../src/lib/db.js';
import type { RecordingStore } from '../src/lib/storage.js';
import { createUser } from '../src/modules/auth/users.js';
import { createApiKey } from '../src/modules/integration/keys.js';
import { freshDb } from './support/db.js';

// M5: the CRM API, compatible with Callyzer v2.3. A company's CRM calls /api/v2.3/... with its API key and gets
// Callyzer's field names, for its own company's calls only.

const ORIGIN = 'http://localhost:5174';
const PASSWORD = 'calls-test-password';
const DAY = '2026-11-12';
const at = (hhmm: string) => new Date(`${DAY}T${hhmm}:00+05:30`).toISOString();
const unix = (iso: string) => Math.floor(new Date(iso).getTime() / 1000);
const RANGE = { call_from: unix(at('00:00')), call_to: unix(`${DAY}T23:59:59+05:30`) };

let clock = new Date(`${DAY}T08:00:00+05:30`);
let db: Kysely<Database>;
let app: ReturnType<typeof buildApp>;
const cookies: Record<string, string> = {};
const store: RecordingStore = {
  remove: async () => {},
  uploadUrl: async (key) => `https://storage.test/put/${key}`,
  playUrl: async (key, seconds) => `https://storage.test/get/${key}?expires=${seconds}`,
  size: async () => 1_000_000,
};
let roadsKey = '';
let bsnlKey = '';

const panel = (email: string) => (method: 'GET' | 'POST' | 'DELETE', url: string, payload?: object) =>
  app.inject({ method, url, payload, headers: { origin: ORIGIN, cookie: cookies[email] ?? '' } });
const admin = panel('admin@roads.test');
const manager = panel('manager@roads.test');
const bsnlAdmin = panel('admin@bsnl.test');
const phone = (t: string) => (method: 'POST' | 'PATCH', url: string, body: unknown) =>
  app.inject({ method, url, payload: body as object, headers: { authorization: `Bearer ${t}` } });

/** Each request moves the clock on 250 ms, so the 5-a-second limit is not hit by accident. */
async function crm(key: string, path: string, body: object = {}, method: 'POST' | 'GET' = 'POST') {
  clock = new Date(clock.getTime() + 250);
  return app.inject({
    method,
    url: `/api/v2.3/${path}`,
    payload: method === 'POST' ? body : undefined,
    query: method === 'GET' ? (body as Record<string, string>) : undefined,
    headers: { authorization: `Bearer ${key}` },
  });
}

async function login(email: string) {
  const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password: PASSWORD }, headers: { origin: ORIGIN } });
  cookies[email] = String(res.headers['set-cookie']).split(';')[0]!;
}

async function pairNew(adminFn: ReturnType<typeof panel>, name: string, number: string, empCode: string) {
  const res = await adminFn('POST', '/api/employees', { name, companyNumber: number, empCode });
  const id = res.json().id;
  const code = (await adminFn('POST', `/api/employees/${id}/pairing-code`)).json().code;
  const paired = await app.inject({
    method: 'POST',
    url: '/device/v1/pair',
    payload: { code, brand: 'vivo', model: 'I2221', androidVersion: '16', sdkInt: 36, appVersion: '0.5.0', simSlot: 0, consentVersion: '2' },
  });
  return { employeeId: id as string, token: paired.json().deviceToken as string };
}

beforeAll(async () => {
  ({ db } = await freshDb());
  app = buildApp({ version: 'test', checkDb: async () => true, db, cookieSecure: false, now: () => clock, recordingStore: store });
  await sql`insert into companies (id, name) values (1, 'Country Roads'), (4, 'BSNL')`.execute(db);
  await createUser(db, { email: 'admin@roads.test', name: 'Roads admin', role: 'admin', companyId: 1, password: PASSWORD });
  await createUser(db, { email: 'manager@roads.test', name: 'Roads manager', role: 'manager', companyId: 1, password: PASSWORD });
  await createUser(db, { email: 'admin@bsnl.test', name: 'BSNL admin', role: 'admin', companyId: 4, password: PASSWORD });
  for (const e of ['admin@roads.test', 'manager@roads.test', 'admin@bsnl.test']) await login(e);

  const meena = await pairNew(admin, 'Meena Iyer', '9876500000', 'CR-7');
  await admin('POST', '/api/employees', { name: 'Arjun Rao', companyNumber: '9876511111' });
  const ravi = await pairNew(bsnlAdmin, 'Ravi Kumar', '9812345678', 'B-1');
  await admin('POST', '/api/teams', { name: 'North', employeeIds: [meena.employeeId] });
  await admin('POST', '/api/excluded-numbers', { number: '9900055555', label: 'Office' });

  clock = new Date(`${DAY}T18:00:00+05:30`);
  const calls = [
    { deviceCallId: '1', number: '9900022222', type: 'missed', startedAt: at('09:00'), talkSeconds: 0, ringSeconds: 20 },
    { deviceCallId: '2', number: '+91 99000 11111', contactName: 'Asha Builders', type: 'outgoing', startedAt: at('11:00'), talkSeconds: 185, ringSeconds: 8, endedAt: new Date(new Date(at('11:00')).getTime() + 193_000).toISOString() },
    { deviceCallId: '3', number: '9900022222', type: 'incoming', startedAt: at('12:00'), talkSeconds: 60, ringSeconds: 5 },
    { deviceCallId: '4', number: '9900033333', type: 'missed', startedAt: at('13:00'), talkSeconds: 0, ringSeconds: 15 },
    { deviceCallId: '5', number: '9900044444', type: 'outgoing', startedAt: at('14:00'), talkSeconds: 0, ringSeconds: 30 },
    { deviceCallId: '6', number: '9900055555', type: 'outgoing', startedAt: at('15:00'), talkSeconds: 30, ringSeconds: 4 },
  ];
  expect((await phone(meena.token)('POST', '/device/v1/calls', { calls })).json().accepted).toBe(6);
  expect((await phone(ravi.token)('POST', '/device/v1/calls', { calls: [{ ...calls[1], number: '9900099999' }] })).json().accepted).toBe(1);

  await sql`insert into call_outcomes (company_id, label) values (1, 'Interested')`.execute(db);
  const interested = (await sql<{ id: string }>`select id from call_outcomes where company_id = 1 and label = 'Interested'`.execute(db)).rows[0]!.id;
  const comment = await phone(meena.token)('PATCH', '/device/v1/calls/2/comment', {
    outcomeId: interested,
    note: 'Site visit planned',
    followUpAt: '2026-11-13T10:00:00+05:30',
  });
  expect(comment.statusCode).toBe(204);
  const call2 = (await sql<{ id: number }>`select id from calls where number = '919900011111'`.execute(db)).rows[0]!.id;
  await sql`
    insert into recordings (company_id, call_id, status, object_key, size_bytes, mime_type, reported_at, uploaded_at)
    values (1, ${call2}, 'uploaded', 'c1/2026/11/rec.m4a', 1000000, 'audio/mp4', ${clock}, ${clock})
  `.execute(db);

  roadsKey = (await createApiKey(db, { companyId: 1, name: 'Roads CRM', createdBy: null })).key;
  bsnlKey = (await createApiKey(db, { companyId: 4, name: 'BSNL CRM', createdBy: null })).key;
});

afterAll(async () => {
  await app.close();
  await db.destroy();
});

describe('API keys in the panel', () => {
  it('shows a new key once, then only its first characters; revoked keys stop working', async () => {
    const created = await admin('POST', '/api/integrations/api-keys', { name: 'Test key' });
    expect(created.statusCode).toBe(201);
    const { id, key, keyPrefix } = created.json();
    expect(key).toMatch(/^rlk_[A-Za-z0-9_-]{43}$/);
    expect(key.startsWith(keyPrefix)).toBe(true);
    const listed = (await admin('GET', '/api/integrations/api-keys')).json().items;
    expect(listed.find((k: { id: string }) => k.id === id)).not.toHaveProperty('key');
    expect(JSON.stringify(listed)).not.toContain(key);
    const stored = (await sql<{ key_hash: string }>`select key_hash from api_keys where id = ${id}`.execute(db)).rows[0]!;
    expect(stored.key_hash).not.toContain(key);

    expect((await crm(key, 'call-log/summary', RANGE)).statusCode).toBe(200);
    expect((await admin('DELETE', `/api/integrations/api-keys/${id}`)).statusCode).toBe(204);
    const after = await crm(key, 'call-log/summary', RANGE);
    expect(after.statusCode).toBe(401);
    expect(after.json()).toEqual({ result: null, message: 'Invalid API key' });
  });

  it('managers cannot make keys, and one company cannot revoke another company’s key', async () => {
    expect((await manager('POST', '/api/integrations/api-keys', { name: 'x' })).statusCode).toBe(403);
    const bsnlKeyId = (await bsnlAdmin('GET', '/api/integrations/api-keys')).json().items[0].id;
    expect((await admin('DELETE', `/api/integrations/api-keys/${bsnlKeyId}`)).statusCode).toBe(404);
  });
});

describe('authentication and limits', () => {
  it('refuses a missing or wrong key in Callyzer’s error shape', async () => {
    const none = await app.inject({ method: 'POST', url: '/api/v2.3/call-log/history', payload: RANGE });
    expect(none.statusCode).toBe(401);
    expect(none.json().result).toBeNull();
    expect((await crm('rlk_wrong', 'call-log/history', RANGE)).statusCode).toBe(401);
    // A panel cookie is not a key.
    const withCookie = await app.inject({ method: 'POST', url: '/api/v2.3/call-log/history', payload: RANGE, headers: { cookie: cookies['admin@roads.test']! } });
    expect(withCookie.statusCode).toBe(401);
  });

  it('allows 5 requests a second for each key', async () => {
    clock = new Date(clock.getTime() + 2000);
    const send = () => app.inject({ method: 'POST', url: '/api/v2.3/call-log/summary', payload: RANGE, headers: { authorization: `Bearer ${roadsKey}` } });
    const codes = [];
    for (let i = 0; i < 6; i++) codes.push((await send()).statusCode);
    expect(codes).toEqual([200, 200, 200, 200, 200, 429]);
    // Another key has its own allowance.
    expect((await app.inject({ method: 'POST', url: '/api/v2.3/call-log/summary', payload: RANGE, headers: { authorization: `Bearer ${bsnlKey}` } })).statusCode).toBe(200);
    clock = new Date(clock.getTime() + 1000);
    expect((await send()).statusCode).toBe(200);
  });

  it('a suspended company’s key stops working', async () => {
    await sql`update companies set status = 'suspended' where id = 4`.execute(db);
    expect((await crm(bsnlKey, 'call-log/summary', RANGE)).statusCode).toBe(403);
    await sql`update companies set status = 'active' where id = 4`.execute(db);
  });
});

describe('call-log/history', () => {
  it('answers every call with Callyzer’s field names, newest first', async () => {
    const res = await crm(roadsKey, 'call-log/history', { ...RANGE, is_exclude_numbers: false });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({ message: 'Success', total_records: 6, page_no: 1, page_size: 100 });
    expect(body.result.map((r: { client_number: string }) => r.client_number)).toEqual([
      '9900055555', '9900044444', '9900033333', '9900022222', '9900011111', '9900022222',
    ]);
    const asha = body.result.find((r: { client_number: string }) => r.client_number === '9900011111');
    expect(asha).toEqual({
      id: expect.stringMatching(/^\d+$/),
      emp_name: 'Meena Iyer',
      emp_code: 'CR-7',
      emp_country_code: '91',
      emp_number: '9876500000',
      emp_tags: ['North'],
      client_name: 'Asha Builders',
      client_country_code: '91',
      client_number: '9900011111',
      duration: 185,
      call_type: 'Outgoing',
      call_date: '2026-11-12',
      call_time: '11:00:00',
      note: 'Site visit planned',
      call_recording_url: 'https://storage.test/get/c1/2026/11/rec.m4a?expires=86400',
      crm_status: 'Interested',
      reminder_date: '2026-11-13',
      reminder_time: '10:00:00',
      synced_at: '2026-11-12 18:00:00 IST',
      modified_at: expect.stringMatching(/^2026-11-12 \d\d:\d\d:\d\d IST$/),
      lead_id: '',
      call_method: 'PhoneCall',
      call_mode: 'Voice',
      ringing_time: 8,
    });
  });

  it('leaves out excluded numbers by default', async () => {
    const body = (await crm(roadsKey, 'call-log/history', RANGE)).json();
    expect(body.total_records).toBe(5);
    expect(body.result.map((r: { client_number: string }) => r.client_number)).not.toContain('9900055555');
  });

  it('filters by type, exclusive talk and ringing bounds, employee number, tag and client number', async () => {
    const count = async (extra: object) => (await crm(roadsKey, 'call-log/history', { ...RANGE, ...extra })).json().total_records;
    expect(await count({ call_types: ['Missed'] })).toBe(2);
    expect(await count({ call_types: ['incoming', 'Outgoing'] })).toBe(3);
    expect(await count({ duration_grt_than: 60 })).toBe(1);
    expect(await count({ duration_grt_than: 59, duration_les_than: 186 })).toBe(2);
    expect(await count({ ringing_time_grt_than: 15 })).toBe(2);
    expect(await count({ emp_numbers: ['91-9876500000'] })).toBe(5);
    expect(await count({ emp_tags: ['North'] })).toBe(5);
    expect(await count({ client_numbers: ['9900022222'] })).toBe(2);
    expect(await count({ call_method: 'WhatsAppCall' })).toBe(0);
    expect(await count({ call_method: 'PhoneCall', call_mode: 'Voice' })).toBe(5);
    // By sync time: everything synced at 18:00.
    expect(await count({ synced_from: unix(at('17:59')), synced_to: unix(at('18:01')) })).toBe(5);
  });

  it('pages with page_no and page_size', async () => {
    const p2 = (await crm(roadsKey, 'call-log/history', { ...RANGE, page_no: 2, page_size: 2 })).json();
    expect(p2).toMatchObject({ total_records: 5, page_no: 2, page_size: 2 });
    expect(p2.result.map((r: { call_time: string }) => r.call_time)).toEqual(['12:00:00', '11:00:00']);
  });

  it('explains a bad request the way Callyzer does', async () => {
    const bad = async (extra: object) => (await crm(roadsKey, 'call-log/history', { ...RANGE, ...extra })).json();
    expect(await bad({ call_types: ['Voicemail'] })).toEqual({
      result: null,
      message: 'Invalid call_types. Valid call types are Incoming or Outgoing or Missed or Rejected.',
    });
    expect((await bad({ page_size: 101 })).message).toBe('Invalid value. The value should be between 1 to 100.');
    expect((await bad({ emp_numbers: ['91-9000000000'] })).message).toBe('emp_numbers not found: 91-9000000000.');
    expect((await bad({ emp_tags: ['South'] })).message).toBe('emp_tags not found: South.');
    expect((await bad({ call_from: RANGE.call_to, call_to: RANGE.call_from })).message).toBe('call_from must be less than call_to.');
    expect((await bad({ call_from: RANGE.call_from - 200 * 86_400 })).message).toBe('The date range can be at most 180 days.');
    const notJson = await app.inject({ method: 'POST', url: '/api/v2.3/call-log/history', payload: '{oops', headers: { authorization: `Bearer ${roadsKey}`, 'content-type': 'application/json' } });
    expect(notJson.statusCode).toBe(400);
    expect(notJson.json().result).toBeNull();
  });

  it('one company’s key never sees another company’s calls', async () => {
    const body = (await crm(bsnlKey, 'call-log/history', RANGE)).json();
    expect(body.total_records).toBe(1);
    expect(body.result[0]).toMatchObject({ emp_name: 'Ravi Kumar', client_number: '9900099999' });
    // Country Roads' employee number is unknown to BSNL.
    expect((await crm(bsnlKey, 'call-log/history', { ...RANGE, emp_numbers: ['919876500000'] })).statusCode).toBe(400);
  });
});

describe('call-log/get and the stream', () => {
  it('returns calls by ID, never another company’s', async () => {
    const ids = (await sql<{ id: number; company_id: number }>`select id, company_id from calls order by id`.execute(db)).rows;
    const roads = ids.filter((r) => r.company_id === 1).slice(0, 2).map((r) => String(r.id));
    const bsnl = ids.filter((r) => r.company_id === 4).map((r) => String(r.id));
    const res = (await crm(roadsKey, 'call-log/get', { unique_ids: [...roads, ...bsnl] })).json();
    expect(res.result.map((r: { id: string }) => r.id).sort()).toEqual([...roads].sort());
    expect((await crm(roadsKey, 'call-log/get', { unique_ids: [] })).json().message).toBe(
      'Invalid no of unique ids. Minimum 1 and Maximum 20 ids are allowed.',
    );
  });

  it('streams NDJSON, one call a line, then an END line', async () => {
    const res = await crm(roadsKey, 'call-log/history/stream', RANGE);
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('application/x-ndjson');
    const lines = res.body.trim().split('\n').map((l) => JSON.parse(l));
    expect(lines).toHaveLength(6);
    expect(lines[0].result).toHaveProperty('client_number', '9900044444');
    expect(lines.at(-1)).toEqual({ type: 'END', total_records: 5, message: 'Success' });
    expect((await crm(roadsKey, 'call-log/history/stream', {})).statusCode).toBe(400);
  });
});

describe('reports', () => {
  it('call-log/summary uses our report definitions', async () => {
    const res = (await crm(roadsKey, 'call-log/summary', RANGE)).json();
    expect(res.result).toEqual({
      total_incoming_calls: 1,
      total_incoming_duration: 60,
      total_outgoing_calls: 2,
      total_outgoing_duration: 185,
      total_missed_calls: 2,
      total_rejected_calls: 0,
      total_calls: 5,
      total_duration: 245,
      // 13:00 missed from 9900033333; the 09:00 missed call from 9900022222 was answered at 12:00.
      total_never_attended_calls: 1,
      total_not_pickup_by_clients_calls: 1,
      total_unique_clients: 4,
      // 09:00 to 14:00:30 (the last call ends after 30 s of ringing); in calls 20+193+65+15+30 s.
      total_working_hours: '05:00:30',
      total_idle_time: '04:55:07',
      total_connected_calls: 2,
    });
  });

  it('call-log/employee-summary lists every active employee, busiest first', async () => {
    const res = (await crm(roadsKey, 'call-log/employee-summary', RANGE)).json();
    expect(res.total_records).toBe(2);
    const [meena, arjun] = res.result.employees;
    expect(meena).toMatchObject({
      emp_name: 'Meena Iyer',
      emp_number: '9876500000',
      emp_tags: ['North'],
      total_calls: 5,
      total_outgoing_connected_calls: 1,
      total_incoming_connected_calls: 1,
      total_never_attended_calls: 1,
      avg_duration_per_call: '00:00:49',
      last_call_log: { client_number: '9900044444', call_time: '14:00:00' },
    });
    expect(arjun).toMatchObject({ emp_name: 'Arjun Rao', total_calls: 0, last_call_log: null, total_working_hours: '00:00:00' });
  });

  it('call-log/analysis names the top employees and the longest call', async () => {
    const res = (await crm(roadsKey, 'call-log/analysis', RANGE)).json().result;
    expect(res.average_duration).toMatchObject({ total_duration: 245, total_calls: 5, per_call: 49, total_days: 1 });
    expect(res.top_dialer).toMatchObject({ emp_name: 'Meena Iyer', total_outgoing_calls: 2 });
    expect(res.longest_duration.call_log).toMatchObject({ client_number: '9900011111', duration: 185 });
  });

  it('never-attended and not-pickup-by-client group calls by employee and client', async () => {
    const never = (await crm(roadsKey, 'call-log/never-attended', RANGE)).json();
    expect(never.total_records).toBe(1);
    expect(never.result[0]).toMatchObject({ emp_name: 'Meena Iyer', client_number: '9900033333' });
    expect(never.result[0].call_logs).toHaveLength(1);
    expect(never.result[0].call_logs[0]).toMatchObject({ call_type: 'Missed', ringing_time: 15 });
    const notPicked = (await crm(roadsKey, 'call-log/not-pickup-by-client', RANGE)).json();
    expect(notPicked.result.map((g: { client_number: string }) => g.client_number)).toEqual(['9900044444']);
  });

  it('call-log/unique-clients totals each outside number', async () => {
    const res = (await crm(roadsKey, 'call-log/unique-clients', RANGE)).json();
    expect(res.total_records).toBe(4);
    const repeat = res.result.find((c: { client_number: string }) => c.client_number === '9900022222');
    expect(repeat).toMatchObject({ total_calls: 2, total_missed_calls: 1, total_incoming_calls: 1, total_connected_calls: 1, total_never_attended_calls: 0 });
    expect(repeat.last_call_log).toMatchObject({ emp_name: 'Meena Iyer', call_type: 'Incoming', call_time: '12:00:00' });
  });

  it('hourly-analytics puts calls in working-hour slots', async () => {
    const res = (await crm(roadsKey, 'call-log/hourly-analytics', { ...RANGE, working_hour_from: '10:00', working_hour_to: '14:00' })).json().result;
    expect(res.total_calls).toBe(5);
    const slot = (label: string) => res.time_slots.find((s: { slot: string }) => s.slot === label);
    expect(res.time_slots[0].slot).toBe('Before 10:00 AM');
    expect(slot('Before 10:00 AM').total_calls).toBe(1);
    expect(slot('11:00 AM - 11:59 AM')).toMatchObject({ total_calls: 1, total_duration: 185, total_connected_calls: 1, total_call_perc: 20 });
    expect(slot('After 02:00 PM').total_calls).toBe(1);
    // Without working hours, the whole day in 24 slots.
    expect((await crm(roadsKey, 'call-log/hourly-analytics', RANGE)).json().result.time_slots).toHaveLength(24);
  });

  it('daywise-analytics gives each slot per date', async () => {
    const res = (await crm(roadsKey, 'call-log/daywise-analytics', { ...RANGE, working_hour_from: '09:00', working_hour_to: '18:00' })).json().result;
    const nine = res.time_slots.find((s: { slot: string }) => s.slot === '09:00 AM - 09:59 AM');
    expect(nine.day_wise).toEqual([expect.objectContaining({ date: '2026-11-12', day: 'Thu', total_calls: 1 })]);
    expect(res.total_days_with_no_calls_in_time_slot).toBe(res.time_slots.filter((s: { day_wise: Array<{ total_calls: number }> }) => s.day_wise[0]!.total_calls === 0).length);
  });
});

describe('employee/get', () => {
  it('lists employees with their phone, by GET or POST', async () => {
    const res = (await crm(roadsKey, 'employee/get', {}, 'GET')).json();
    expect(res.total_records).toBe(2);
    const meena = res.result.find((e: { emp_name: string }) => e.emp_name === 'Arjun Rao' ? false : true);
    expect(meena).toMatchObject({
      emp_name: 'Meena Iyer',
      emp_code: 'CR-7',
      emp_number: '9876500000',
      app_version: '0.5.0',
      is_call_recording_active: true,
      device_details: { device_model: 'vivo I2221', android_version: '16', sdk_version: '36' },
      device_preference: { is_app_uninstalled: false },
      last_call_at: '2026-11-12 15:00:00 IST',
    });
    const arjun = res.result.find((e: { emp_name: string }) => e.emp_name === 'Arjun Rao');
    expect(arjun.device_preference.is_app_uninstalled).toBe(true);
    const byNumber = (await crm(roadsKey, 'employee/get', { emp_numbers: ['91-9876500000'] })).json();
    expect(byNumber.result.map((e: { emp_name: string }) => e.emp_name)).toEqual(['Meena Iyer']);
    const byCode = (await crm(roadsKey, 'employee/get', { emp_codes: 'CR-7' }, 'GET')).json();
    expect(byCode.total_records).toBe(1);
  });
});
