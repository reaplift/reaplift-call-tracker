import type { FastifyInstance } from 'fastify';
import { sql, type Kysely } from 'kysely';
import {
  RecordingCallRef,
  RecordingMissing,
  RecordingUploadRequest,
  type RecordingPlayResponse,
  type RecordingUploadResponse,
} from '@reaplift/calls-shared';
import type { Database } from '../../lib/db.js';
import { audit } from '../../lib/audit.js';
import { sendError } from '../../lib/errors.js';
import { recordingKey, type RecordingStore } from '../../lib/storage.js';
import { scopeSql } from '../auth/scope.js';

/** The phone has this long to start its upload; a slow network resumes with a fresh link. */
export const UPLOAD_LINK_SECONDS = 15 * 60;
/** The panel's audio player gets 5 minutes (HLD section 10). */
export const PLAY_LINK_SECONDS = 5 * 60;
/** D4 (owner, 11 November 2026): R2's lifecycle rule deletes recordings 365 days after upload; call rows stay. */
export const RECORDING_RETENTION_DAYS = 365;

interface CallRow {
  id: number;
  company_id: number;
  started_at: Date;
  status: string | null;
  object_key: string | null;
}

/**
 * Call recordings (M6). The phone asks for an upload link, PUTs the file straight to storage, then says it is done;
 * the server checks the file is really there. Only the phone's own company-SIM call can get a recording.
 */
export function registerRecordingRoutes(
  app: FastifyInstance,
  deps: { db: Kysely<Database>; now: () => Date; store: RecordingStore | null },
) {
  const { db, now, store } = deps;

  const ownCall = async (deviceId: string, deviceCallId: string) =>
    (
      await sql<CallRow>`
        select c.id, c.company_id, c.started_at, r.status, r.object_key
        from calls c left join recordings r on r.call_id = c.id and r.company_id = c.company_id
        where c.device_id = ${deviceId} and c.device_call_id = ${deviceCallId}
      `.execute(db)
    ).rows[0];

  app.post('/device/v1/recordings/upload-url', async (req, reply) => {
    if (!store) return sendError(reply, 503, 'RECORDINGS_NOT_CONFIGURED', 'Recordings are not switched on yet; the phone will try later');
    const parsed = RecordingUploadRequest.safeParse(req.body);
    if (!parsed.success) return sendError(reply, 400, 'INVALID_REQUEST', 'Check the recording details');
    const device = req.device!;
    const r = parsed.data;
    const call = await ownCall(device.deviceId, r.deviceCallId);
    if (!call) return sendError(reply, 404, 'CALL_NOT_SYNCED', 'This call has not reached the server yet');
    if (call.status === 'uploaded') return sendError(reply, 409, 'RECORDING_EXISTS', 'This call already has its recording');
    // A retry gets a fresh key, so a half-finished earlier upload is never mistaken for this one.
    const key = recordingKey(call.company_id, call.id, call.started_at, r.mimeType);
    await sql`
      insert into recordings (company_id, call_id, status, object_key, size_bytes, audio_seconds, mime_type, match_score, reported_at)
      values (${call.company_id}, ${call.id}, 'pending_upload', ${key}, ${r.sizeBytes}, ${r.audioSeconds ?? null},
              ${r.mimeType}, ${r.matchScore ?? null}, ${now()})
      on duplicate key update status = 'pending_upload', object_key = values(object_key), size_bytes = values(size_bytes),
        audio_seconds = values(audio_seconds), mime_type = values(mime_type), match_score = values(match_score),
        reported_at = values(reported_at)
    `.execute(db);
    const body: RecordingUploadResponse = {
      uploadUrl: await store.uploadUrl(key, r.mimeType, UPLOAD_LINK_SECONDS),
      expiresAt: new Date(now().getTime() + UPLOAD_LINK_SECONDS * 1000).toISOString(),
      headers: { 'content-type': r.mimeType },
    };
    return reply.code(200).send(body);
  });

  app.post('/device/v1/recordings/complete', async (req, reply) => {
    if (!store) return sendError(reply, 503, 'RECORDINGS_NOT_CONFIGURED', 'Recordings are not switched on yet');
    const parsed = RecordingCallRef.safeParse(req.body);
    if (!parsed.success) return sendError(reply, 400, 'INVALID_REQUEST', 'Send { deviceCallId }');
    const device = req.device!;
    const call = await ownCall(device.deviceId, parsed.data.deviceCallId);
    if (!call || !call.object_key) return sendError(reply, 404, 'NOT_FOUND', 'Ask for an upload link first');
    if (call.status === 'uploaded') return reply.code(204).send();
    const size = await store.size(call.object_key);
    if (size === null || size === 0) return sendError(reply, 400, 'UPLOAD_NOT_FOUND', 'The file did not arrive; upload it again');
    await sql`
      update recordings set status = 'uploaded', size_bytes = ${size}, uploaded_at = ${now()}
      where company_id = ${call.company_id} and call_id = ${call.id}
    `.execute(db);
    await audit(db, { companyId: device.companyId, deviceId: device.deviceId, action: 'recording.uploaded', targetType: 'call', targetId: String(call.id), details: { sizeBytes: size } });
    return reply.code(204).send();
  });

  /** No file matched this call: the panel flags it (HLD 8.6). An upload that already arrived is kept. */
  app.post('/device/v1/recordings/missing', async (req, reply) => {
    const parsed = RecordingMissing.safeParse(req.body);
    if (!parsed.success) return sendError(reply, 400, 'INVALID_REQUEST', 'Send { deviceCallId, diagnostics? }');
    const d = parsed.data.diagnostics;
    // A folder named after a client must not be stored: long digit runs go, as the phone already does.
    const folder = d?.bestFolder ? d.bestFolder.replace(/\d{5,}/g, '#') : null;
    const device = req.device!;
    const call = await ownCall(device.deviceId, parsed.data.deviceCallId);
    if (!call) return sendError(reply, 404, 'CALL_NOT_SYNCED', 'This call has not reached the server yet');
    if (call.status === 'uploaded') return reply.code(204).send();
    await sql`
      insert into recordings (company_id, call_id, status, reported_at, files_in_window, best_score, best_folder, best_audio_seconds, best_offset_seconds)
      values (${call.company_id}, ${call.id}, 'missing', ${now()}, ${d?.filesInWindow ?? null}, ${d?.bestScore ?? null}, ${folder},
              ${d?.bestAudioSeconds ?? null}, ${d?.bestOffsetSeconds ?? null})
      on duplicate key update status = if(status = 'uploaded', status, 'missing'), reported_at = values(reported_at),
        files_in_window = values(files_in_window), best_score = values(best_score), best_folder = values(best_folder),
        best_audio_seconds = values(best_audio_seconds), best_offset_seconds = values(best_offset_seconds)
    `.execute(db);
    return reply.code(204).send();
  });

  /** A 5-minute link for the panel's audio player; every play is written to the audit log (HLD section 10). */
  app.get('/api/calls/:id/recording', async (req, reply) => {
    const scope = req.scope!;
    const id = Number((req.params as { id: string }).id);
    if (!Number.isSafeInteger(id) || id <= 0) return sendError(reply, 404, 'NOT_FOUND', 'Not found');
    const row = (
      await sql<{ object_key: string | null; status: string | null; uploaded_at: Date | null }>`
        select r.object_key, r.status, r.uploaded_at
        from calls c left join recordings r on r.call_id = c.id and r.company_id = c.company_id
        where c.id = ${id} and ${scopeSql(scope)}
      `.execute(db)
    ).rows[0];
    if (!row) return sendError(reply, 404, 'NOT_FOUND', 'Not found');
    if (row.status !== 'uploaded' || !row.object_key) return sendError(reply, 404, 'NO_RECORDING', 'This call has no recording');
    if (row.uploaded_at && now().getTime() - row.uploaded_at.getTime() > RECORDING_RETENTION_DAYS * 86_400_000)
      return sendError(reply, 410, 'RECORDING_EXPIRED', 'Recordings are deleted 12 months after upload');
    if (!store) return sendError(reply, 503, 'RECORDINGS_NOT_CONFIGURED', 'Recordings are not switched on');
    await audit(db, { companyId: scope.companyId, userId: req.auth!.userId, action: 'recording.played', targetType: 'call', targetId: String(id) });
    const body: RecordingPlayResponse = {
      url: await store.playUrl(row.object_key, PLAY_LINK_SECONDS),
      expiresAt: new Date(now().getTime() + PLAY_LINK_SECONDS * 1000).toISOString(),
    };
    return reply.code(200).send(body);
  });
}
