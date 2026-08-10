"use client";

/**
 * Browser helper for calling this app's authenticated API routes.
 *
 * Every protected route expects a Firebase ID token as a bearer credential.
 * Centralising that here keeps the call sites free of token plumbing and makes
 * failures surface as a real message from the server rather than an opaque
 * "fetch failed".
 */

import { auth } from "@/lib/firebase/config";
import type { User as FirebaseUser } from "firebase/auth";

export interface AuthedRequestOptions {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  /**
   * JSON-serialised, unless it is a `FormData` — which is passed through
   * untouched so the browser can set its own `multipart/form-data` boundary.
   * Setting `Content-Type` by hand for a FormData body produces a boundary-less
   * header the server cannot parse.
   */
  body?: unknown;
  /** Message used when the server sends no error of its own. */
  fallbackError?: string;
  /** Aborts the request when the caller navigates away mid-flight. */
  signal?: AbortSignal;
  /** Lets the browser finish the request after the page starts unloading. */
  keepalive?: boolean;
}

/**
 * Resolves the signed-in user, waiting for Firebase to restore the persisted
 * session first.
 *
 * `auth.currentUser` is `null` for the first few hundred milliseconds after a
 * page load — persistence is restored asynchronously — so reading it directly
 * made any call fired from a mount effect fail with "You must be signed in".
 * That is exactly the shape of the `/api/exams/paper` failure: the exam page
 * loads (or the student refreshes mid-exam), the paper fetch races session
 * restoration, and the user is told their session is invalid when it is not.
 */
async function currentUser(): Promise<FirebaseUser> {
  if (auth.currentUser) return auth.currentUser;

  // `authStateReady` resolves once persistence has been read. It exists from
  // firebase-js-sdk v10.7; fall back to a one-shot listener on older builds.
  if (typeof (auth as any).authStateReady === "function") {
    await (auth as any).authStateReady();
  } else {
    await new Promise<void>((resolve) => {
      const unsubscribe = auth.onAuthStateChanged(() => {
        unsubscribe();
        resolve();
      });
    });
  }

  if (!auth.currentUser) {
    throw new Error("You must be signed in to do that.");
  }
  return auth.currentUser;
}

async function readJson(response: Response): Promise<any> {
  try {
    return await response.json();
  } catch {
    // Non-JSON response (proxy error page, gateway timeout, …).
    return null;
  }
}

export async function authedFetch<T>(
  path: string,
  { method = "GET", body, fallbackError, signal, keepalive }: AuthedRequestOptions = {}
): Promise<T> {
  const user = await currentUser();

  const isFormData = typeof FormData !== "undefined" && body instanceof FormData;

  const send = async (forceRefresh: boolean): Promise<Response> => {
    const token = await user.getIdToken(forceRefresh);
    return fetch(path, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body !== undefined && !isFormData ? { "Content-Type": "application/json" } : {}),
      },
      ...(body !== undefined ? { body: isFormData ? (body as FormData) : JSON.stringify(body) } : {}),
      ...(signal ? { signal } : {}),
      ...(keepalive ? { keepalive: true } : {}),
    });
  };

  let response = await send(false);

  // A cached ID token can be expired or minted before a token revocation, and
  // the SDK only refreshes it on its own schedule. Rather than telling the user
  // to sign in again — which is what made this look like a broken session — mint
  // a fresh token and retry exactly once. A genuinely invalid session fails the
  // retry too and reports honestly.
  if (response.status === 401) {
    response = await send(true);
  }

  const data = await readJson(response);

  if (!response.ok) {
    throw new Error(
      data?.error || fallbackError || `Request failed (${response.status}). Please try again.`
    );
  }

  return data as T;
}
