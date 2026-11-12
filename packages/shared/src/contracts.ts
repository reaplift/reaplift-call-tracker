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
  /** The company the phone is now paired to (P1), so the app can show it. */
  company: { name: string };
  settings: DeviceSettings;
}

/** Panel roles (P1, D11): a super admin (ReapLift) picks a company; admins and managers belong to one. */
export const USER_ROLES = ['super_admin', 'admin', 'manager'] as const;
export type UserRole = (typeof USER_ROLES)[number];

export interface SessionUserView {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  /** The user's company; for a super admin, the company picked in the panel, or null before picking one. */
  companyId: number | null;
  companyName: string | null;
}

export interface Company {
  id: number;
  name: string;
  status: 'active' | 'suspended';
  createdAt: string;
}

export const CompanyInput = z
  .object({
    /** The CRM's company number, so both systems name the company the same way. */
    id: z.number().int().positive().max(4_294_967_295),
    name: z.string().trim().min(1).max(200),
  })
  .strict();

export const CompanyPatch = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    status: z.enum(['active', 'suspended']).optional(),
  })
  .strict();

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

/** Call types the after-call form asks about: every call, missed and rejected too (client, 11 November 2026). */
export const COMMENT_EXPECTED_TYPES = CALL_TYPES;

export interface CallOutcome {
  id: string;
  label: string;
  sortOrder: number;
  active: boolean;
}

export const CallOutcomeInput = z
  .object({
    label: z.string().trim().min(1).max(60),
    sortOrder: z.number().int().min(0).max(1000).optional(),
  })
  .strict();

export const CallOutcomePatch = z
  .object({
    label: z.string().trim().min(1).max(60).optional(),
    sortOrder: z.number().int().min(0).max(1000).optional(),
    active: z.boolean().optional(),
  })
  .strict();

/** The after-call form, sent by the phone (PATCH /device/v1/calls/:deviceCallId/comment). */
export const CallComment = z
  .object({
    outcomeId: z.string().uuid().nullable(),
    note: z.string().trim().max(1000).nullable(),
    followUpAt: z.string().datetime({ offset: true }).nullable(),
  })
  .strict()
  .refine((c) => c.outcomeId !== null || (c.note ?? '') !== '', { message: 'Pick an outcome or write a comment' });
export type CallComment = z.infer<typeof CallComment>;

/** GET /device/v1/config: settings, and the company's active outcomes for the after-call form. */
export interface DeviceConfig {
  settings: DeviceSettings;
  outcomes: Array<{ id: string; label: string }>;
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
  /** The after-call form (M4); all null until the employee fills it. */
  outcome: string | null;
  note: string | null;
  followUpAt: string | null;
  commentedAt: string | null;
  /** M6: null when the phone has not reported on this call's recording yet. */
  recording: RecordingStatus | null;
}

export const RECORDING_STATUSES = ['pending_upload', 'uploaded', 'missing'] as const;
export type RecordingStatus = (typeof RECORDING_STATUSES)[number];

/** Recordings longer than this are refused; four hours of phone audio is well under it. */
export const MAX_RECORDING_BYTES = 300 * 1024 * 1024;

/** POST /device/v1/recordings/upload-url (M6). */
export const RecordingUploadRequest = z
  .object({
    deviceCallId: z.string().min(1).max(64),
    sizeBytes: z.number().int().positive().max(MAX_RECORDING_BYTES),
    mimeType: z.string().regex(/^audio\/[a-z0-9.+-]+$/i).max(100),
    audioSeconds: z.number().int().min(0).max(86_400).nullable().optional(),
    /** How sure the phone is that this file is this call's recording, 0 to 100. */
    matchScore: z.number().int().min(0).max(100).nullable().optional(),
  })
  .strict();

export interface RecordingUploadResponse {
  uploadUrl: string;
  expiresAt: string;
  /** Send exactly these headers with the PUT. */
  headers: Record<string, string>;
}

export const RecordingCallRef = z.object({ deviceCallId: z.string().min(1).max(64) }).strict();

export interface RecordingPlayResponse {
  url: string;
  expiresAt: string;
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}
