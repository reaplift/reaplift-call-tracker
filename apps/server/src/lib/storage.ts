import { randomBytes } from 'node:crypto';
import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

/**
 * Where recordings live (M6): Cloudflare R2 in production (D6), MinIO locally, a fake in tests. The bucket is
 * private; the phone uploads and the panel plays through links that expire.
 */
export interface RecordingStore {
  /** A link the phone PUTs the file to, valid for `seconds`. The phone must send the same content type. */
  uploadUrl(key: string, contentType: string, seconds: number): Promise<string>;
  /** A link the panel's audio player reads from, valid for `seconds`. */
  playUrl(key: string, seconds: number): Promise<string>;
  /** The stored object's size, or null when nothing was uploaded under that key. */
  size(key: string): Promise<number | null>;
  /** Deletes the object (M12: past calls of a never-record number). Deleting a missing object is not an error. */
  remove(key: string): Promise<void>;
}

export interface S3Settings {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
}

export function s3Store(s: S3Settings): RecordingStore {
  const client = new S3Client({
    endpoint: s.endpoint,
    region: s.region,
    credentials: { accessKeyId: s.accessKeyId, secretAccessKey: s.secretAccessKey },
    // R2 and MinIO address buckets by path, not by subdomain.
    forcePathStyle: true,
  });
  return {
    uploadUrl: (key, contentType, seconds) =>
      getSignedUrl(client, new PutObjectCommand({ Bucket: s.bucket, Key: key, ContentType: contentType }), { expiresIn: seconds }),
    playUrl: (key, seconds) => getSignedUrl(client, new GetObjectCommand({ Bucket: s.bucket, Key: key }), { expiresIn: seconds }),
    remove: async (key) => {
      await client.send(new DeleteObjectCommand({ Bucket: s.bucket, Key: key }));
    },
    size: async (key) => {
      try {
        const head = await client.send(new HeadObjectCommand({ Bucket: s.bucket, Key: key }));
        return head.ContentLength ?? 0;
      } catch (err) {
        const status = (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
        if (status === 404 || (err as { name?: string }).name === 'NotFound') return null;
        throw err;
      }
    },
  };
}

const EXTENSIONS: Record<string, string> = {
  'audio/mp4': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/aac': 'aac',
  'audio/mpeg': 'mp3',
  'audio/amr': 'amr',
  'audio/3gpp': '3gp',
  'audio/ogg': 'ogg',
  'audio/opus': 'opus',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
};

/** `c<company>/<yyyy>/<mm>/<call id>-<random>.<ext>`: grouped by company and month, and not guessable. */
export function recordingKey(companyId: number, callId: number, startedAt: Date, mimeType: string): string {
  const yyyy = startedAt.getUTCFullYear();
  const mm = String(startedAt.getUTCMonth() + 1).padStart(2, '0');
  const ext = EXTENSIONS[mimeType.toLowerCase()] ?? 'bin';
  return `c${companyId}/${yyyy}/${mm}/${callId}-${randomBytes(8).toString('hex')}.${ext}`;
}
