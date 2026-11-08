import { describe, expect, it } from 'vitest';
import { normalizeCompanyNumber, normalizeNumber } from '../src/lib/phone.js';

describe('normalizeNumber', () => {
  it.each([
    ['9812345678', '919812345678', 'mobile'],
    ['+91 98123 45678', '919812345678', 'mobile'],
    ['09812345678', '919812345678', 'mobile'],
    ['919812345678', '919812345678', 'mobile'],
    ['040-4000-1000', '04040001000', 'other'],
    ['18001234567', '18001234567', 'other'],
    ['+14155550100', '14155550100', 'other'],
    ['', '', 'private'],
    ['-2', '', 'private'],
    ['Private', '', 'private'],
  ])('%s gives %s (%s)', (raw, number, kind) => {
    expect(normalizeNumber(raw)).toEqual({ number, kind });
  });
});

describe('normalizeCompanyNumber', () => {
  it('accepts an Indian mobile in any common form', () => {
    expect(normalizeCompanyNumber('98123 45678')).toBe('919812345678');
  });
  it('refuses landlines and short numbers', () => {
    expect(normalizeCompanyNumber('04040001000')).toBeNull();
    expect(normalizeCompanyNumber('12345')).toBeNull();
  });
});
