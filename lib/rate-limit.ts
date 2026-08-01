/**
 * Lightweight in-memory sliding-window rate limiter (server-only).
 *
 * This is a best-effort burst limiter for API abuse prevention. It is not
 * shared across multiple serverless instances, so it is layered on top of the
 * persistent Firestore-based limits (per-email cooldown / max sends / max
 * verify attempts) rather than used as the only line of defense.
 */

const buckets = new Map<string, number[]>();

/**
 * Check + record a request for a key.
 * @param key    Unique identifier (e.g. IP, email).
 * @param max    Maximum number of requests allowed in the window.
 * @param windowMs  Window length in milliseconds.
 */
export function checkRateLimit(
  key: string,
  max: number,
  windowMs: number
): { allowed: boolean; retryAfterSeconds: number } {
  const now = Date.now();
  const timestamps = (buckets.get(key) || []).filter(
    (t) => now - t < windowMs
  );

  if (timestamps.length >= max) {
    const retryAfter = Math.max(
      1,
      Math.ceil((windowMs - (now - timestamps[0])) / 1000)
    );
    return { allowed: false, retryAfterSeconds: retryAfter };
  }

  timestamps.push(now);
  buckets.set(key, timestamps);
  return { allowed: true, retryAfterSeconds: 0 };
}

/** Get a client IP from the Next.js request headers (best effort). */
export function getClientIp(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return req.headers.get("x-real-ip") || "unknown";
}

