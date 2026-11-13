import type { CallOutcome, CallRow, Company, DashboardResponse, Employee, MessageTemplate, NeverRecordNumber, NoteTemplate, Page, PairingCodeResponse, RecordingPlayResponse } from '@reaplift/calls-shared';

export interface User {
  id: string;
  name: string;
  email: string;
  role: 'super_admin' | 'admin' | 'manager';
  companyId: number | null;
  companyName: string | null;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

/** Every call to the server goes through here: cookie included, errors turned into ApiError. */
async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    credentials: 'include',
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error ?? 'INTERNAL', data.message ?? 'Something went wrong');
  return data as T;
}

export interface CallQuery {
  from: string;
  to: string;
  employeeIds?: string;
  types?: string;
  minTalk?: string;
  maxTalk?: string;
  minRing?: string;
  maxRing?: string;
  numbers?: string;
  /** `no`: placed or answered calls waiting for the after-call form (M4); `yes`: calls with one. */
  commented?: string;
  /** M6: `yes` calls with a recording, `missing` calls flagged as missing one. */
  recording?: string;
  cursor?: string;
}

export interface ReportSummary {
  from: string;
  to: string;
  totalCalls: number;
  incomingCalls: number;
  outgoingCalls: number;
  missedCalls: number;
  rejectedCalls: number;
  connectedCalls: number;
  talkSeconds: number;
  uniqueNumbers: number;
  employeeCount: number;
}

export interface ApiKey {
  id: string;
  name: string;
  keyPrefix: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

export const callQueryString = (q: CallQuery) =>
  new URLSearchParams(Object.entries(q).filter(([, v]) => v !== undefined && v !== '') as [string, string][]).toString();

export const api = {
  me: () => request<{ user: User }>('GET', '/api/auth/me'),
  login: (email: string, password: string) => request<{ user: User }>('POST', '/api/auth/login', { email, password }),
  logout: () => request<void>('POST', '/api/auth/logout'),
  employees: () => request<{ items: Employee[] }>('GET', '/api/employees'),
  addEmployee: (body: { name: string; empCode?: string; companyNumber: string }) =>
    request<Employee>('POST', '/api/employees', body),
  updateEmployee: (id: string, body: Partial<{ name: string; companyNumber: string; status: 'active' | 'left' }>) =>
    request<Employee>('PATCH', `/api/employees/${id}`, body),
  pairingCode: (id: string) => request<PairingCodeResponse>('POST', `/api/employees/${id}/pairing-code`),
  revokeDevice: (id: string) => request<void>('POST', `/api/employees/${id}/revoke-device`),
  calls: (q: CallQuery) => request<Page<CallRow>>('GET', `/api/calls?${callQueryString(q)}`),
  /** A 5-minute link to play the call's recording; each play is audited (M6). */
  recording: (callId: number) => request<RecordingPlayResponse>('GET', `/api/calls/${callId}/recording`),
  outcomes: () => request<{ items: CallOutcome[] }>('GET', '/api/call-outcomes'),
  addOutcome: (label: string) => request<CallOutcome>('POST', '/api/call-outcomes', { label }),
  updateOutcome: (id: string, body: Partial<{ label: string; active: boolean }>) => request<CallOutcome>('PATCH', `/api/call-outcomes/${id}`, body),
  noteTemplates: () => request<{ items: NoteTemplate[] }>('GET', '/api/note-templates'),
  addNoteTemplate: (text: string) => request<NoteTemplate>('POST', '/api/note-templates', { text }),
  updateNoteTemplate: (id: string, body: Partial<{ text: string; active: boolean }>) =>
    request<NoteTemplate>('PATCH', `/api/note-templates/${id}`, body),
  /** CRM API keys (M5): the key itself comes back once, from create. */
  apiKeys: () => request<{ items: ApiKey[] }>('GET', '/api/integrations/api-keys'),
  createApiKey: (name: string) => request<ApiKey & { key: string }>('POST', '/api/integrations/api-keys', { name }),
  revokeApiKey: (id: string) => request<void>('DELETE', `/api/integrations/api-keys/${id}`),
  /** Super admin: every company, and the one to work in (P1). */
  companies: () => request<{ items: Company[] }>('GET', '/api/companies'),
  selectCompany: (companyId: number) => request<{ user: User }>('PUT', '/api/auth/company', { companyId }),
  /** M10: WhatsApp message templates (admins). */
  messageTemplates: () => request<{ items: MessageTemplate[] }>('GET', '/api/message-templates'),
  addMessageTemplate: (body: { title: string; body: string }) => request<MessageTemplate>('POST', '/api/message-templates', body),
  updateMessageTemplate: (id: string, body: Partial<{ title: string; body: string; active: boolean }>) =>
    request<MessageTemplate>('PATCH', `/api/message-templates/${id}`, body),
  /** M12, super admin: numbers whose calls are never recorded or kept. */
  neverRecord: () => request<{ items: NeverRecordNumber[] }>('GET', '/api/never-record-numbers'),
  addNeverRecord: (body: { number: string; label?: string; deletePastCalls?: boolean }) =>
    request<{ number: string; deletedCalls: number; deletedRecordings: number }>('POST', '/api/never-record-numbers', body),
  removeNeverRecord: (number: string) => request<void>('DELETE', `/api/never-record-numbers/${encodeURIComponent(number)}`),
  /** Today, yesterday, the last 7 days and this month (M2 task 2.7). */
  dashboard: () => request<DashboardResponse>('GET', '/api/reports/dashboard'),
  reportSummary: (q: CallQuery) => request<ReportSummary>('GET', `/api/reports/summary?${callQueryString(q)}`),
};
