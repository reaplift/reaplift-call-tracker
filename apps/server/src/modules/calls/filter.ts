import { sql, type RawBuilder } from 'kysely';
import { z } from 'zod';
import { CALL_TYPES, COMMENT_EXPECTED_TYPES } from '@reaplift/calls-shared';
import { normalizeNumber } from '../../lib/phone.js';
import { startOfIstDay } from '../../lib/time.js';

/** At most 180 days in one filter, as Callyzer allows (data-model-and-api.md, "The call filter"). */
export const MAX_RANGE_DAYS = 180;

const list = <T extends z.ZodTypeAny>(item: T) =>
  z
    .string()
    .optional()
    .transform((v) => (v ? v.split(',').map((s) => s.trim()).filter(Boolean) : []))
    .pipe(z.array(item));
const seconds = z.coerce.number().int().min(0).optional();

const FilterQuery = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  employeeIds: list(z.string().uuid()),
  types: list(z.enum(CALL_TYPES)),
  minTalk: seconds,
  maxTalk: seconds,
  minRing: seconds,
  maxRing: seconds,
  numbers: list(z.string().min(1)),
  /** `no`: placed or answered calls still waiting for the after-call form (M4); `yes`: calls with one. */
  commented: z.enum(['yes', 'no']).optional(),
  /** M6: `yes` calls with a recording, `missing` calls flagged as missing one. */
  recording: z.enum(['yes', 'missing']).optional(),
});

export interface CallFilter {
  from: Date;
  to: Date;
  employeeIds: string[];
  types: string[];
  minTalk?: number;
  maxTalk?: number;
  minRing?: number;
  maxRing?: number;
  numbers: string[];
  commented?: 'yes' | 'no';
  recording?: 'yes' | 'missing';
}

export class FilterError extends Error {
  constructor(
    public code: 'INVALID_REQUEST' | 'RANGE_TOO_LONG',
    message: string,
  ) {
    super(message);
  }
}

/** Reads the call filter from a query string. With no dates it means today, India time. */
export function parseCallFilter(query: unknown, now: Date): CallFilter {
  const parsed = FilterQuery.safeParse(query ?? {});
  if (!parsed.success) throw new FilterError('INVALID_REQUEST', 'Check the filters');
  const q = parsed.data;
  const from = q.from ? new Date(q.from) : startOfIstDay(now);
  const to = q.to ? new Date(q.to) : new Date(startOfIstDay(now).getTime() + 86_400_000);
  if (from >= to) throw new FilterError('INVALID_REQUEST', '"from" must be before "to"');
  if (to.getTime() - from.getTime() > MAX_RANGE_DAYS * 86_400_000)
    throw new FilterError('RANGE_TOO_LONG', `Choose at most ${MAX_RANGE_DAYS} days`);
  return {
    from,
    to,
    employeeIds: q.employeeIds,
    types: q.types,
    minTalk: q.minTalk,
    maxTalk: q.maxTalk,
    minRing: q.minRing,
    maxRing: q.maxRing,
    numbers: q.numbers.map((n) => normalizeNumber(n).number).filter(Boolean),
    commented: q.commented,
    recording: q.recording,
  };
}

/** The filter as SQL conditions on `calls c`, joined with `and`. Bounds are inclusive. Callers add `scopeSql` too. */
export function filterSql(f: CallFilter): RawBuilder<unknown> {
  const parts: RawBuilder<unknown>[] = [sql`c.started_at >= ${f.from}`, sql`c.started_at < ${f.to}`];
  if (f.employeeIds.length) parts.push(sql`c.employee_id in (${sql.join(f.employeeIds)})`);
  if (f.types.length) parts.push(sql`c.type in (${sql.join(f.types)})`);
  if (f.minTalk !== undefined) parts.push(sql`c.talk_seconds >= ${f.minTalk}`);
  if (f.maxTalk !== undefined) parts.push(sql`c.talk_seconds <= ${f.maxTalk}`);
  if (f.minRing !== undefined) parts.push(sql`c.ring_seconds >= ${f.minRing}`);
  if (f.maxRing !== undefined) parts.push(sql`c.ring_seconds <= ${f.maxRing}`);
  if (f.numbers.length) parts.push(sql`c.number in (${sql.join(f.numbers)})`);
  if (f.commented === 'yes') parts.push(sql`c.commented_at is not null`);
  if (f.commented === 'no')
    parts.push(sql`c.commented_at is null and c.type in (${sql.join([...COMMENT_EXPECTED_TYPES])})`);
  if (f.recording === 'yes')
    parts.push(sql`exists (select 1 from recordings r where r.call_id = c.id and r.company_id = c.company_id and r.status = 'uploaded')`);
  if (f.recording === 'missing')
    parts.push(sql`exists (select 1 from recordings r where r.call_id = c.id and r.company_id = c.company_id and r.status = 'missing')`);
  return sql.join(parts, sql` and `);
}
