import type { FastifyInstance } from 'fastify';
import { sql, type Kysely } from 'kysely';
import type { DashboardPeriod, DashboardResponse } from '@reaplift/calls-shared';
import type { Database } from '../../lib/db.js';
import { startOfIstDay } from '../../lib/time.js';
import { scopeSql, type Scope } from '../auth/scope.js';
import { summarize } from './definitions.js';

const DAY = 86_400_000;
const IST_MS = 330 * 60_000;
const istDay = (d: Date) => new Date(d.getTime() + IST_MS).toISOString().slice(0, 10);

/**
 * The dashboard's four periods (client, 12 November 2026), India time: today so far, yesterday, the 7 full days
 * before today (so it does not overlap today), and this month from the 1st to now.
 */
export function dashboardPeriods(now: Date): Array<{ key: DashboardPeriod['key']; label: string; from: Date; to: Date }> {
  const today = startOfIstDay(now);
  const tomorrow = new Date(today.getTime() + DAY);
  const shifted = new Date(today.getTime() + IST_MS);
  const monthStart = new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), 1) - IST_MS);
  return [
    { key: 'today', label: 'Today', from: today, to: tomorrow },
    { key: 'yesterday', label: 'Yesterday', from: new Date(today.getTime() - DAY), to: today },
    { key: 'last7', label: 'Last 7 days', from: new Date(today.getTime() - 7 * DAY), to: today },
    { key: 'month', label: 'This month', from: monthStart, to: tomorrow },
  ];
}

/** The same calls the CRM API's call-log/summary counts for these dates: the caller's scope, excluded numbers left out. */
const rangeFor = (scope: Scope, from: Date, to: Date) => ({
  where: sql`${scopeSql(scope)} and c.started_at >= ${from} and c.started_at < ${to}
    and not exists (select 1 from excluded_numbers ex where ex.company_id = c.company_id and ex.number = c.number)`,
  periodEnd: to,
});

export function registerDashboardRoutes(app: FastifyInstance, deps: { db: Kysely<Database>; now: () => Date }) {
  const { db, now } = deps;

  app.get('/api/reports/dashboard', async (req, reply) => {
    const scope = req.scope!;
    const periods = await Promise.all(
      dashboardPeriods(now()).map(async (p): Promise<DashboardPeriod> => {
        const s = await summarize(db, rangeFor(scope, p.from, p.to));
        return {
          key: p.key,
          label: p.label,
          firstDay: istDay(p.from),
          lastDay: istDay(new Date(p.to.getTime() - 1)),
          from: p.from.toISOString(),
          to: p.to.toISOString(),
          totalCalls: s.total_calls,
          callSeconds: s.total_duration,
          incomingCalls: s.total_incoming_calls,
          incomingSeconds: s.total_incoming_duration,
          outgoingCalls: s.total_outgoing_calls,
          outgoingSeconds: s.total_outgoing_duration,
          missedCalls: s.total_missed_calls,
          rejectedCalls: s.total_rejected_calls,
          neverAttended: s.total_never_attended_calls,
          notPickedUp: s.total_not_pickup_by_clients_calls,
          uniqueClients: s.total_unique_clients,
          workingSeconds: s.working_seconds,
          connectedCalls: s.total_connected_calls,
        };
      }),
    );
    const body: DashboardResponse = { periods };
    return reply.code(200).send(body);
  });
}
