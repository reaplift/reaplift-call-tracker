import { Readable } from 'node:stream';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { sql, type Kysely, type RawBuilder } from 'kysely';
import { z } from 'zod';
import type { Database } from '../../lib/db.js';
import { normalizeNumber } from '../../lib/phone.js';
import type { RecordingStore } from '../../lib/storage.js';
import { startOfIstDay } from '../../lib/time.js';
import { scopeSql, type Scope } from '../auth/scope.js';
import { CRM_API_PREFIX } from '../auth/access.js';
import { MAX_RANGE_DAYS } from '../calls/filter.js';
import { RECORDING_RETENTION_DAYS } from '../recordings/routes.js';

/**
 * The CRM API (M5), compatible with Callyzer's API v2.3 (developers.callyzer.co/v2.3/, read 12 November 2026):
 * the same paths, request fields and response fields, so a CRM built for Callyzer changes only its base URL and
 * key. It is a translation over our own tables and report definitions (HLD section 6); nothing here changes them.
 * docs/milestones/m5-crm-integration/callyzer-compatibility.md lists every field and where we differ.
 */

/** A recording link in an API answer works this long; the CRM asks again for a fresh one. */
export const API_RECORDING_LINK_SECONDS = 24 * 3600;
const MAX_PAGE_SIZE = 100;
const MAX_UNIQUE_IDS = 20;
/** The stream answers at most this many calls; a narrower range gets the rest. */
export const STREAM_MAX_ROWS = 100_000;
const IST_MS = 330 * 60_000;
const TYPES = ['incoming', 'outgoing', 'missed', 'rejected'] as const;
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// ---------- request ----------

/** Callyzer ignores blank and null values; a GET query sends lists as "a,b". */
const blank = (v: unknown) => v === undefined || v === null || v === '';
const num = z.preprocess((v) => (blank(v) ? undefined : Number(v)), z.number().int().nonnegative().optional());
const list = z.preprocess(
  (v) => (blank(v) ? undefined : typeof v === 'string' ? v.split(',').map((s) => s.trim()).filter(Boolean) : v),
  z.array(z.string().max(100)).max(100).optional(),
);
const bool = z.preprocess((v) => (blank(v) ? undefined : v === 'true' ? true : v === 'false' ? false : v), z.boolean().optional());
const str = z.preprocess((v) => (blank(v) ? undefined : v), z.string().max(100).optional());

const Body = z.object({
  call_from: num,
  call_to: num,
  synced_from: num,
  synced_to: num,
  call_types: list,
  duration_les_than: num,
  duration_grt_than: num,
  ringing_time_les_than: num,
  ringing_time_grt_than: num,
  emp_numbers: list,
  emp_tags: list,
  client_numbers: list,
  is_exclude_numbers: bool,
  call_method: str,
  call_mode: str,
  page_no: num,
  page_size: num,
  working_hour_from: str,
  working_hour_to: str,
  exclude_days: list,
  unique_ids: list,
  emp_name: str,
  emp_codes: list,
});
type Body = z.infer<typeof Body>;

class ApiError extends Error {}

interface Filter {
  where: RawBuilder<unknown>;
  from: Date;
  /** Exclusive. */
  to: Date;
  /** The end of the period for "no connected call after it" (never attended, not picked up). */
  periodEnd: Date;
  /** True when the filter is on the call date, so slots and day counts follow it. */
  byCallDate: boolean;
  pageNo: number;
  pageSize: number;
  body: Body;
}

function readBody(raw: unknown): Body {
  const parsed = Body.safeParse(raw ?? {});
  if (!parsed.success) {
    const field = parsed.error.issues[0]?.path.join('.') ?? 'request';
    throw new ApiError(`Invalid value for ${field}.`);
  }
  return parsed.data;
}

function page(b: Body) {
  const pageNo = b.page_no ?? 1;
  const pageSize = b.page_size ?? MAX_PAGE_SIZE;
  if (pageNo < 1) throw new ApiError('Invalid page_no. The value should be 1 or more.');
  if (pageSize < 1 || pageSize > MAX_PAGE_SIZE) throw new ApiError('Invalid value. The value should be between 1 to 100.');
  return { pageNo, pageSize };
}

/** Employee numbers as Callyzer writes them ("91-9999999999") or as we do ("919999999999"). */
const toNumbers = (values: string[] | undefined) => (values ?? []).map((v) => normalizeNumber(v).number).filter(Boolean);

async function buildFilter(db: Kysely<Database>, scope: Scope, raw: unknown, now: Date): Promise<Filter> {
  const b = readBody(raw);
  const { pageNo, pageSize } = page(b);
  const parts: RawBuilder<unknown>[] = [scopeSql(scope)];

  const hasCall = b.call_from !== undefined || b.call_to !== undefined;
  const hasSynced = b.synced_from !== undefined || b.synced_to !== undefined;
  if (hasCall && (b.call_from === undefined || b.call_to === undefined)) throw new ApiError('Send both call_from and call_to.');
  if (hasSynced && (b.synced_from === undefined || b.synced_to === undefined))
    throw new ApiError('Send both synced_from and synced_to.');
  let from: Date;
  let to: Date;
  if (hasCall || hasSynced) {
    const [f, t] = hasCall ? [b.call_from!, b.call_to!] : [b.synced_from!, b.synced_to!];
    if (f >= t) throw new ApiError(`${hasCall ? 'call_from' : 'synced_from'} must be less than ${hasCall ? 'call_to' : 'synced_to'}.`);
    from = new Date(f * 1000);
    // Unix seconds are inclusive (23:59:59 covers that whole second).
    to = new Date((t + 1) * 1000);
  } else {
    from = startOfIstDay(now);
    to = new Date(from.getTime() + 86_400_000);
  }
  if (to.getTime() - from.getTime() > MAX_RANGE_DAYS * 86_400_000 + 1000)
    throw new ApiError(`The date range can be at most ${MAX_RANGE_DAYS} days.`);
  const column = hasSynced && !hasCall ? sql`c.synced_at` : sql`c.started_at`;
  parts.push(sql`${column} >= ${from}`, sql`${column} < ${to}`);
  if (hasCall && hasSynced) parts.push(sql`c.synced_at >= ${new Date(b.synced_from! * 1000)}`, sql`c.synced_at < ${new Date((b.synced_to! + 1) * 1000)}`);

  if (b.call_types?.length) {
    const types = b.call_types.map((t) => t.trim().toLowerCase());
    if (types.some((t) => !(TYPES as readonly string[]).includes(t)))
      throw new ApiError('Invalid call_types. Valid call types are Incoming or Outgoing or Missed or Rejected.');
    parts.push(sql`c.type in (${sql.join(types)})`);
  }
  // Callyzer's bounds are exclusive.
  if (b.duration_les_than !== undefined) parts.push(sql`c.talk_seconds < ${b.duration_les_than}`);
  if (b.duration_grt_than !== undefined) parts.push(sql`c.talk_seconds > ${b.duration_grt_than}`);
  if (b.ringing_time_les_than !== undefined) parts.push(sql`coalesce(c.ring_seconds, 0) < ${b.ringing_time_les_than}`);
  if (b.ringing_time_grt_than !== undefined) parts.push(sql`coalesce(c.ring_seconds, 0) > ${b.ringing_time_grt_than}`);

  if (b.emp_numbers?.length) {
    const numbers = toNumbers(b.emp_numbers);
    const found = (
      await sql<{ company_number: string }>`
        select company_number from employees where company_id = ${scope.companyId} and company_number in (${sql.join(numbers.length ? numbers : [''])})
      `.execute(db)
    ).rows.map((r) => r.company_number);
    const missing = b.emp_numbers.filter((n) => !found.includes(normalizeNumber(n).number));
    if (missing.length) throw new ApiError(`emp_numbers not found: ${missing.join(', ')}.`);
    parts.push(sql`c.employee_id in (select id from employees where company_id = ${scope.companyId} and company_number in (${sql.join(found)}))`);
  }
  if (b.emp_tags?.length) {
    const found = (
      await sql<{ name: string }>`select name from teams where company_id = ${scope.companyId} and name in (${sql.join(b.emp_tags)})`.execute(db)
    ).rows.map((r) => r.name.toLowerCase());
    const missing = b.emp_tags.filter((t) => !found.includes(t.toLowerCase()));
    if (missing.length) throw new ApiError(`emp_tags not found: ${missing.join(', ')}.`);
    parts.push(sql`c.employee_id in (
      select tm.employee_id from team_members tm join teams t on t.id = tm.team_id and t.company_id = tm.company_id
      where tm.company_id = ${scope.companyId} and t.name in (${sql.join(b.emp_tags)}))`);
  }
  if (b.client_numbers?.length) {
    const numbers = toNumbers(b.client_numbers);
    parts.push(numbers.length ? sql`c.number in (${sql.join(numbers)})` : sql`1 = 0`);
  }
  // Excluded numbers are left out unless asked for, as in Callyzer (default true) and our reports.
  if (b.is_exclude_numbers !== false)
    parts.push(sql`not exists (select 1 from excluded_numbers ex where ex.company_id = c.company_id and ex.number = c.number)`);
  // Our app tracks phone calls only, all of them voice.
  if (b.call_method !== undefined) {
    if (b.call_method === 'WhatsAppCall') parts.push(sql`1 = 0`);
    else if (b.call_method !== 'PhoneCall') throw new ApiError('Invalid call_method. Valid values are PhoneCall or WhatsAppCall.');
  }
  if (b.call_mode !== undefined) {
    if (b.call_mode === 'Video') parts.push(sql`1 = 0`);
    else if (b.call_mode !== 'Voice') throw new ApiError('Invalid call_mode. Valid values are Voice or Video.');
  }
  const byCallDate = !(hasSynced && !hasCall);
  return { where: sql.join(parts, sql` and `), from, to, periodEnd: byCallDate ? to : now, byCallDate, pageNo, pageSize, body: b };
}

// ---------- report definitions (HLD section 6) as SQL on `calls c` ----------

const CONNECTED = sql`c.type in ('incoming', 'outgoing') and c.talk_seconds > 0`;
const noConnectedAfter = (periodEnd: Date) => sql`not exists (
  select 1 from calls c2
  where c2.company_id = c.company_id and c2.number = c.number and c2.type in ('incoming', 'outgoing') and c2.talk_seconds > 0
    and c2.started_at > c.started_at and c2.started_at < ${periodEnd})`;
/** A missed or rejected call from a number that got no connected call after it in the period. */
const neverAttended = (f: Filter) => sql`(c.type in ('missed', 'rejected') and c.number_kind <> 'private' and ${noConnectedAfter(f.periodEnd)})`;
/** An outgoing call nobody answered, to a number with no connected call after it in the period. */
const notPickedUp = (f: Filter) => sql`(c.type = 'outgoing' and c.talk_seconds = 0 and c.number_kind <> 'private' and ${noConnectedAfter(f.periodEnd)})`;

const aggregates = (f: Filter) => sql`
  count(*) as total_calls,
  coalesce(sum(c.type = 'incoming'), 0) as total_incoming_calls,
  coalesce(sum(if(c.type = 'incoming', c.talk_seconds, 0)), 0) as total_incoming_duration,
  coalesce(sum(c.type = 'incoming' and c.talk_seconds > 0), 0) as total_incoming_connected_calls,
  coalesce(sum(c.type = 'outgoing'), 0) as total_outgoing_calls,
  coalesce(sum(if(c.type = 'outgoing', c.talk_seconds, 0)), 0) as total_outgoing_duration,
  coalesce(sum(c.type = 'outgoing' and c.talk_seconds > 0), 0) as total_outgoing_connected_calls,
  coalesce(sum(c.type = 'missed'), 0) as total_missed_calls,
  coalesce(sum(c.type = 'rejected'), 0) as total_rejected_calls,
  coalesce(sum(c.talk_seconds), 0) as total_duration,
  coalesce(sum(${CONNECTED}), 0) as total_connected_calls,
  coalesce(sum(${neverAttended(f)}), 0) as total_never_attended_calls,
  coalesce(sum(${notPickedUp(f)}), 0) as total_not_pickup_by_clients_calls,
  count(distinct if(c.number_kind <> 'private', c.number, null)) as total_unique_clients
`;
interface Agg {
  total_calls: number;
  total_incoming_calls: number;
  total_incoming_duration: number;
  total_incoming_connected_calls: number;
  total_outgoing_calls: number;
  total_outgoing_duration: number;
  total_outgoing_connected_calls: number;
  total_missed_calls: number;
  total_rejected_calls: number;
  total_duration: number;
  total_connected_calls: number;
  total_never_attended_calls: number;
  total_not_pickup_by_clients_calls: number;
  total_unique_clients: number;
}
const AGG_KEYS: (keyof Agg)[] = [
  'total_calls', 'total_incoming_calls', 'total_incoming_duration', 'total_incoming_connected_calls', 'total_outgoing_calls',
  'total_outgoing_duration', 'total_outgoing_connected_calls', 'total_missed_calls', 'total_rejected_calls', 'total_duration',
  'total_connected_calls', 'total_never_attended_calls', 'total_not_pickup_by_clients_calls', 'total_unique_clients',
];
const numbers = (row: Partial<Record<keyof Agg, unknown>>): Agg =>
  Object.fromEntries(AGG_KEYS.map((k) => [k, Number(row[k] ?? 0)])) as unknown as Agg;

/** Active time per employee per India day: first call's start to last call's end; idle is that minus time in calls. */
async function activeTime(db: Kysely<Database>, f: Filter) {
  const rows = (
    await sql<{ employee_id: string; day: string; first_at: Date; last_end: Date; busy: number }>`
      select c.employee_id, date(c.started_at + interval 330 minute) as day, min(c.started_at) as first_at,
             max(greatest(coalesce(c.ended_at, c.started_at),
                          c.started_at + interval (c.talk_seconds + coalesce(c.ring_seconds, 0)) second)) as last_end,
             sum(c.talk_seconds + coalesce(c.ring_seconds, 0)) as busy
      from calls c where ${f.where}
      group by c.employee_id, day
    `.execute(db)
  ).rows;
  const byEmployee = new Map<string, { working: number; idle: number; days: number }>();
  for (const r of rows) {
    const working = Math.max(0, Math.round((r.last_end.getTime() - r.first_at.getTime()) / 1000));
    const idle = Math.max(0, working - Number(r.busy));
    const e = byEmployee.get(r.employee_id) ?? { working: 0, idle: 0, days: 0 };
    byEmployee.set(r.employee_id, { working: e.working + working, idle: e.idle + idle, days: e.days + 1 });
  }
  return byEmployee;
}

// ---------- response ----------

/** "27:03:09": hours can pass 24 over a long range. */
export const hms = (seconds: number) => {
  const s = Math.max(0, Math.round(seconds));
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
};
const ist = (d: Date) => new Date(d.getTime() + IST_MS).toISOString();
export const istDate = (d: Date) => ist(d).slice(0, 10);
export const istTime = (d: Date) => ist(d).slice(11, 19);
export const istDateTime = (d: Date) => `${istDate(d)} ${istTime(d)} IST`;
/** Callyzer splits the country code from the number: "919812345678" → ["91", "9812345678"]. */
export function splitNumber(n: string): [string, string] {
  return /^91\d{10}$/.test(n) ? ['91', n.slice(2)] : ['', n];
}
const capital = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

interface CallRecordRow {
  id: number;
  employee_id: string;
  emp_name: string;
  emp_code: string | null;
  emp_number: string;
  number: string;
  number_kind: string;
  contact_name: string | null;
  type: string;
  started_at: Date;
  talk_seconds: number;
  ring_seconds: number | null;
  note: string | null;
  outcome: string | null;
  follow_up_at: Date | null;
  synced_at: Date;
  modified_at: Date;
  rec_status: string | null;
  object_key: string | null;
  uploaded_at: Date | null;
}

const RECORD_SELECT = sql`
  select c.id, c.employee_id, e.name as emp_name, e.emp_code, e.company_number as emp_number, c.number, c.number_kind,
         c.contact_name, c.type, c.started_at, c.talk_seconds, c.ring_seconds, c.note, o.label as outcome, c.follow_up_at,
         c.synced_at, greatest(c.updated_at, coalesce(c.commented_at, c.updated_at)) as modified_at,
         rec.status as rec_status, rec.object_key, rec.uploaded_at
  from calls c
  join employees e on e.id = c.employee_id and e.company_id = c.company_id
  left join call_outcomes o on o.id = c.outcome_id and o.company_id = c.company_id
  left join recordings rec on rec.call_id = c.id and rec.company_id = c.company_id
`;

type Tags = Map<string, string[]>;
async function teamTags(db: Kysely<Database>, companyId: number): Promise<Tags> {
  const rows = (
    await sql<{ employee_id: string; name: string }>`
      select tm.employee_id, t.name from team_members tm join teams t on t.id = tm.team_id and t.company_id = tm.company_id
      where tm.company_id = ${companyId} order by t.name
    `.execute(db)
  ).rows;
  const tags: Tags = new Map();
  for (const r of rows) tags.set(r.employee_id, [...(tags.get(r.employee_id) ?? []), r.name]);
  return tags;
}

const employeeFields = (r: { employee_id: string; emp_name: string; emp_code: string | null; emp_number: string }, tags: Tags) => {
  const [cc, n] = splitNumber(r.emp_number);
  return { emp_name: r.emp_name, emp_code: r.emp_code ?? '', emp_country_code: cc, emp_number: n, emp_tags: tags.get(r.employee_id) ?? [] };
};

type Recorder = (r: CallRecordRow) => Promise<string | null>;
function recorder(store: RecordingStore | null, now: Date): Recorder {
  return async (r) => {
    if (!store || r.rec_status !== 'uploaded' || !r.object_key) return null;
    if (r.uploaded_at && now.getTime() - r.uploaded_at.getTime() > RECORDING_RETENTION_DAYS * 86_400_000) return null;
    return store.playUrl(r.object_key, API_RECORDING_LINK_SECONDS);
  };
}

/** One call, with Callyzer's field names. */
async function callFields(r: CallRecordRow, recordingUrl: Recorder) {
  const [cc, n] = splitNumber(r.number);
  return {
    id: String(r.id),
    client_name: r.contact_name ?? (r.number_kind === 'private' ? 'Private number' : ''),
    client_country_code: cc,
    client_number: n,
    duration: r.talk_seconds,
    call_type: capital(r.type),
    call_date: istDate(r.started_at),
    call_time: istTime(r.started_at),
    note: r.note ?? '',
    call_recording_url: await recordingUrl(r),
    crm_status: r.outcome ?? '',
    reminder_date: r.follow_up_at ? istDate(r.follow_up_at) : '',
    reminder_time: r.follow_up_at ? istTime(r.follow_up_at) : '',
    synced_at: istDateTime(r.synced_at),
    modified_at: istDateTime(r.modified_at),
    lead_id: '',
    call_method: 'PhoneCall',
    call_mode: 'Voice',
    ringing_time: r.ring_seconds ?? 0,
  };
}
/** A call inside a client group: the client is already named on the group. */
function withoutClient<T extends { client_name: unknown; client_country_code: unknown; client_number: unknown }>(call: T) {
  const rest: Partial<T> = { ...call };
  delete rest.client_name;
  delete rest.client_country_code;
  delete rest.client_number;
  return rest as Omit<T, 'client_name' | 'client_country_code' | 'client_number'>;
}
const fullRecord = async (r: CallRecordRow, tags: Tags, rec: Recorder) => {
  const call = await callFields(r, rec);
  const { id, ...rest } = call;
  return { id, ...employeeFields(r, tags), ...rest };
};

const ok = (reply: FastifyReply, result: unknown, extra: Record<string, unknown> = {}) =>
  reply.code(200).send({ result, message: 'Success', ...extra });

// ---------- routes ----------

export function registerCallyzerRoutes(
  app: FastifyInstance,
  deps: { db: Kysely<Database>; now: () => Date; store: RecordingStore | null },
) {
  const { db, now, store } = deps;
  const P = CRM_API_PREFIX;

  /** Every route answers Callyzer's `{ result, message }`; a bad request is 400 with `result: null`. */
  const route = (method: 'GET' | 'POST', path: string, handler: (req: { body: unknown; query: unknown; scope: Scope }, reply: FastifyReply) => Promise<unknown>) => {
    app.route({
      method,
      url: P + path,
      handler: async (req, reply) => {
        try {
          return await handler({ body: method === 'GET' ? req.query : req.body, query: req.query, scope: req.scope! }, reply);
        } catch (err) {
          if (err instanceof ApiError) return reply.code(400).send({ result: null, message: err.message });
          throw err;
        }
      },
    });
  };

  const latestPer = async (f: Filter, partition: 'employee_id' | 'number', keys: string[]) => {
    if (!keys.length) return new Map<string, CallRecordRow>();
    const rows = (
      await sql<CallRecordRow>`
        select * from (
          select q.*, row_number() over (partition by ${sql.ref(`q.${partition}`)} order by q.started_at desc, q.id desc) as rn
          from (${RECORD_SELECT} where ${f.where} and ${sql.ref(`c.${partition}`)} in (${sql.join(keys)})) q
        ) y where y.rn = 1
      `.execute(db)
    ).rows;
    return new Map(rows.map((r) => [partition === 'employee_id' ? r.employee_id : r.number, r]));
  };

  route('POST', 'call-log/summary', async ({ body, scope }, reply) => {
    const f = await buildFilter(db, scope, body, now());
    const agg = numbers((await sql<Agg>`select ${aggregates(f)} from calls c where ${f.where}`.execute(db)).rows[0] ?? {});
    let working = 0;
    let idle = 0;
    for (const t of (await activeTime(db, f)).values()) {
      working += t.working;
      idle += t.idle;
    }
    return ok(reply, {
      total_incoming_calls: agg.total_incoming_calls,
      total_incoming_duration: agg.total_incoming_duration,
      total_outgoing_calls: agg.total_outgoing_calls,
      total_outgoing_duration: agg.total_outgoing_duration,
      total_missed_calls: agg.total_missed_calls,
      total_rejected_calls: agg.total_rejected_calls,
      total_calls: agg.total_calls,
      total_duration: agg.total_duration,
      total_never_attended_calls: agg.total_never_attended_calls,
      total_not_pickup_by_clients_calls: agg.total_not_pickup_by_clients_calls,
      total_unique_clients: agg.total_unique_clients,
      total_working_hours: hms(working),
      total_idle_time: hms(idle),
      total_connected_calls: agg.total_connected_calls,
    });
  });

  /** Per-employee totals for every active employee the filter names (or all), most calls first. */
  async function employeeTotals(f: Filter, scope: Scope) {
    const b = f.body;
    const empNumbers = toNumbers(b.emp_numbers);
    const employees = (
      await sql<{ employee_id: string; emp_name: string; emp_code: string | null; emp_number: string }>`
        select e.id as employee_id, e.name as emp_name, e.emp_code, e.company_number as emp_number
        from employees e
        where e.company_id = ${scope.companyId} and e.status = 'active'
          ${empNumbers.length ? sql`and e.company_number in (${sql.join(empNumbers)})` : sql``}
          ${b.emp_tags?.length ? sql`and e.id in (select tm.employee_id from team_members tm join teams t on t.id = tm.team_id and t.company_id = tm.company_id where tm.company_id = ${scope.companyId} and t.name in (${sql.join(b.emp_tags)}))` : sql``}
      `.execute(db)
    ).rows;
    const aggRows = (
      await sql<Agg & { employee_id: string }>`
        select c.employee_id, ${aggregates(f)} from calls c where ${f.where} group by c.employee_id
      `.execute(db)
    ).rows;
    const byId = new Map(aggRows.map((r) => [r.employee_id, numbers(r)]));
    // An employee who has left but made calls in the period is still counted.
    const known = new Set(employees.map((e) => e.employee_id));
    const leftIds = [...byId.keys()].filter((id) => !known.has(id));
    if (leftIds.length) {
      employees.push(
        ...(
          await sql<{ employee_id: string; emp_name: string; emp_code: string | null; emp_number: string }>`
            select id as employee_id, name as emp_name, emp_code, company_number as emp_number
            from employees where company_id = ${scope.companyId} and id in (${sql.join(leftIds)})
          `.execute(db)
        ).rows,
      );
    }
    const time = await activeTime(db, f);
    return employees
      .map((e) => ({ ...e, agg: byId.get(e.employee_id) ?? numbers({}), time: time.get(e.employee_id) ?? { working: 0, idle: 0, days: 0 } }))
      .sort((a, b2) => b2.agg.total_calls - a.agg.total_calls || a.emp_name.localeCompare(b2.emp_name));
  }

  route('POST', 'call-log/employee-summary', async ({ body, scope }, reply) => {
    const f = await buildFilter(db, scope, body, now());
    const all = await employeeTotals(f, scope);
    const slice = all.slice((f.pageNo - 1) * f.pageSize, f.pageNo * f.pageSize);
    const tags = await teamTags(db, scope.companyId);
    const rec = recorder(store, now());
    const last = await latestPer(f, 'employee_id', slice.map((e) => e.employee_id));
    const employees = await Promise.all(
      slice.map(async (e) => {
        const a = e.agg;
        const lastRow = last.get(e.employee_id);
        return {
          ...employeeFields(e, tags),
          ...a,
          total_working_hours: hms(e.time.working),
          total_idle_time: hms(e.time.idle),
          last_call_log: lastRow ? await callFields(lastRow, rec) : null,
          avg_duration_per_call: hms(a.total_calls ? a.total_duration / a.total_calls : 0),
          avg_incoming_duration: hms(a.total_incoming_calls ? a.total_incoming_duration / a.total_incoming_calls : 0),
          avg_outgoing_duration: hms(a.total_outgoing_calls ? a.total_outgoing_duration / a.total_outgoing_calls : 0),
        };
      }),
    );
    return ok(reply, { employees }, { total_records: all.length, page_no: f.pageNo, page_size: f.pageSize });
  });

  route('POST', 'call-log/analysis', async ({ body, scope }, reply) => {
    const f = await buildFilter(db, scope, body, now());
    const all = (await employeeTotals(f, scope)).filter((e) => e.agg.total_calls > 0);
    const tags = await teamTags(db, scope.companyId);
    const sum = (k: keyof Agg) => all.reduce((s, e) => s + e.agg[k], 0);
    const top = (score: (e: (typeof all)[number]) => number) =>
      all.length ? all.reduce((best, e) => (score(e) > score(best) ? e : best)) : null;
    const days = new Set(
      (await sql<{ day: string }>`select distinct date(c.started_at + interval 330 minute) as day from calls c where ${f.where}`.execute(db)).rows.map((r) => String(r.day)),
    ).size;
    const totalCalls = sum('total_calls');
    const totalDuration = sum('total_duration');
    const employeeDays = all.reduce((s, e) => s + e.time.days, 0);
    const dialer = top((e) => e.agg.total_outgoing_calls);
    const answered = top((e) => e.agg.total_incoming_connected_calls);
    const caller = top((e) => e.agg.total_calls);
    const talker = top((e) => e.agg.total_duration);
    const longest = (await sql<CallRecordRow>`${RECORD_SELECT} where ${f.where} order by c.talk_seconds desc, c.started_at desc limit 1`.execute(db)).rows[0];
    return ok(reply, {
      average_duration: {
        total_duration: totalDuration,
        per_call: Math.round(totalCalls ? totalDuration / totalCalls : 0),
        total_calls: totalCalls,
        per_day: Math.round(days ? totalDuration / days : 0),
        total_days: days,
        per_incoming_call: Math.round(sum('total_incoming_calls') ? sum('total_incoming_duration') / sum('total_incoming_calls') : 0),
        total_incoming_calls: sum('total_incoming_calls'),
        per_outgoing_call: Math.round(sum('total_outgoing_calls') ? sum('total_outgoing_duration') / sum('total_outgoing_calls') : 0),
        total_outgoing_calls: sum('total_outgoing_calls'),
      },
      time_analysis: {
        average_working_time: hms(employeeDays ? all.reduce((s, e) => s + e.time.working, 0) / employeeDays : 0),
        average_idle_time: hms(employeeDays ? all.reduce((s, e) => s + e.time.idle, 0) / employeeDays : 0),
      },
      top_dialer: dialer ? { ...employeeFields(dialer, tags), total_outgoing_calls: dialer.agg.total_outgoing_calls } : null,
      top_answered: answered ? { ...employeeFields(answered, tags), total_incoming_calls: answered.agg.total_incoming_connected_calls } : null,
      top_caller: caller ? { ...employeeFields(caller, tags), total_calls: caller.agg.total_calls } : null,
      highest_total_duration: talker
        ? {
            ...employeeFields(talker, tags),
            total_calls: talker.agg.total_calls,
            total_duration: talker.agg.total_duration,
            total_incoming_duration: talker.agg.total_incoming_duration,
            total_outgoing_duration: talker.agg.total_outgoing_duration,
          }
        : null,
      longest_duration: longest ? { ...employeeFields(longest, tags), call_log: await callFields(longest, recorder(store, now())) } : null,
    });
  });

  /** Calls grouped by employee and client, groups paged, newest group first. */
  const grouped = (kind: 'never' | 'notPicked') => async ({ body, scope }: { body: unknown; scope: Scope }, reply: FastifyReply) => {
    const f = await buildFilter(db, scope, body, now());
    const cond = kind === 'never' ? neverAttended(f) : notPickedUp(f);
    const groups = (
      await sql<{ employee_id: string; number: string; total: number }>`
        select c.employee_id, c.number, count(*) as total from calls c where ${f.where} and ${cond}
        group by c.employee_id, c.number order by max(c.started_at) desc, c.number
      `.execute(db)
    ).rows;
    const slice = groups.slice((f.pageNo - 1) * f.pageSize, f.pageNo * f.pageSize);
    const tags = await teamTags(db, scope.companyId);
    const rec = recorder(store, now());
    const rows = slice.length
      ? (
          await sql<CallRecordRow>`
            ${RECORD_SELECT} where ${f.where} and ${cond}
              and (c.employee_id, c.number) in (${sql.join(slice.map((g) => sql`(${g.employee_id}, ${g.number})`))})
            order by c.started_at desc, c.id desc
          `.execute(db)
        ).rows
      : [];
    const result = await Promise.all(
      slice.map(async (g) => {
        const calls = rows.filter((r) => r.employee_id === g.employee_id && r.number === g.number);
        const first = calls[0]!;
        const [cc, n] = splitNumber(g.number);
        return {
          ...employeeFields(first, tags),
          client_name: calls.find((c) => c.contact_name)?.contact_name ?? '',
          client_country_code: cc,
          client_number: n,
          call_logs: await Promise.all(
            calls.map(async (c) => {
              return withoutClient(await callFields(c, rec));
            }),
          ),
        };
      }),
    );
    return ok(reply, result, { total_records: groups.length, page_no: f.pageNo, page_size: f.pageSize });
  };
  route('POST', 'call-log/never-attended', grouped('never'));
  route('POST', 'call-log/not-pickup-by-client', grouped('notPicked'));

  route('POST', 'call-log/unique-clients', async ({ body, scope }, reply) => {
    const f = await buildFilter(db, scope, body, now());
    const where = sql`${f.where} and c.number_kind <> 'private'`;
    const total = Number((await sql<{ n: number }>`select count(distinct c.number) as n from calls c where ${where}`.execute(db)).rows[0]!.n);
    const rows = (
      await sql<Agg & { number: string; contact_name: string | null }>`
        select c.number, max(c.contact_name) as contact_name, ${aggregates(f)}
        from calls c where ${where}
        group by c.number order by max(c.started_at) desc, c.number
        limit ${f.pageSize} offset ${(f.pageNo - 1) * f.pageSize}
      `.execute(db)
    ).rows;
    const tags = await teamTags(db, scope.companyId);
    const rec = recorder(store, now());
    const last = await latestPer({ ...f, where }, 'number', rows.map((r) => r.number));
    const result = await Promise.all(
      rows.map(async (r) => {
        const [cc, n] = splitNumber(r.number);
        const a = numbers(r);
        const lastRow = last.get(r.number);
        let lastCall = null;
        if (lastRow) {
          const { id, ...rest } = withoutClient(await callFields(lastRow, rec));
          lastCall = { id, ...employeeFields(lastRow, tags), ...rest };
        }
        return {
          client_name: r.contact_name ?? '',
          client_country_code: cc,
          client_number: n,
          total_calls: a.total_calls,
          total_duration: a.total_duration,
          total_incoming_calls: a.total_incoming_calls,
          total_incoming_duration: a.total_incoming_duration,
          total_outgoing_calls: a.total_outgoing_calls,
          total_outgoing_duration: a.total_outgoing_duration,
          total_missed_calls: a.total_missed_calls,
          total_rejected_calls: a.total_rejected_calls,
          total_connected_calls: a.total_connected_calls,
          total_never_attended_calls: a.total_never_attended_calls,
          total_not_pickup_by_clients_calls: a.total_not_pickup_by_clients_calls,
          last_call_log: lastCall,
        };
      }),
    );
    return ok(reply, result, { total_records: total, page_no: f.pageNo, page_size: f.pageSize });
  });

  /** Working hours as whole hours: "09:30" counts from 09:00. Absent means the whole day (no office hours, HLD 6). */
  const hourOf = (v: string | undefined, field: string, fallback: number) => {
    if (v === undefined) return fallback;
    const m = /^([01]\d|2[0-4]):([0-5]\d)$/.exec(v);
    if (!m) throw new ApiError(`Invalid ${field}. Use HH:mm, 24-hour.`);
    return Number(m[1]);
  };
  const clock12 = (h: number) => `${String(h % 12 === 0 ? 12 : h % 12).padStart(2, '0')}:00 ${h < 12 || h === 24 ? 'AM' : 'PM'}`;
  function slots(b: Body) {
    const fromH = hourOf(b.working_hour_from, 'working_hour_from', 0);
    const toH = hourOf(b.working_hour_to, 'working_hour_to', 24);
    if (fromH >= toH) throw new ApiError('working_hour_from must be before working_hour_to.');
    const list: { label: string; hours: number[] }[] = [];
    if (fromH > 0) list.push({ label: `Before ${clock12(fromH)}`, hours: [...Array(fromH).keys()] });
    for (let h = fromH; h < toH; h++) list.push({ label: `${clock12(h)} - ${clock12(h).replace(':00', ':59')}`, hours: [h] });
    if (toH < 24) list.push({ label: `After ${clock12(toH)}`, hours: [...Array(24 - toH).keys()].map((i) => toH + i) });
    return list;
  }
  const perc = (part: number, whole: number) => (whole ? Math.round((part / whole) * 10_000) / 100 : 0);
  /** India dates in the filter's range. */
  const datesIn = (f: Filter) => {
    const out: Date[] = [];
    for (let d = startOfIstDay(f.from); d < f.to; d = new Date(d.getTime() + 86_400_000)) out.push(d);
    return out;
  };

  route('POST', 'call-log/hourly-analytics', async ({ body, scope }, reply) => {
    const f = await buildFilter(db, scope, body, now());
    const exclude = (f.body.exclude_days ?? []).map((d) => DAY_NAMES.findIndex((n) => n.toLowerCase() === d.slice(0, 3).toLowerCase()));
    if (exclude.includes(-1)) throw new ApiError('Invalid exclude_days. Use Sun, Mon, Tue, Wed, Thu, Fri or Sat.');
    const list = slots(f.body);
    // dayofweek(): 1 is Sunday.
    const rows = (
      await sql<{ h: number; calls: number; connected: number; duration: number }>`
        select hour(c.started_at + interval 330 minute) as h, count(*) as calls, coalesce(sum(${CONNECTED}), 0) as connected,
               coalesce(sum(c.talk_seconds), 0) as duration
        from calls c where ${f.where}
          ${exclude.length ? sql`and dayofweek(c.started_at + interval 330 minute) - 1 not in (${sql.join(exclude)})` : sql``}
        group by h
      `.execute(db)
    ).rows.map((r) => ({ h: Number(r.h), calls: Number(r.calls), connected: Number(r.connected), duration: Number(r.duration) }));
    const totals = rows.reduce((t, r) => ({ calls: t.calls + r.calls, connected: t.connected + r.connected, duration: t.duration + r.duration }), { calls: 0, connected: 0, duration: 0 });
    const days = datesIn(f).filter((d) => !exclude.includes(new Date(d.getTime() + IST_MS).getUTCDay())).length || 1;
    return ok(reply, {
      total_calls: totals.calls,
      total_connected_calls: totals.connected,
      total_duration: totals.duration,
      daily_average: {
        avg_calls: Math.round((totals.calls / days) * 100) / 100,
        avg_connected_calls: Math.round((totals.connected / days) * 100) / 100,
        avg_duration: Math.round(totals.duration / days),
      },
      time_slots: list.map((s) => {
        const inSlot = rows.filter((r) => s.hours.includes(r.h));
        const calls = inSlot.reduce((n, r) => n + r.calls, 0);
        const connected = inSlot.reduce((n, r) => n + r.connected, 0);
        const duration = inSlot.reduce((n, r) => n + r.duration, 0);
        return {
          slot: s.label,
          total_calls: calls,
          total_duration: duration,
          total_connected_calls: connected,
          total_call_perc: perc(calls, totals.calls),
          total_duration_perc: perc(duration, totals.duration),
          total_connected_calls_perc: perc(connected, totals.connected),
        };
      }),
    });
  });

  route('POST', 'call-log/daywise-analytics', async ({ body, scope }, reply) => {
    const f = await buildFilter(db, scope, body, now());
    const list = slots(f.body);
    const rows = (
      await sql<{ day: string; h: number; calls: number; connected: number; duration: number }>`
        select date_format(c.started_at + interval 330 minute, '%Y-%m-%d') as day, hour(c.started_at + interval 330 minute) as h,
               count(*) as calls, coalesce(sum(${CONNECTED}), 0) as connected, coalesce(sum(c.talk_seconds), 0) as duration
        from calls c where ${f.where}
        group by day, h
      `.execute(db)
    ).rows.map((r) => ({ day: String(r.day), h: Number(r.h), calls: Number(r.calls), connected: Number(r.connected), duration: Number(r.duration) }));
    const dates = datesIn(f).map((d) => istDate(d));
    const totals = rows.reduce((t, r) => ({ calls: t.calls + r.calls, connected: t.connected + r.connected, duration: t.duration + r.duration }), { calls: 0, connected: 0, duration: 0 });
    const days = dates.length || 1;
    let emptyDaySlots = 0;
    const time_slots = list.map((s) => {
      const inSlot = rows.filter((r) => s.hours.includes(r.h));
      const slotTotals = inSlot.reduce((t, r) => ({ calls: t.calls + r.calls, connected: t.connected + r.connected, duration: t.duration + r.duration }), { calls: 0, connected: 0, duration: 0 });
      const day_wise = dates.map((date) => {
        const d = inSlot.filter((r) => r.day === date);
        const calls = d.reduce((n, r) => n + r.calls, 0);
        const connected = d.reduce((n, r) => n + r.connected, 0);
        const duration = d.reduce((n, r) => n + r.duration, 0);
        return {
          date,
          day: DAY_NAMES[new Date(`${date}T00:00:00Z`).getUTCDay()],
          total_calls: calls,
          total_duration: duration,
          total_connected_calls: connected,
          total_call_perc: perc(calls, slotTotals.calls),
          total_duration_perc: perc(duration, slotTotals.duration),
          total_connected_calls_perc: perc(connected, slotTotals.connected),
        };
      });
      const empty = day_wise.filter((d) => d.total_calls === 0).length;
      emptyDaySlots += empty;
      return {
        slot: s.label,
        days_with_no_calls_in_time_slot: empty,
        daily_average: {
          avg_calls: Math.round((slotTotals.calls / days) * 100) / 100,
          avg_connected_calls: Math.round((slotTotals.connected / days) * 100) / 100,
          avg_duration: Math.round(slotTotals.duration / days),
        },
        day_wise,
      };
    });
    return ok(reply, {
      total_calls: totals.calls,
      total_connected_calls: totals.connected,
      total_duration: totals.duration,
      total_days_with_no_calls_in_time_slot: emptyDaySlots,
      daily_average: {
        avg_calls: Math.round((totals.calls / days) * 100) / 100,
        avg_connected_calls: Math.round((totals.connected / days) * 100) / 100,
        avg_duration: Math.round(totals.duration / days),
      },
      time_slots,
    });
  });

  route('POST', 'call-log/history', async ({ body, scope }, reply) => {
    const f = await buildFilter(db, scope, body, now());
    const total = Number((await sql<{ n: number }>`select count(*) as n from calls c where ${f.where}`.execute(db)).rows[0]!.n);
    const rows = (
      await sql<CallRecordRow>`
        ${RECORD_SELECT} where ${f.where} order by c.started_at desc, c.id desc
        limit ${f.pageSize} offset ${(f.pageNo - 1) * f.pageSize}
      `.execute(db)
    ).rows;
    const tags = await teamTags(db, scope.companyId);
    const rec = recorder(store, now());
    return ok(reply, await Promise.all(rows.map((r) => fullRecord(r, tags, rec))), {
      total_records: total,
      page_no: f.pageNo,
      page_size: f.pageSize,
    });
  });

  route('POST', 'call-log/get', async ({ body, scope }, reply) => {
    const b = readBody(body);
    const ids = (b.unique_ids ?? []).map((s) => Number(s));
    if (ids.length < 1 || ids.length > MAX_UNIQUE_IDS)
      throw new ApiError('Invalid no of unique ids. Minimum 1 and Maximum 20 ids are allowed.');
    const valid = ids.filter((n) => Number.isSafeInteger(n) && n > 0);
    const rows = valid.length
      ? (await sql<CallRecordRow>`${RECORD_SELECT} where ${scopeSql(scope)} and c.id in (${sql.join(valid)}) order by c.started_at desc, c.id desc`.execute(db)).rows
      : [];
    const tags = await teamTags(db, scope.companyId);
    const rec = recorder(store, now());
    return ok(reply, await Promise.all(rows.map((r) => fullRecord(r, tags, rec))));
  });

  // NDJSON, one `{"result": {...}}` line per call, then `{"type":"END",...}`, as Callyzer's stream.
  app.post(P + 'call-log/history/stream', async (req, reply) => {
    let f: Filter;
    try {
      const b = readBody(req.body);
      if (b.call_from === undefined || b.call_to === undefined) throw new ApiError('Send both call_from and call_to.');
      f = await buildFilter(db, req.scope!, { ...b, page_no: undefined, page_size: undefined }, now());
    } catch (err) {
      if (err instanceof ApiError) return reply.code(400).send({ result: null, message: err.message });
      throw err;
    }
    const tags = await teamTags(db, req.scope!.companyId);
    const rec = recorder(store, now());
    async function* lines() {
      let after: { at: Date; id: number } | null = null;
      let sent = 0;
      while (sent < STREAM_MAX_ROWS) {
        const rows: CallRecordRow[] = (
          await sql<CallRecordRow>`
            ${RECORD_SELECT} where ${f.where} ${after ? sql`and (c.started_at, c.id) < (${after.at}, ${after.id})` : sql``}
            order by c.started_at desc, c.id desc limit 500
          `.execute(db)
        ).rows;
        for (const r of rows) yield JSON.stringify({ result: await fullRecord(r, tags, rec) }) + '\n';
        sent += rows.length;
        if (rows.length < 500) break;
        const lastRow: CallRecordRow = rows[rows.length - 1]!;
        after = { at: lastRow.started_at, id: lastRow.id };
      }
      yield JSON.stringify({ type: 'END', total_records: sent, message: 'Success' }) + '\n';
    }
    return reply.code(200).header('content-type', 'application/x-ndjson').send(Readable.from(lines()));
  });

  /** Callyzer documents this as GET; a CRM may send its filters as a query or a body, so both are answered. */
  const employees = async ({ body, scope }: { body: unknown; scope: Scope }, reply: FastifyReply) => {
    const b = readBody(body);
    const { pageNo, pageSize } = page(b);
    const empNumbers = toNumbers(b.emp_numbers);
    const where = sql.join(
      [
        sql`e.company_id = ${scope.companyId}`,
        sql`e.status = 'active'`,
        ...(b.emp_numbers?.length ? [empNumbers.length ? sql`e.company_number in (${sql.join(empNumbers)})` : sql`1 = 0`] : []),
        ...(b.emp_codes?.length ? [sql`e.emp_code in (${sql.join(b.emp_codes)})`] : []),
        ...(b.emp_name ? [sql`lower(e.name) = ${b.emp_name.toLowerCase()}`] : []),
        ...(b.emp_tags?.length
          ? [sql`e.id in (select tm.employee_id from team_members tm join teams t on t.id = tm.team_id and t.company_id = tm.company_id where tm.company_id = ${scope.companyId} and t.name in (${sql.join(b.emp_tags)}))`]
          : []),
      ],
      sql` and `,
    );
    const total = Number((await sql<{ n: number }>`select count(*) as n from employees e where ${where}`.execute(db)).rows[0]!.n);
    const rows = (
      await sql<{
        employee_id: string;
        emp_name: string;
        emp_code: string | null;
        emp_number: string;
        created_at: Date;
        brand: string | null;
        model: string | null;
        android_version: string | null;
        sdk_int: number | null;
        app_version: string | null;
        phone_account_id: string | null;
        paired_at: Date | null;
        last_sync_at: Date | null;
        live: number;
        last_call_at: Date | null;
        recording_active: number;
      }>`
        select e.id as employee_id, e.name as emp_name, e.emp_code, e.company_number as emp_number, e.created_at,
               d.brand, d.model, d.android_version, d.sdk_int, d.app_version, d.phone_account_id, d.paired_at, d.last_sync_at,
               d.id is not null as live,
               (select max(c.started_at) from calls c where c.company_id = e.company_id and c.employee_id = e.id) as last_call_at,
               exists (select 1 from recordings r join calls c on c.id = r.call_id and c.company_id = r.company_id
                       where c.company_id = e.company_id and c.employee_id = e.id and r.status = 'uploaded'
                         and r.uploaded_at > ${new Date(now().getTime() - 7 * 86_400_000)}) as recording_active
        from employees e
        left join devices d on d.company_id = e.company_id and d.employee_id = e.id and d.revoked_at is null
        where ${where}
        order by e.name
        limit ${pageSize} offset ${(pageNo - 1) * pageSize}
      `.execute(db)
    ).rows;
    const tags = await teamTags(db, scope.companyId);
    const at = (d: Date | null) => (d ? istDateTime(d) : '');
    return ok(
      reply,
      rows.map((r) => ({
        ...employeeFields(r, tags),
        app_version: r.app_version ?? '',
        registered_at: at(r.paired_at ?? r.created_at),
        modified_at: at(r.paired_at ?? r.created_at),
        last_call_at: at(r.last_call_at),
        last_sync_req_at: at(r.last_sync_at),
        is_lead_active: false,
        is_call_recording_active: Boolean(Number(r.recording_active)),
        device_details: {
          device_model: [r.brand, r.model].filter(Boolean).join(' '),
          version_code: r.app_version ?? '',
          board: '',
          android_version: r.android_version ?? '',
          sdk_version: r.sdk_int !== null ? String(r.sdk_int) : '',
          unique_sim_id: r.phone_account_id ?? '',
        },
        device_preference: { is_app_uninstalled: !Number(r.live), battery_percentage: null },
        app_settings: {
          default_home_screen: 'Call history',
          note_dialog: true,
          call_recording_location: '',
          is_log_active: Boolean(Number(r.live)),
        },
      })),
      { total_records: total, page_no: pageNo, page_size: pageSize },
    );
  };
  route('GET', 'employee/get', employees);
  route('POST', 'employee/get', employees);
}
