import { z } from 'zod';

export const CALL_TYPES = ['incoming', 'outgoing', 'missed', 'rejected'] as const;
export type CallType = (typeof CALL_TYPES)[number];

/** One call from the phone's call log, company SIM only (POST /device/v1/calls). */
export const DeviceCall = z.object({
  /** The call log's row ID on this phone; with the device it makes the call unique. */
  deviceCallId: z.string().min(1).max(64),
  number: z.string().max(64),
  contactName: z.string().max(200).nullable().optional(),
  type: z.enum(CALL_TYPES),
  startedAt: z.string().datetime(),
  talkSeconds: z.number().int().min(0).max(86_400),
  ringSeconds: z.number().int().min(0).max(86_400).nullable().optional(),
  endedAt: z.string().datetime().nullable().optional(),
});
export type DeviceCall = z.infer<typeof DeviceCall>;

export const DeviceCallBatch = z.object({ calls: z.array(DeviceCall).min(1).max(200) }).strict();

export interface DeviceCallBatchResult {
  accepted: number;
  duplicates: number;
  /** Calls the server will never take (for example too old); the phone drops them from its outbox. */
  rejected: Array<{ deviceCallId: string; reason: string }>;
}

export const PairRequest = z
  .object({
    code: z.string().regex(/^\d{6}$/),
    brand: z.string().max(100),
    model: z.string().max(100),
    androidVersion: z.string().max(20),
    sdkInt: z.number().int(),
    appVersion: z.string().max(40),
    defaultDialer: z.string().max(200).nullable().optional(),
    simSlot: z.number().int().min(0).max(8),
    simCarrier: z.string().max(100).nullable().optional(),
    phoneAccountId: z.string().max(200).nullable().optional(),
    consentVersion: z.string().min(1).max(20),
  })
  .strict();
export type PairRequest = z.infer<typeof PairRequest>;

export interface DeviceSettings {
  /** Days of past company-SIM calls to send right after pairing (decision D3). */
  initialSyncDays: number;
  syncIntervalMinutes: number;
}

export interface PairResponse {
  deviceToken: string;
  employee: { name: string; companyNumber: string };
  settings: DeviceSettings;
}

export interface Employee {
  id: string;
  name: string;
  empCode: string | null;
  companyNumber: string;
  status: 'active' | 'left';
  createdAt: string;
  device: {
    brand: string | null;
    model: string | null;
    androidVersion: string | null;
    appVersion: string | null;
    simSlot: number | null;
    simCarrier: string | null;
    pairedAt: string;
    lastSyncAt: string | null;
  } | null;
}

export const EmployeeInput = z
  .object({
    name: z.string().trim().min(1).max(100),
    empCode: z.string().trim().max(40).nullable().optional(),
    companyNumber: z.string().min(10).max(20),
  })
  .strict();

export const EmployeePatch = EmployeeInput.partial()
  .extend({ status: z.enum(['active', 'left']).optional() })
  .strict();

export interface PairingCodeResponse {
  code: string;
  expiresAt: string;
  installUrl: string;
  /** The install URL as an SVG QR code, ready to show. */
  qrSvg: string;
}

export interface CallRow {
  id: number;
  employeeId: string;
  employeeName: string;
  number: string;
  numberKind: 'mobile' | 'other' | 'private';
  contactName: string | null;
  type: CallType;
  startedAt: string;
  talkSeconds: number;
  ringSeconds: number | null;
  syncedAt: string;
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}
