const IST = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Kolkata',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

/** "09/11/2026, 14:02:00" in India time, for CSV files people open in a spreadsheet. */
export const formatIst = (at: Date) => IST.format(at);

/** Midnight India time at the start of the day that contains `at`. */
export function startOfIstDay(at: Date): Date {
  const shifted = new Date(at.getTime() + 330 * 60_000);
  shifted.setUTCHours(0, 0, 0, 0);
  return new Date(shifted.getTime() - 330 * 60_000);
}
