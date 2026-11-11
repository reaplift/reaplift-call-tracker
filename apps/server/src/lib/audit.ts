import { sql, type Kysely } from 'kysely';
import type { Database } from './db.js';

export async function audit(
  db: Kysely<Database>,
  entry: {
    /** The company the action belongs to; null for a super admin's own or the system's actions. */
    companyId?: number | null;
    userId?: string | null;
    deviceId?: string | null;
    action: string;
    targetType?: string;
    targetId?: string;
    details?: Record<string, unknown>;
  },
) {
  await sql`
    insert into audit_logs (company_id, user_id, device_id, action, target_type, target_id, details)
    values (${entry.companyId ?? null}, ${entry.userId ?? null}, ${entry.deviceId ?? null}, ${entry.action},
            ${entry.targetType ?? null}, ${entry.targetId ?? null}, ${entry.details ? JSON.stringify(entry.details) : null})
  `.execute(db);
}
