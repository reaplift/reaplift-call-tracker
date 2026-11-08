import { describe, expect, it } from 'vitest';
import { classifyRoute } from '../src/modules/auth/access.js';

describe('M2 route rules', () => {
  it('lets managers use call-history and report routes', () => {
    expect(classifyRoute('/api/calls')).toBe('manager');
    expect(classifyRoute('/api/calls/export.csv')).toBe('manager');
    expect(classifyRoute('/api/reports/summary')).toBe('manager');
  });

  it('keeps admin-only team management routes locked to admins', () => {
    expect(classifyRoute('/api/teams')).toBe('admin');
    expect(classifyRoute('/api/excluded-numbers')).toBe('admin');
    expect(classifyRoute('/api/users')).toBe('admin');
  });
});
