/** What `MODE` can start. Grows as milestones add modes (worker and scheduler in M2 and M3). */
export const MODES = ['api', 'migrate'] as const;
export type Mode = (typeof MODES)[number];

export interface HealthResponse {
  status: 'ok' | 'error';
  version: string;
  db: 'ok' | 'down';
}

export * from './contracts.js';
