#!/usr/bin/env node
/**
 * Applies (or shows) the CORS rules on the Backblaze B2 bucket.
 *
 * Why this exists: uploads go straight from the browser to B2 with a presigned
 * URL, which is a cross-origin PUT. A bucket with no CORS rule rejects the
 * preflight, the upload fails as an opaque "network error", and the app
 * silently falls back to the server-proxy path — which works, but buffers the
 * file in a serverless function and therefore caps out around 4 MB. Classroom
 * material uploads (up to 100 MB) need the direct path, so they need this.
 *
 * B2 does not implement S3's PutBucketCors, so this talks to the *native* B2
 * API instead of going through the S3 client the app uses at runtime.
 *
 *   npm run storage:cors         apply the rules below
 *   npm run storage:cors:show    print the rules currently on the bucket
 *
 * The key in B2_KEY_ID/B2_APPLICATION_KEY needs the `listBuckets` capability to
 * show, and `writeBuckets` to apply. An application key restricted to a single
 * bucket usually has neither — in that case run this once with the account's
 * master key, or set the rules in the B2 web console.
 *
 * Origins default to the list below and can be overridden with a
 * comma-separated B2_CORS_ORIGINS.
 */

import fs from "node:fs";
import path from "node:path";

const AUTHORIZE_URL = "https://api.backblazeb2.com/b2api/v3/b2_authorize_account";

const DEFAULT_ORIGINS = [
  "https://green.bakul.app",
  "https://*.bakul.app",
  "https://*.vercel.app",
  "http://localhost:3000",
  "http://localhost:3001",
  "http://127.0.0.1:3000",
  "http://127.0.0.1:3001",
];

/** Minimal .env reader — this script runs outside Next.js, which loads them itself. */
function loadEnvFile(fileName) {
  const filePath = path.join(process.cwd(), fileName);
  if (!fs.existsSync(filePath)) return;

  for (const line of fs.readFileSync(filePath, "utf8").split("\n")) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (process.env[key] !== undefined) continue;
    process.env[key] = rawValue.trim().replace(/^["']|["']$/g, "");
  }
}

loadEnvFile(".env.local");
loadEnvFile(".env");

const keyId = (process.env.B2_KEY_ID || "").trim();
const applicationKey = (process.env.B2_APPLICATION_KEY || "").trim();
const bucketName = (process.env.B2_BUCKET_NAME || "").trim();

if (!keyId || !applicationKey || !bucketName) {
  console.error(
    "Missing B2 configuration. Set B2_KEY_ID, B2_APPLICATION_KEY and B2_BUCKET_NAME in .env.local."
  );
  process.exit(1);
}

const origins = (process.env.B2_CORS_ORIGINS || "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

const allowedOrigins = origins.length > 0 ? origins : DEFAULT_ORIGINS;

const corsRules = [
  {
    corsRuleName: "greenguardian-web",
    allowedOrigins,
    // s3_put is the presigned upload; s3_get/s3_head cover presigned reads.
    // s3_delete is included so a future direct-delete path does not require
    // re-running this, and the native download operations keep any legacy
    // links working.
    allowedOperations: [
      "s3_put",
      "s3_get",
      "s3_head",
      "s3_delete",
      "s3_post",
      "b2_download_file_by_name",
      "b2_download_file_by_id",
    ],
    allowedHeaders: ["*"],
    // The browser can only read a response header that is exposed. `etag` is
    // how an upload is verified; the request-id headers make B2 support
    // tickets answerable.
    exposeHeaders: ["etag", "x-amz-request-id", "x-amz-id-2", "content-length"],
    maxAgeSeconds: 3600,
  },
];

async function readJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

async function authorize() {
  const response = await fetch(AUTHORIZE_URL, {
    headers: {
      Authorization: `Basic ${Buffer.from(`${keyId}:${applicationKey}`).toString("base64")}`,
    },
  });
  const data = await readJson(response);
  if (!response.ok) {
    throw new Error(data?.message || `B2 authorization failed (HTTP ${response.status}).`);
  }
  const storageApi = data.apiInfo?.storageApi || {};
  return {
    accountId: data.accountId,
    apiUrl: storageApi.apiUrl,
    token: data.authorizationToken,
    restrictedBucketId: storageApi.bucketId || null,
    capabilities: storageApi.capabilities || [],
  };
}

async function callApi(auth, endpoint, body) {
  const response = await fetch(`${auth.apiUrl}/b2api/v3/${endpoint}`, {
    method: "POST",
    headers: { Authorization: auth.token, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await readJson(response);
  if (!response.ok) {
    const capabilityHint = response.status === 401 || data?.code === "unauthorized"
      ? ` The key "${keyId}" may lack the required capability (have: ${auth.capabilities.join(", ") || "unknown"}).`
      : "";
    throw new Error(`${endpoint} failed: ${data?.message || response.status}.${capabilityHint}`);
  }
  return data;
}

async function findBucket(auth) {
  const body = { accountId: auth.accountId };
  if (auth.restrictedBucketId) body.bucketId = auth.restrictedBucketId;
  else body.bucketName = bucketName;

  const data = await callApi(auth, "b2_list_buckets", body);
  const bucket = (data.buckets || []).find((b) => b.bucketName === bucketName) || data.buckets?.[0];
  if (!bucket) throw new Error(`Bucket "${bucketName}" was not found for this account.`);
  return bucket;
}

async function main() {
  const showOnly = process.argv.includes("--show");
  const auth = await authorize();
  const bucket = await findBucket(auth);

  console.log(`Bucket: ${bucket.bucketName} (${bucket.bucketId}) — type: ${bucket.bucketType}`);
  if (bucket.bucketType !== "allPrivate") {
    console.warn(
      `WARNING: bucket type is "${bucket.bucketType}". GreenGuardian expects a PRIVATE bucket — every file is served through a presigned URL, and a public bucket would make every uploaded exam paper and proctoring screenshot readable by anyone with the path.`
    );
  }

  console.log("\nCurrent CORS rules:");
  console.log(JSON.stringify(bucket.corsRules || [], null, 2));

  if (showOnly) return;

  console.log("\nApplying:");
  console.log(JSON.stringify(corsRules, null, 2));

  await callApi(auth, "b2_update_bucket", {
    accountId: auth.accountId,
    bucketId: bucket.bucketId,
    corsRules,
  });

  console.log(`\nApplied ${corsRules.length} CORS rule(s) to "${bucketName}".`);
  console.log("Direct browser uploads are now enabled for:", allowedOrigins.join(", "));
}

main().catch((error) => {
  console.error(`\nFailed: ${error.message}`);
  console.error(
    "\nIf this is a capability problem, either run it with the B2 master application key, " +
      "or add the CORS rules manually in the Backblaze console (Bucket → CORS Rules)."
  );
  process.exit(1);
});
