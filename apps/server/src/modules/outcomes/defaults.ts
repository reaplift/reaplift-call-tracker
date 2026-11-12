import { sql, type Kysely } from 'kysely';
import type { Database } from '../../lib/db.js';

/** Every new company starts with these outcomes for the after-call form (M4); its admin can change them. */
export const DEFAULT_OUTCOMES = ['Interested', 'Call back later', 'Not interested', 'No answer / busy', 'Wrong number', 'Other'];

/** Every new company starts with these ready-made notes for the after-call pop-up; its admin can change them. */
export const DEFAULT_NOTE_TEMPLATES = [
  'Not reachable',
  'Asked to call back later',
  'Interested, sending details on WhatsApp',
  'Site visit planned',
  'Not interested',
  'Wrong number',
];

/** Adds the default outcomes and ready-made notes to a company that has none yet. */
export async function seedOutcomes(db: Kysely<Database>, companyId: number): Promise<void> {
  await sql`
    insert ignore into call_outcomes (company_id, label, sort_order)
    values ${sql.join(DEFAULT_OUTCOMES.map((label, i) => sql`(${companyId}, ${label}, ${i + 1})`))}
  `.execute(db);
  await sql`
    insert ignore into note_templates (company_id, text, sort_order)
    values ${sql.join(DEFAULT_NOTE_TEMPLATES.map((text, i) => sql`(${companyId}, ${text}, ${i + 1})`))}
  `.execute(db);
}
