import { sql, type RawBuilder } from 'kysely';
import { z } from 'zod';
import { CALL_TYPES } from '@reaplift/calls-shared';
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
  };
}

/** The filter as SQL conditions on `calls c`, joined with `and`. Bounds are inclusive. */
export function filterSql(f: CallFilter): RawBuilder<unknown> {
  const parts: RawBuilder<unknown>[] = [sql`c.started_at >= ${f.from}`, sql`c.started_at < ${f.to}`];
  if (f.employeeIds.length) parts.push(sql`c.employee_id = any(${f.employeeIds}::uuid[])`);
  if (f.types.length) parts.push(sql`c.type = any(${f.types}::text[])`);
  if (f.minTalk !== undefined) parts.push(sql`c.talk_seconds >= ${f.minTalk}`);
  if (f.maxTalk !== undefined) parts.push(sql`c.talk_seconds <= ${f.maxTalk}`);
  if (f.minRing !== undefined) parts.push(sql`c.ring_seconds >= ${f.minRing}`);
  if (f.maxRing !== undefined) parts.push(sql`c.ring_seconds <= ${f.maxRing}`);
  if (f.numbers.length) parts.push(sql`c.number = any(${f.numbers}::text[])`);
  return sql.join(parts, sql` and `);
}
