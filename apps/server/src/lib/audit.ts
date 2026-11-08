import { sql, type Kysely } from 'kysely';
import type { Database } from './db.js';

export async function audit(
  db: Kysely<Database>,
  entry: {
    userId?: string | null;
    deviceId?: string | null;
    action: string;
    targetType?: string;
    targetId?: string;
    details?: Record<string, unknown>;
  },
) {
  await sql`
    insert into audit_logs (user_id, device_id, action, target_type, target_id, details)
    values (${entry.userId ?? null}, ${entry.deviceId ?? null}, ${entry.action}, ${entry.targetType ?? null},
            ${entry.targetId ?? null}, ${entry.details ? JSON.stringify(entry.details) : null}::jsonb)
  `.execute(db);
}
