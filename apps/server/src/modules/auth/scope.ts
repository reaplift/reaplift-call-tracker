import { sql, type Kysely, type RawBuilder } from 'kysely';
import type { Database } from '../../lib/db.js';
import type { SessionUser } from './sessions.js';

/**
 * What a panel request may see (D11): always one company, and for a manager only the employees in their teams.
 * Every employee-data query applies it; the access hook works it out once per request.
 */
export interface Scope {
  companyId: number;
  /** null means every employee in the company; a manager gets their team members, possibly none. */
  employeeIds: string[] | null;
}

export type ScopeResult =
  | { ok: true; scope: Scope }
  | { ok: false; status: number; error: string; message: string };

/** Company first, then role. */
export async function resolveScope(db: Kysely<Database>, user: SessionUser): Promise<ScopeResult> {
  const companyId = user.role === 'super_admin' ? user.selectedCompanyId : user.companyId;
  if (companyId === null)
    return { ok: false, status: 400, error: 'COMPANY_REQUIRED', message: 'Pick a company first' };
  const company = (
    await sql<{ status: string }>`select status from companies where id = ${companyId}`.execute(db)
  ).rows[0];
  if (!company) return { ok: false, status: 404, error: 'NOT_FOUND', message: 'Company not found' };
  // A super admin can still look at a suspended company; its own users cannot.
  if (company.status !== 'active' && user.role !== 'super_admin')
    return { ok: false, status: 403, error: 'COMPANY_SUSPENDED', message: 'This company is suspended' };
  if (user.role !== 'manager') return { ok: true, scope: { companyId, employeeIds: null } };
  const rows = await sql<{ employee_id: string }>`
    select distinct tm.employee_id
    from team_members tm join team_managers m on m.team_id = tm.team_id and m.company_id = tm.company_id
    where m.user_id = ${user.userId} and m.company_id = ${companyId}
  `.execute(db);
  return { ok: true, scope: { companyId, employeeIds: rows.rows.map((r) => r.employee_id) } };
}

/**
 * The scope as SQL on a table alias that has company_id and employee_id (calls `c` by default).
 * A manager with no team members sees nothing, never everything.
 */
export function scopeSql(scope: Scope, alias = 'c'): RawBuilder<unknown> {
  const company = sql`${sql.ref(`${alias}.company_id`)} = ${scope.companyId}`;
  if (scope.employeeIds === null) return company;
  if (!scope.employeeIds.length) return sql`${company} and 1 = 0`;
  return sql`${company} and ${sql.ref(`${alias}.employee_id`)} in (${sql.join(scope.employeeIds)})`;
}

/** True when the scope lets the caller see this employee. */
export const canSeeEmployee = (scope: Scope, employeeId: string) =>
  scope.employeeIds === null || scope.employeeIds.includes(employeeId);
