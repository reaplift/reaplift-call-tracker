import { z } from 'zod';
import { MODES } from '@reaplift/calls-shared';

const blankToUndefined = (value: unknown) =>
  typeof value === 'string' && value.trim() === '' ? undefined : value;
const positiveInt = (fallback: number) =>
  z.preprocess(blankToUndefined, z.coerce.number().int().positive().default(fallback));

const Env = z.object({
  MODE: z.enum(MODES).default('api'),
  /** 3100, so reaplift-bsp's server can keep 3000 on the same laptop. */
  PORT: positiveInt(3100),
  LOG_LEVEL: z.string().default('info'),
  DATABASE_URL: z.string().url(),
  APP_VERSION: z
    .string()
    .optional()
    .transform((v) => (v ? v : 'dev')),
  /** The panel's address; state-changing panel requests must come from it. */
  PANEL_ORIGIN: z.preprocess(blankToUndefined, z.string().url().default('http://localhost:5174')),
  /** Secure flag on the session cookie. Blank means on; set `false` only for plain-http local development. */
  SESSION_COOKIE_SECURE: z
    .preprocess(blankToUndefined, z.enum(['true', 'false']).default('true'))
    .transform((v) => v === 'true'),
  /** The address phones reach, which goes into the pairing QR code. Locally, the laptop's Wi-Fi address. */
  PUBLIC_BASE_URL: z.preprocess(blankToUndefined, z.string().url().default('http://localhost:3100')),
  /** Folder holding `latest.apk` for the install page. */
  APK_DIR: z.preprocess(blankToUndefined, z.string().default('./apk')),
  PAIRING_CODE_HOURS: positiveInt(24),
  /** Days of past company-SIM calls a phone sends right after pairing (decision D3). */
  INITIAL_SYNC_DAYS: positiveInt(7),
  /** The built panel (apps/web/dist) to serve from `/`. Blank locally, where Vite serves the panel. */
  PANEL_DIR: z.preprocess(blankToUndefined, z.string().optional()),
});

export type Config = z.infer<typeof Env>;

/** Reads settings from the environment. A `--mode=<mode>` argument overrides MODE. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env, argv = process.argv): Config {
  const modeArg = argv.find((a) => a.startsWith('--mode='))?.slice('--mode='.length);
  return Env.parse({ ...env, ...(modeArg ? { MODE: modeArg } : {}) });
}
