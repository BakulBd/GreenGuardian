/**
 * Backblaze B2 object storage, spoken to over its S3-compatible API.
 *
 * SERVER ONLY — import this from route handlers and server components, never
 * from a client component. The B2 key id and application key are full bucket
 * credentials; every field read here is a bare (non-`NEXT_PUBLIC_`) env var, so
 * nothing in this module can be inlined into the browser bundle. The bucket
 * itself stays PRIVATE: browsers never talk to B2 with a credential, only with
 * a short-lived presigned URL minted here.
 *
 * Required environment (already provisioned for this project):
 *   B2_ENDPOINT          e.g. https://s3.us-east-005.backblazeb2.com
 *   B2_REGION            e.g. us-east-005
 *   B2_KEY_ID
 *   B2_APPLICATION_KEY
 *   B2_BUCKET_NAME
 */
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  type ListObjectsV2CommandOutput,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export interface B2Config {
  endpoint: string;
  region: string;
  keyId: string;
  applicationKey: string;
  bucket: string;
}

/** How long a presigned upload URL stays usable (10 minutes). */
export const UPLOAD_URL_TTL_SECONDS = 10 * 60;

/**
 * How long a presigned download URL stays usable (15 minutes).
 *
 * Short by design: the durable link stored in Firestore is the app's own
 * `/api/storage/download?…` capability URL, and it mints one of these on every
 * click. Nothing persists a presigned URL, so nothing breaks when it expires.
 */
export const DOWNLOAD_URL_TTL_SECONDS = 15 * 60;

function readEnv(name: string): string {
  // Trimmed because a value pasted into `.env.local` frequently carries
  // trailing whitespace or surrounding quotes, and an endpoint with a stray
  // space fails as an opaque DNS error at request time.
  return (process.env[name] || "").trim().replace(/^["']|["']$/g, "");
}

let cachedConfig: B2Config | null = null;
let cachedClient: S3Client | null = null;

/**
 * Returns the B2 configuration, or `null` when it is incomplete. Never throws,
 * so health checks and optional code paths can ask without a try/catch.
 */
export function getB2Config(): B2Config | null {
  if (cachedConfig) return cachedConfig;

  const endpoint = readEnv("B2_ENDPOINT");
  const region = readEnv("B2_REGION");
  const keyId = readEnv("B2_KEY_ID");
  const applicationKey = readEnv("B2_APPLICATION_KEY");
  const bucket = readEnv("B2_BUCKET_NAME");

  if (!endpoint || !region || !keyId || !applicationKey || !bucket) return null;

  cachedConfig = { endpoint, region, keyId, applicationKey, bucket };
  return cachedConfig;
}

/** True when every B2 variable this deployment needs is present. */
export function isB2Configured(): boolean {
  return getB2Config() !== null;
}

/** Names of the B2 variables that are missing — for diagnostics only. */
export function missingB2EnvVars(): string[] {
  return ["B2_ENDPOINT", "B2_REGION", "B2_KEY_ID", "B2_APPLICATION_KEY", "B2_BUCKET_NAME"].filter(
    (name) => !readEnv(name)
  );
}

export class B2NotConfiguredError extends Error {
  constructor() {
    super(
      `Object storage is not configured on this deployment. Missing: ${missingB2EnvVars().join(", ")}.`
    );
    this.name = "B2NotConfiguredError";
  }
}

function requireConfig(): B2Config {
  const config = getB2Config();
  if (!config) throw new B2NotConfiguredError();
  return config;
}

export function getB2Client(): S3Client {
  if (cachedClient) return cachedClient;
  const config = requireConfig();

  cachedClient = new S3Client({
    region: config.region,
    endpoint: config.endpoint,
    credentials: {
      accessKeyId: config.keyId,
      secretAccessKey: config.applicationKey,
    },
    // B2 serves the S3 API on a path-style host (`<endpoint>/<bucket>/<key>`);
    // the SDK's default virtual-host style resolves to a name that does not
    // exist and fails as an unhelpful DNS error.
    forcePathStyle: true,
  });
  return cachedClient;
}

export function getB2BucketName(): string {
  return requireConfig().bucket;
}

/** A presigned `PUT` the browser can upload one object to, then never again. */
export async function createPresignedUploadUrl(
  key: string,
  contentType: string,
  expiresIn: number = UPLOAD_URL_TTL_SECONDS
): Promise<string> {
  const command = new PutObjectCommand({
    Bucket: getB2BucketName(),
    Key: key,
    ContentType: contentType,
  });
  return getSignedUrl(getB2Client(), command, { expiresIn });
}

export interface DownloadUrlOptions {
  expiresIn?: number;
  /** Force a save-as with this filename instead of rendering inline. */
  downloadFilename?: string;
  /** Overrides the stored content type (objects uploaded without one). */
  contentType?: string;
}

/** A presigned `GET` for a private object. */
export async function createPresignedDownloadUrl(
  key: string,
  { expiresIn = DOWNLOAD_URL_TTL_SECONDS, downloadFilename, contentType }: DownloadUrlOptions = {}
): Promise<string> {
  const command = new GetObjectCommand({
    Bucket: getB2BucketName(),
    Key: key,
    ...(downloadFilename
      ? { ResponseContentDisposition: `attachment; filename="${downloadFilename}"` }
      : {}),
    ...(contentType ? { ResponseContentType: contentType } : {}),
  });
  return getSignedUrl(getB2Client(), command, { expiresIn });
}

/** Uploads bytes straight from the server (proxy fallback, proctoring frames). */
export async function putObject(
  key: string,
  body: Buffer | Uint8Array | string,
  contentType: string
): Promise<void> {
  await getB2Client().send(
    new PutObjectCommand({
      Bucket: getB2BucketName(),
      Key: key,
      Body: body,
      ContentType: contentType,
    })
  );
}

/** Deletes one object. Succeeds silently when the key is already gone. */
export async function deleteObject(key: string): Promise<void> {
  await getB2Client().send(
    new DeleteObjectCommand({ Bucket: getB2BucketName(), Key: key })
  );
}

/**
 * Deletes many objects in one round trip. B2 caps a batch at 1000 keys, which
 * this chunks to; the per-key errors S3 reports are collected rather than
 * thrown so one missing object cannot abandon the rest of the batch.
 */
export async function deleteObjects(keys: string[]): Promise<{ deleted: number; errors: string[] }> {
  if (keys.length === 0) return { deleted: 0, errors: [] };

  const client = getB2Client();
  const bucket = getB2BucketName();
  const errors: string[] = [];
  let deleted = 0;

  for (let i = 0; i < keys.length; i += 1000) {
    const chunk = keys.slice(i, i + 1000);
    const response = await client.send(
      new DeleteObjectsCommand({
        Bucket: bucket,
        Delete: { Objects: chunk.map((Key) => ({ Key })), Quiet: true },
      })
    );
    deleted += chunk.length - (response.Errors?.length || 0);
    response.Errors?.forEach((error) => errors.push(`${error.Key}: ${error.Message}`));
  }

  return { deleted, errors };
}

export interface ObjectMetadata {
  key: string;
  size: number;
  contentType: string;
  lastModified: Date | null;
}

/** Object metadata, or `null` when the object does not exist. */
export async function headObject(key: string): Promise<ObjectMetadata | null> {
  try {
    const response = await getB2Client().send(
      new HeadObjectCommand({ Bucket: getB2BucketName(), Key: key })
    );
    return {
      key,
      size: Number(response.ContentLength || 0),
      contentType: String(response.ContentType || "application/octet-stream"),
      lastModified: response.LastModified || null,
    };
  } catch (error: any) {
    const status = error?.$metadata?.httpStatusCode;
    if (status === 404 || error?.name === "NotFound" || error?.name === "NoSuchKey") return null;
    throw error;
  }
}

/** Lists up to `maxKeys` objects under a prefix — used by the health probe. */
export async function listObjects(prefix = "", maxKeys = 1): Promise<ListObjectsV2CommandOutput> {
  return getB2Client().send(
    new ListObjectsV2Command({
      Bucket: getB2BucketName(),
      Prefix: prefix || undefined,
      MaxKeys: maxKeys,
    })
  );
}
