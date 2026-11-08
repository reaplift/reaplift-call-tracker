import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';

const base = { DATABASE_URL: 'postgres://calls:calls@localhost:5433/calls' };

describe('loadConfig', () => {
  it('defaults to the api on port 3100', () => {
    const config = loadConfig({ ...base, PORT: '' }, []);
    expect(config.MODE).toBe('api');
    expect(config.PORT).toBe(3100);
    expect(config.APP_VERSION).toBe('dev');
  });

  it('takes the mode from --mode=', () => {
    expect(loadConfig(base, ['node', 'main.js', '--mode=migrate']).MODE).toBe('migrate');
  });

  it('refuses an unknown mode', () => {
    expect(() => loadConfig({ ...base, MODE: 'receiver' }, [])).toThrow();
  });
});
