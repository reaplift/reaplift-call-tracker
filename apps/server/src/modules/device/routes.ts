import type { FastifyInstance } from 'fastify';
import { sql, type Kysely } from 'kysely';
import {
  DeviceCallBatch,
  PairRequest,
  type DeviceCall,
  type DeviceCallBatchResult,
  type DeviceSettings,
  type PairResponse,
} from '@reaplift/calls-shared';
import type { Database } from '../../lib/db.js';
import { audit } from '../../lib/audit.js';
import { createSessionToken, hashToken } from '../../lib/auth.js';
import { sendError } from '../../lib/errors.js';
import { normalizeNumber } from '../../lib/phone.js';
import { findLiveCode } from '../employees/pairing.js';

/** Wrong pairing codes allowed per address in 10 minutes. A code has a million values, so guessing must be slow. */
export const PAIR_FAILURES_ALLOWED = 10;
const PAIR_WINDOW_MS = 10 * 60 * 1000;

export function registerDeviceRoutes(
  app: FastifyInstance,
  deps: { db: Kysely<Database>; now: () => Date; settings: DeviceSettings },
) {
  const { db, now, settings } = deps;
  const failures = new Map<string, { count: number; since: number }>();

  const tooManyFailures = (ip: string, at: number) => {
    const entry = failures.get(ip);
    if (!entry || at - entry.since > PAIR_WINDOW_MS) return false;
    return entry.count >= PAIR_FAILURES_ALLOWED;
  };
  const countFailure = (ip: string, at: number) => {
    const entry = failures.get(ip);
    if (!entry || at - entry.since > PAIR_WINDOW_MS) failures.set(ip, { count: 1, since: at });
    else entry.count += 1;
  };

  app.post('/device/v1/pair', async (req, reply) => {
    const at = now();
    if (tooManyFailures(req.ip, at.getTime()))
      return sendError(reply, 429, 'RATE_LIMITED', 'Too many wrong codes. Wait 10 minutes and try again');
    const parsed = PairRequest.safeParse(req.body);
    if (!parsed.success) return sendError(reply, 400, 'INVALID_REQUEST', 'Check the pairing details');
    const p = parsed.data;
    const live = await findLiveCode(db, p.code, at);
    if (!live) {
      countFailure(req.ip, at.getTime());
      return sendError(reply, 400, 'PAIRING_CODE_INVALID', 'This code is wrong or has expired. Ask your admin for a new one');
    }

    const token = createSessionToken();
    const employee = await db.transaction().execute(async (trx) => {
      // Single use: a second phone racing with the same code finds it used.
      const claimed = await sql`
        update pairing_codes set used_at = ${at} where id = ${live.id} and used_at is null returning id
      `.execute(trx);
      if (!claimed.rows.length) return null;
      // One live phone per employee: the new phone replaces the old one.
      await sql`update devices set revoked_at = ${at} where employee_id = ${live.employeeId} and revoked_at is null`.execute(trx);
      const deviceId = (
        await sql<{ id: string }>`
          insert into devices (employee_id, token_hash, brand, model, android_version, sdk_int, app_version,
                               default_dialer, sim_slot, sim_carrier, phone_account_id, consent_at, consent_version, paired_at)
          values (${live.employeeId}, ${hashToken(token)}, ${p.brand}, ${p.model}, ${p.androidVersion}, ${p.sdkInt},
                  ${p.appVersion}, ${p.defaultDialer ?? null}, ${p.simSlot}, ${p.simCarrier ?? null},
                  ${p.phoneAccountId ?? null}, ${at}, ${p.consentVersion}, ${at})
          returning id
        `.execute(trx)
      ).rows[0]!.id;
      await audit(trx, {
        deviceId,
        action: 'device.paired',
        targetType: 'employee',
        targetId: live.employeeId,
        details: { brand: p.brand, model: p.model, androidVersion: p.androidVersion, appVersion: p.appVersion },
      });
      return (
        await sql<{ name: string; company_number: string }>`
          select name, company_number from employees where id = ${live.employeeId}
        `.execute(trx)
      ).rows[0]!;
    });
    if (!employee)
      return sendError(reply, 400, 'PAIRING_CODE_INVALID', 'This code is wrong or has expired. Ask your admin for a new one');

    const body: PairResponse = {
      deviceToken: token,
      employee: { name: employee.name, companyNumber: employee.company_number },
      settings,
    };
    return reply.code(201).send(body);
  });

  app.get('/device/v1/config', async (_req, reply) => reply.code(200).send({ settings }));

  app.post('/device/v1/calls', async (req, reply) => {
    const parsed = DeviceCallBatch.safeParse(req.body);
    if (!parsed.success) return sendError(reply, 400, 'INVALID_REQUEST', 'Send { calls: [...] } with 1 to 200 calls');
    const device = req.device!;
    const at = now();
    // The phone sends at most initialSyncDays of history before pairing, plus a day for clock drift.
    const earliest = device.pairedAt.getTime() - (settings.initialSyncDays + 1) * 86_400_000;
    const latest = at.getTime() + 86_400_000;

    const result: DeviceCallBatchResult = { accepted: 0, duplicates: 0, rejected: [] };
    // The same row twice in one batch (a retried send merged with a new one) counts once.
    const unique = new Map<string, DeviceCall>();
    for (const call of parsed.data.calls) {
      if (unique.has(call.deviceCallId)) result.duplicates += 1;
      unique.set(call.deviceCallId, call);
    }
    const rows = [];
    for (const call of unique.values()) {
      const started = new Date(call.startedAt).getTime();
      if (started > latest) {
        result.rejected.push({ deviceCallId: call.deviceCallId, reason: 'starts in the future' });
        continue;
      }
      if (started < earliest) {
        result.rejected.push({ deviceCallId: call.deviceCallId, reason: 'older than the pairing window' });
        continue;
      }
      const { number, kind } = normalizeNumber(call.number);
      rows.push(sql`(
        ${device.employeeId}::uuid, ${device.deviceId}::uuid, ${call.deviceCallId}, ${number}, ${kind},
        ${call.contactName?.trim() || null}, ${call.type}, ${call.startedAt}::timestamptz, ${call.talkSeconds},
        ${call.ringSeconds ?? null}::int, ${call.endedAt ?? null}::timestamptz, ${at}::timestamptz, ${at}::timestamptz
      )`);
    }

    if (rows.length) {
      const inserted = (
        await sql<{ inserted: boolean }>`
          insert into calls (employee_id, device_id, device_call_id, number, number_kind, contact_name, type,
                             started_at, talk_seconds, ring_seconds, ended_at, synced_at, updated_at)
          values ${sql.join(rows)}
          on conflict (device_id, device_call_id) do update set
            -- A resend may add what the first send lacked (a contact saved later, ringing time measured late).
            contact_name = coalesce(excluded.contact_name, calls.contact_name),
            ring_seconds = coalesce(calls.ring_seconds, excluded.ring_seconds),
            ended_at = coalesce(calls.ended_at, excluded.ended_at),
            updated_at = excluded.updated_at
          returning (xmax = 0) as inserted
        `.execute(db)
      ).rows;
      for (const r of inserted) {
        if (r.inserted) result.accepted += 1;
        else result.duplicates += 1;
      }
    }
    await sql`update devices set last_sync_at = ${at} where id = ${device.deviceId}`.execute(db);
    return reply.code(200).send(result);
  });
}
