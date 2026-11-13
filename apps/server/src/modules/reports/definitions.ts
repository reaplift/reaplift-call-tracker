import { sql, type Kysely, type RawBuilder } from 'kysely';
import type { Database } from '../../lib/db.js';

/**
 * The report definitions of HLD section 6, as SQL on `calls c`. One copy, used by the panel's dashboard (M2 task 2.7)
 * and the CRM API (M5), so the two can never disagree.
 */

/** Which calls a report covers: the SQL condition on `calls c` (scope, dates, filters), and where its period ends. */
export interface ReportRange {
  where: RawBuilder<unknown>;
  /** The end of the period for "no connected call after it" (never attended, not picked up). */
  periodEnd: Date;
}


export const CONNECTED = sql`c.type in ('incoming', 'outgoing') and c.talk_seconds > 0`;
export const noConnectedAfter = (periodEnd: Date) => sql`not exists (
  select 1 from calls c2
  where c2.company_id = c.company_id and c2.number = c.number and c2.type in ('incoming', 'outgoing') and c2.talk_seconds > 0
    and c2.started_at > c.started_at and c2.started_at < ${periodEnd})`;
/** A missed or rejected call from a number that got no connected call after it in the period. */
export const neverAttended = (f: ReportRange) => sql`(c.type in ('missed', 'rejected') and c.number_kind <> 'private' and ${noConnectedAfter(f.periodEnd)})`;
/** An outgoing call nobody answered, to a number with no connected call after it in the period. */
export const notPickedUp = (f: ReportRange) => sql`(c.type = 'outgoing' and c.talk_seconds = 0 and c.number_kind <> 'private' and ${noConnectedAfter(f.periodEnd)})`;

export const aggregates = (f: ReportRange) => sql`
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
export interface Agg {
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
export const AGG_KEYS: (keyof Agg)[] = [
  'total_calls', 'total_incoming_calls', 'total_incoming_duration', 'total_incoming_connected_calls', 'total_outgoing_calls',
  'total_outgoing_duration', 'total_outgoing_connected_calls', 'total_missed_calls', 'total_rejected_calls', 'total_duration',
  'total_connected_calls', 'total_never_attended_calls', 'total_not_pickup_by_clients_calls', 'total_unique_clients',
];
export const numbers = (row: Partial<Record<keyof Agg, unknown>>): Agg =>
  Object.fromEntries(AGG_KEYS.map((k) => [k, Number(row[k] ?? 0)])) as unknown as Agg;

/** Active time per employee per India day: first call's start to last call's end; idle is that minus time in calls. */
export async function activeTime(db: Kysely<Database>, f: ReportRange) {
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

/** The summary report: call counts and durations, never attended, not picked up, and active and idle time. */
export async function summarize(db: Kysely<Database>, r: ReportRange): Promise<Agg & { working_seconds: number; idle_seconds: number }> {
  const agg = numbers((await sql<Agg>`select ${aggregates(r)} from calls c where ${r.where}`.execute(db)).rows[0] ?? {});
  let working = 0;
  let idle = 0;
  for (const t of (await activeTime(db, r)).values()) {
    working += t.working;
    idle += t.idle;
  }
  return { ...agg, working_seconds: working, idle_seconds: idle };
}
