const dateTime = new Intl.DateTimeFormat('en-IN', {
  timeZone: 'Asia/Kolkata',
  day: '2-digit',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

/** "12 Nov, 14:02" in India time. */
export const formatDateTime = (iso: string) => dateTime.format(new Date(iso));

/** 185 gives "3m 05s"; 12 gives "12s". */
export function formatSeconds(s: number | null): string {
  if (s === null) return '—';
  if (s < 60) return `${s}s`;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m ${sec}s`;
}

/** 919812345678 gives "+91 98123 45678"; other numbers are shown as stored. */
export function formatNumber(n: string): string {
  return /^91[6-9]\d{9}$/.test(n) ? `+91 ${n.slice(2, 7)} ${n.slice(7)}` : n || 'Private number';
}

/** yyyy-mm-dd of a date in India time, for date inputs. */
export function istDateString(at: Date): string {
  return new Date(at.getTime() + 330 * 60_000).toISOString().slice(0, 10);
}

/** The start of an India-time day as an ISO instant. */
export const istDayStart = (yyyyMmDd: string) => new Date(`${yyyyMmDd}T00:00:00+05:30`).toISOString();

/** Durations on the dashboard, as Callyzer shows them: 5247 gives "1h 27m 27s", 431 gives "0h 7m 11s". */
export function formatDuration(s: number): string {
  const total = Math.max(0, Math.round(s));
  return `${Math.floor(total / 3600)}h ${Math.floor((total % 3600) / 60)}m ${total % 60}s`;
}

/** "12 Nov 2026", or "05 to 11 Nov 2026" for a range, from India dates (yyyy-mm-dd). */
export function formatDayRange(first: string, last: string): string {
  const fmt = (d: string, withYear: boolean) =>
    new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', day: '2-digit', month: 'short', ...(withYear ? { year: 'numeric' } : {}) }).format(new Date(`${d}T00:00:00Z`));
  if (first === last) return fmt(first, true);
  const sameMonth = first.slice(0, 7) === last.slice(0, 7);
  return `${sameMonth ? first.slice(8, 10) : fmt(first, false)} to ${fmt(last, true)}`;
}
