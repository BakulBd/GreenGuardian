/**
 * Telling "your session is bad" apart from "our server is broken".
 *
 * A misconfigured service-account credential makes `verifyIdToken()` throw, and
 * an endpoint that reports that as 401 "Invalid or expired session. Please sign
 * in again." sends the user to sign in repeatedly for a fault they cannot fix
 * — which is exactly what /api/ocr did before it was moved onto the shared
 * helper. These tests pin the mapping so that cannot come back.
 */
import { describe, it, expect } from "vitest";
import { tokenVerificationErrorResponse } from "@/lib/server/api-auth";
import { describeServiceAccountProblem } from "@/lib/firebase/admin";

const read = async (res: Response) => ({
  status: res.status,
  body: (await res.json()) as { success: boolean; error: string },
});

describe("tokenVerificationErrorResponse", () => {
  it("returns 401 for a genuinely expired or malformed user token", async () => {
    for (const code of [
      "auth/id-token-expired",
      "auth/id-token-revoked",
      "auth/argument-error",
      "auth/invalid-argument",
    ]) {
      const { status, body } = await read(tokenVerificationErrorResponse({ code }));
      expect(status, code).toBe(401);
      expect(body.error, code).toMatch(/sign in again/i);
    }
  });

  it("returns 503 and names the real fix for an unusable service-account credential", async () => {
    // The failure this whole test file exists for.
    const { status, body } = await read(
      tokenVerificationErrorResponse({
        code: "app/invalid-credential",
        message: "Failed to parse private key: Error: Invalid PEM formatted message.",
      })
    );

    expect(status).toBe(503);
    expect(body.error).toMatch(/misconfigured/i);
    expect(body.error).toMatch(/FIREBASE_SERVICE_ACCOUNT/);
    // Must NOT tell the user to sign in again — nothing they do fixes this.
    expect(body.error).not.toMatch(/sign in again/i);
    expect(body.error).toMatch(/will not help/i);
  });

  it("recognises the admin initializer's own error even without a code", async () => {
    const { status, body } = await read(
      tokenVerificationErrorResponse({
        message: "Firebase Admin SDK could not use any of the credentials it was given:\n  - ...",
      })
    );

    expect(status).toBe(503);
    expect(body.error).toMatch(/misconfigured/i);
  });

  it("falls back to a transient 503 for anything else", async () => {
    const { status, body } = await read(
      tokenVerificationErrorResponse({ code: "ECONNRESET", message: "socket hang up" })
    );

    expect(status).toBe(503);
    expect(body.error).toMatch(/temporarily unavailable/i);
    expect(body.error).not.toMatch(/sign in again/i);
  });
});

describe("describeServiceAccountProblem", () => {
  const err = new Error("Failed to parse private key: Error: Invalid PEM formatted message.");

  it("identifies a placeholder private key and says where to get a real one", () => {
    // Exactly the shape found in this project's .env.local: a well-formed PEM
    // envelope wrapped around a template string.
    const message = describeServiceAccountProblem(
      "FIREBASE_SERVICE_ACCOUNT",
      { private_key: "-----BEGIN PRIVATE KEY-----\nYOUR_PRIVATE_KEY\n-----END PRIVATE KEY-----\n" },
      err
    );

    expect(message).toMatch(/placeholder/i);
    expect(message).toMatch(/FIREBASE_SERVICE_ACCOUNT/);
    expect(message).toMatch(/Generate new private key/);
  });

  it("names a missing private_key field", () => {
    expect(describeServiceAccountProblem("src", { client_email: "a@b.c" }, err)).toMatch(
      /no "private_key" field/
    );
  });

  it("names a value that is not a PEM block at all", () => {
    expect(describeServiceAccountProblem("src", { private_key: "abc123" }, err)).toMatch(
      /not a PEM block/
    );
  });

  it("names a real key whose newlines were flattened", () => {
    const body = "A".repeat(1600);
    const message = describeServiceAccountProblem(
      "src",
      { private_key: `-----BEGIN PRIVATE KEY-----${body}-----END PRIVATE KEY-----` },
      err
    );

    expect(message).toMatch(/no line breaks/);
  });

  it("passes the underlying error through when the shape looks fine", () => {
    const body = "A".repeat(1600);
    const message = describeServiceAccountProblem(
      "src",
      { private_key: `-----BEGIN PRIVATE KEY-----\n${body}\n-----END PRIVATE KEY-----\n` },
      err
    );

    expect(message).toMatch(/Invalid PEM formatted message/);
  });
});
