import { describe, expect, it } from 'vitest';
import { FilterError, parseCallFilter } from '../src/modules/calls/filter.js';

const now = new Date('2026-11-09T10:00:00Z'); // 15:30 in India

describe('parseCallFilter', () => {
  it('means today in India time when no dates are given', () => {
    const f = parseCallFilter({}, now);
    expect(f.from.toISOString()).toBe('2026-11-08T18:30:00.000Z');
    expect(f.to.toISOString()).toBe('2026-11-09T18:30:00.000Z');
  });

  it('reads lists and bounds, and normalises numbers', () => {
    const f = parseCallFilter({ types: 'outgoing,missed', minTalk: '60', numbers: '99000 11111' }, now);
    expect(f.types).toEqual(['outgoing', 'missed']);
    expect(f.minTalk).toBe(60);
    expect(f.numbers).toEqual(['919900011111']);
  });

  it('refuses more than 180 days', () => {
    expect(() =>
      parseCallFilter({ from: '2026-01-01T00:00:00Z', to: '2026-11-01T00:00:00Z' }, now),
    ).toThrow(FilterError);
  });

  it('refuses an unknown call type', () => {
    expect(() => parseCallFilter({ types: 'voicemail' }, now)).toThrow(FilterError);
  });
});
