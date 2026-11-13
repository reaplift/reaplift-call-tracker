import { z } from 'zod';

/**
 * WhatsApp message templates (M10). A template is fixed text with blanks in double braces, for example
 * "Hi {{name}}, this is {{employee_name}} from {{company_name}}." The app fills the blanks it knows and asks the
 * employee for the rest; the employee can't change the wording. The same rules run in the panel's preview, on the
 * server and in the app (apps/android .../whatsapp/Templates.kt).
 */

/** Blanks the app fills by itself when it can. Any other blank the employee fills. */
export const AUTO_BLANKS = ['name', 'employee_name', 'company_name', 'follow_up_date'] as const;
export type AutoBlank = (typeof AUTO_BLANKS)[number];

/** What each blank is called on screen: "site_name" → "Site name". */
export const BLANK_LABELS: Record<AutoBlank, string> = {
  name: "Client's name",
  employee_name: 'Your name',
  company_name: 'Company name',
  follow_up_date: 'Follow-up date',
};

/** A blank's name: lowercase letters, digits and underscores, starting with a letter, up to 30 characters. */
export const BLANK_NAME = /^[a-z][a-z0-9_]{0,29}$/;
const BLANK = /\{\{\s*([^{}]*?)\s*\}\}/g;

export function blankLabel(name: string): string {
  if ((AUTO_BLANKS as readonly string[]).includes(name)) return BLANK_LABELS[name as AutoBlank];
  const words = name.replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** The blanks in a template, in order of first appearance, each once. */
export function templateBlanks(body: string): string[] {
  const seen: string[] = [];
  for (const m of body.matchAll(BLANK)) {
    const name = m[1]!;
    if (!seen.includes(name)) seen.push(name);
  }
  return seen;
}

/** Blank names that break the rule (for example "{{Client Name}}"), so the panel can say which. */
export function invalidBlanks(body: string): string[] {
  return templateBlanks(body).filter((n) => !BLANK_NAME.test(n));
}

/** The template with every blank replaced. Blanks with no value stay as they are, so a gap is visible. */
export function fillTemplate(body: string, values: Record<string, string | undefined>): string {
  return body.replace(BLANK, (whole, name: string) => {
    const v = values[name]?.trim();
    return v ? v : whole;
  });
}

export const MessageTemplateInput = z
  .object({
    title: z.string().trim().min(1).max(100),
    body: z.string().trim().min(1).max(1000),
    active: z.boolean().optional(),
  })
  .strict();

export const MessageTemplatePatch = MessageTemplateInput.partial().strict();

export interface MessageTemplate {
  id: string;
  title: string;
  body: string;
  active: boolean;
  updatedAt: string;
}

/** One WhatsApp send from the phone's outbox (M10). `openedAt`: when WhatsApp was opened with the text. */
export const MessageSendInput = z
  .object({
    deviceSendId: z.string().min(1).max(64),
    templateId: z.string().uuid().nullable(),
    number: z.string().min(3).max(64),
    deviceCallId: z.string().min(1).max(64).nullable(),
    body: z.string().min(1).max(2000),
    app: z.enum(['whatsapp', 'whatsapp_business']),
    openedAt: z.string().datetime(),
  })
  .strict();

export const MessageSendBatch = z.object({ sends: z.array(MessageSendInput).min(1).max(50) }).strict();

export interface MessageSendBatchResult {
  accepted: number;
  duplicates: number;
  /** Sends the server will never keep (for example the number is on the never-record list); the phone drops them. */
  rejected: Array<{ deviceSendId: string; reason: string }>;
}
