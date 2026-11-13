import type { FastifyInstance } from 'fastify';
import { sql, type Kysely } from 'kysely';
import {
  CallComment,
  DeviceCallBatch,
  PairRequest,
  type DeviceCall,
  type DeviceCallBatchResult,
  type DeviceConfig,
  type DeviceSettings,
  type PairResponse,
} from '@reaplift/calls-shared';
import type { Database } from '../../lib/db.js';
import { audit } from '../../lib/audit.js';
import { createSessionToken, hashToken } from '../../lib/auth.js';
import { sendError } from '../../lib/errors.js';
import { neverRecordNumbers, numberHash } from '../never-record/routes.js';
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
        update pairing_codes set used_at = ${at} where id = ${live.id} and used_at is null
      `.execute(trx);
      if (Number(claimed.numAffectedRows ?? 0) === 0) return null;
      // One live phone per employee: the new phone replaces the old one.
      await sql`
        update devices set revoked_at = ${at}
        where company_id = ${live.companyId} and employee_id = ${live.employeeId} and revoked_at is null
      `.execute(trx);
      // The device's company comes from the pairing code, never from what the phone sends (D11).
      const deviceId = (
        await sql<{ id: string }>`
          insert into devices (company_id, employee_id, token_hash, brand, model, android_version, sdk_int, app_version,
                               default_dialer, sim_slot, sim_carrier, phone_account_id, consent_at, consent_version, paired_at)
          values (${live.companyId}, ${live.employeeId}, ${hashToken(token)}, ${p.brand}, ${p.model}, ${p.androidVersion}, ${p.sdkInt},
                  ${p.appVersion}, ${p.defaultDialer ?? null}, ${p.simSlot}, ${p.simCarrier ?? null},
                  ${p.phoneAccountId ?? null}, ${at}, ${p.consentVersion}, ${at})
          returning id
        `.execute(trx)
      ).rows[0]!.id;
      await audit(trx, {
        companyId: live.companyId,
        deviceId,
        action: 'device.paired',
        targetType: 'employee',
        targetId: live.employeeId,
        details: { brand: p.brand, model: p.model, androidVersion: p.androidVersion, appVersion: p.appVersion },
      });
      return (
        await sql<{ name: string; company_number: string }>`
          select name, company_number from employees where company_id = ${live.companyId} and id = ${live.employeeId}
        `.execute(trx)
      ).rows[0]!;
    });
    if (!employee)
      return sendError(reply, 400, 'PAIRING_CODE_INVALID', 'This code is wrong or has expired. Ask your admin for a new one');

    const body: PairResponse = {
      deviceToken: token,
      employee: { name: employee.name, companyNumber: employee.company_number },
      company: { name: live.companyName },
      settings,
    };
    return reply.code(201).send(body);
  });

  app.get('/device/v1/config', async (req, reply) => {
    const outcomes = (
      await sql<{ id: string; label: string }>`
        select id, label from call_outcomes where company_id = ${req.device!.companyId} and active = 1 order by sort_order, label
      `.execute(db)
    ).rows;
    const noteTemplates = (
      await sql<{ text: string }>`
        select text from note_templates where company_id = ${req.device!.companyId} and active = 1 order by sort_order, text
      `.execute(db)
    ).rows.map((r) => r.text);
    const neverRecord = [...(await neverRecordNumbers(db, req.device!.companyId))].map(numberHash);
    const body: DeviceConfig = { settings, outcomes, noteTemplates, neverRecord };
    return reply.code(200).send(body);
  });

  /**
   * The after-call form (M4). The call must already be synced; until then the phone keeps the comment and retries.
   * Only this phone's own call can be commented, and only with its company's outcomes.
   */
  app.patch('/device/v1/calls/:deviceCallId/comment', async (req, reply) => {
    const device = req.device!;
    const { deviceCallId } = req.params as { deviceCallId: string };
    const parsed = CallComment.safeParse(req.body);
    if (!parsed.success) return sendError(reply, 400, 'INVALID_REQUEST', parsed.error.issues[0]?.message ?? 'Check the comment');
    const c = parsed.data;
    if (c.outcomeId) {
      const outcome = (
        await sql`select 1 from call_outcomes where company_id = ${device.companyId} and id = ${c.outcomeId} and active = 1`.execute(db)
      ).rows[0];
      if (!outcome) return sendError(reply, 400, 'OUTCOME_UNKNOWN', 'That outcome is not available; refresh and pick again');
    }
    const updated = await sql`
      update calls set outcome_id = ${c.outcomeId}, note = ${c.note || null},
             follow_up_at = ${c.followUpAt ? new Date(c.followUpAt) : null}, commented_at = ${now()}, updated_at = ${now()}
      where device_id = ${device.deviceId} and device_call_id = ${deviceCallId}
    `.execute(db);
    if (Number(updated.numAffectedRows ?? 0) === 0)
      return sendError(reply, 404, 'CALL_NOT_SYNCED', 'This call has not reached the server yet; the phone will send the comment again');
    await audit(db, { companyId: device.companyId, deviceId: device.deviceId, action: 'call.commented', targetType: 'call', targetId: deviceCallId });
    return reply.code(204).send();
  });

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
    const rows: Array<{ call: DeviceCall; number: string; kind: string }> = [];
    // M12: a phone that hasn't picked up the list yet (or an older app) may still send these; they are never stored.
    const neverRecord = await neverRecordNumbers(db, device.companyId);
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
      if (number && neverRecord.has(number)) {
        result.rejected.push({ deviceCallId: call.deviceCallId, reason: 'never record' });
        continue;
      }
      rows.push({ call, number, kind });
    }

    if (rows.length) {
      await db.transaction().execute(async (trx) => {
        // Rows this phone already sent are duplicates; a phone sends its own batches one at a time.
        const ids = rows.map((r) => r.call.deviceCallId);
        const seen = new Set(
          (
            await sql<{ device_call_id: string }>`
              select device_call_id from calls where device_id = ${device.deviceId} and device_call_id in (${sql.join(ids)})
            `.execute(trx)
          ).rows.map((r) => r.device_call_id),
        );
        const values = rows.map(
          ({ call, number, kind }) => sql`(
            ${device.companyId}, ${device.employeeId}, ${device.deviceId}, ${call.deviceCallId}, ${number}, ${kind},
            ${call.contactName?.trim() || null}, ${call.type}, ${new Date(call.startedAt)}, ${call.talkSeconds},
            ${call.ringSeconds ?? null}, ${call.endedAt ? new Date(call.endedAt) : null}, ${at}, ${at}
          )`,
        );
        // The company and employee come from the device row, never from the request (D11).
        await sql`
          insert into calls (company_id, employee_id, device_id, device_call_id, number, number_kind, contact_name, type,
                             started_at, talk_seconds, ring_seconds, ended_at, synced_at, updated_at)
          values ${sql.join(values)}
          on duplicate key update
            -- A resend may add what the first send lacked (a contact saved later, ringing time measured late).
            contact_name = coalesce(values(contact_name), contact_name),
            ring_seconds = coalesce(ring_seconds, values(ring_seconds)),
            ended_at = coalesce(ended_at, values(ended_at)),
            updated_at = values(updated_at)
        `.execute(trx);
        for (const r of rows) {
          if (seen.has(r.call.deviceCallId)) result.duplicates += 1;
          else result.accepted += 1;
        }
      });
    }
    await sql`update devices set last_sync_at = ${at} where id = ${device.deviceId}`.execute(db);
    return reply.code(200).send(result);
  });
}
