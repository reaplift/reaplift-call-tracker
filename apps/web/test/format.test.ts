import { describe, expect, it } from 'vitest';
import { formatNumber, formatSeconds, istDateString } from '../src/format';
import { toQuery } from '../src/pages/CallHistory';

describe('format', () => {
  it('shows talk time in minutes and seconds', () => {
    expect(formatSeconds(12)).toBe('12s');
    expect(formatSeconds(185)).toBe('3m 05s');
    expect(formatSeconds(3720)).toBe('1h 02m');
    expect(formatSeconds(null)).toBe('—');
  });

  it('shows Indian mobiles with +91 and spacing', () => {
    expect(formatNumber('919812345678')).toBe('+91 98123 45678');
    expect(formatNumber('04040001000')).toBe('04040001000');
    expect(formatNumber('')).toBe('Private number');
  });

  it('uses the India date, which is ahead of UTC late at night', () => {
    expect(istDateString(new Date('2026-11-09T20:00:00Z'))).toBe('2026-11-10');
  });

  it('sends a day range that includes the whole "to" day', () => {
    const q = toQuery({ fromDay: '2026-11-12', toDay: '2026-11-12', employeeId: '', type: '', minTalk: '', maxTalk: '', minRing: '', maxRing: '', number: '' });
    expect(q.from).toBe('2026-11-11T18:30:00.000Z');
    expect(q.to).toBe('2026-11-12T18:30:00.000Z');
  });
});
