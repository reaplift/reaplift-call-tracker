import { describe, expect, it } from 'vitest';
import { classifyRoute } from '../src/modules/auth/access.js';
import { logUrl } from '../src/modes/api.js';

describe('classifyRoute', () => {
  it.each([
    ['/healthz', 'public'],
    ['/api/auth/login', 'public'],
    ['/i/:code', 'public'],
    ['/device/v1/pair', 'public'],
    ['/api/auth/me', 'session'],
    ['/api/auth/company', 'session'],
    ['/api/companies', 'super_admin'],
    ['/api/companies/:id', 'super_admin'],
    ['/api/employees', 'admin'],
    ['/device/v1/calls', 'device'],
    ['/something', 'unscoped'],
  ])('%s is %s', (url, kind) => {
    expect(classifyRoute(url)).toBe(kind);
  });
});

describe('logUrl', () => {
  it('keeps pairing codes and query strings out of the log', () => {
    expect(logUrl('/i/482913')).toBe('/i/:code');
    expect(logUrl('/api/calls?numbers=919900011111')).toBe('/api/calls');
  });
});
