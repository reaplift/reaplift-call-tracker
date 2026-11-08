export type NumberKind = 'mobile' | 'other' | 'private';

/**
 * Normalises a number as the phone's call log gives it: digits with country code, no plus (CLAUDE.md).
 * Only Indian mobiles are rewritten (10 digits, or with a leading 0, get 91); anything else keeps its digits.
 */
export function normalizeNumber(raw: string): { number: string; kind: NumberKind } {
  const digits = raw.replace(/\D/g, '');
  // Withheld, private and unknown callers come through as empty or as a word ("Private", "-1", "-2").
  if (digits.length < 3 || /^-\d$/.test(raw.trim())) return { number: '', kind: 'private' };
  const mobile = /^[6-9]\d{9}$/;
  if (mobile.test(digits)) return { number: `91${digits}`, kind: 'mobile' };
  if (digits.length === 11 && digits.startsWith('0') && mobile.test(digits.slice(1)))
    return { number: `91${digits.slice(1)}`, kind: 'mobile' };
  if (digits.length === 12 && digits.startsWith('91') && mobile.test(digits.slice(2)))
    return { number: digits, kind: 'mobile' };
  return { number: digits, kind: 'other' };
}

/** A company SIM number typed by an admin: must come out as an Indian mobile. */
export function normalizeCompanyNumber(raw: string): string | null {
  const { number, kind } = normalizeNumber(raw);
  return kind === 'mobile' ? number : null;
}
