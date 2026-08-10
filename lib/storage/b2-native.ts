/**
 * The small part of Backblaze's *native* B2 API that the S3-compatible API
 * does not cover (server-only).
 *
 * Everything the app does at runtime goes through the S3 API in `b2.ts`. CORS
 * is the exception: B2 does not implement S3's `GetBucketCors`/`PutBucketCors`,
 * so a bucket's CORS rules can only be read or written through the native API.
 *
 * That matters because CORS is what decides whether the browser may upload
 * straight to B2 with a presigned URL. Without a rule for this origin the
 * direct upload fails as an opaque network error and every upload silently
 * falls back to the slower, 4 MB-capped server proxy — exactly the kind of
 * quiet degradation the admin health page exists to surface.
 */

const AUTHORIZE_URL = "https://api.backblazeb2.com/b2api/v3/b2_authorize_account";

interface B2Authorization {
  accountId: string;
  apiUrl: string;
  authorizationToken: string;
  /** Set when the key is restricted to a single bucket. */
  restrictedBucketId: string | null;
  capabilities: string[];
}

export interface B2CorsStatus {
  /** Number of CORS rules on the bucket, or `null` when it could not be read. */
  ruleCount: number | null;
  /** Whether the rules cover the given origin (`null` when unknown). */
  allowsOrigin: boolean | null;
  detail: string;
}

async function readJson(response: Response): Promise<any> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

/** Exchanges the key id + application key for a short-lived API token. */
export async function authorizeB2Account(): Promise<B2Authorization> {
  const keyId = (process.env.B2_KEY_ID || "").trim();
  const applicationKey = (process.env.B2_APPLICATION_KEY || "").trim();
  if (!keyId || !applicationKey) {
    throw new Error("B2_KEY_ID and B2_APPLICATION_KEY are required.");
  }

  const response = await fetch(AUTHORIZE_URL, {
    method: "GET",
    headers: {
      Authorization: `Basic ${Buffer.from(`${keyId}:${applicationKey}`).toString("base64")}`,
    },
    cache: "no-store",
  });

  const data = await readJson(response);
  if (!response.ok) {
    throw new Error(data?.message || `B2 authorization failed (HTTP ${response.status}).`);
  }

  const storageApi = data?.apiInfo?.storageApi || {};
  return {
    accountId: String(data?.accountId || ""),
    apiUrl: String(storageApi.apiUrl || ""),
    authorizationToken: String(data?.authorizationToken || ""),
    restrictedBucketId: storageApi.bucketId ? String(storageApi.bucketId) : null,
    capabilities: Array.isArray(storageApi.capabilities) ? storageApi.capabilities : [],
  };
}

/**
 * Reads the bucket's CORS rules and reports whether `origin` is covered.
 *
 * Never throws: an application key without the `listBuckets` capability is a
 * perfectly reasonable production setup, and "we could not check" must not be
 * reported as "CORS is broken".
 */
export async function getB2CorsStatus(origin?: string): Promise<B2CorsStatus> {
  const bucketName = (process.env.B2_BUCKET_NAME || "").trim();
  if (!bucketName) {
    return { ruleCount: null, allowsOrigin: null, detail: "B2_BUCKET_NAME is not set." };
  }

  try {
    const auth = await authorizeB2Account();

    const body: Record<string, string> = { accountId: auth.accountId };
    // A bucket-restricted key must be asked by id; a broader key can use the name.
    if (auth.restrictedBucketId) body.bucketId = auth.restrictedBucketId;
    else body.bucketName = bucketName;

    const response = await fetch(`${auth.apiUrl}/b2api/v3/b2_list_buckets`, {
      method: "POST",
      headers: {
        Authorization: auth.authorizationToken,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      cache: "no-store",
    });

    const data = await readJson(response);
    if (!response.ok) {
      return {
        ruleCount: null,
        allowsOrigin: null,
        detail: `CORS rules could not be read (${data?.code || response.status}). This is informational only — the application key may simply lack the "listBuckets" capability.`,
      };
    }

    const bucket = (data?.buckets || []).find((b: any) => b.bucketName === bucketName) || data?.buckets?.[0];
    const rules: any[] = Array.isArray(bucket?.corsRules) ? bucket.corsRules : [];

    if (rules.length === 0) {
      return {
        ruleCount: 0,
        allowsOrigin: false,
        detail: `Bucket "${bucketName}" has no CORS rules. Direct browser uploads will fail and fall back to the slower server proxy (4 MB limit). Run "npm run storage:cors".`,
      };
    }

    const allowsOrigin = origin
      ? rules.some((rule) => {
          const origins: string[] = Array.isArray(rule.allowedOrigins) ? rule.allowedOrigins : [];
          return origins.some((allowed) => allowed === "*" || allowed === origin || allowed === "https");
        })
      : null;

    return {
      ruleCount: rules.length,
      allowsOrigin,
      detail:
        allowsOrigin === false
          ? `Bucket "${bucketName}" has ${rules.length} CORS rule(s), but none allow ${origin}. Add it and re-run "npm run storage:cors".`
          : `Bucket "${bucketName}" — ${rules.length} CORS rule${rules.length === 1 ? "" : "s"} applied.`,
    };
  } catch (error: any) {
    return {
      ruleCount: null,
      allowsOrigin: null,
      detail: `CORS rules could not be read: ${error?.message || error}. Informational only — uploads still work through the server proxy.`,
    };
  }
}
