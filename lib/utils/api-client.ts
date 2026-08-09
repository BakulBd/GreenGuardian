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

export interface AuthedRequestOptions {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  /** Message used when the server sends no error of its own. */
  fallbackError?: string;
}

export async function authedFetch<T>(
  path: string,
  { method = "GET", body, fallbackError }: AuthedRequestOptions = {}
): Promise<T> {
  const currentUser = auth.currentUser;
  if (!currentUser) {
    throw new Error("You must be signed in to do that.");
  }

  const token = await currentUser.getIdToken();
  const response = await fetch(path, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });

  let data: any = null;
  try {
    data = await response.json();
  } catch {
    // Non-JSON response (proxy error page, gateway timeout, …).
  }

  if (!response.ok) {
    throw new Error(
      data?.error || fallbackError || `Request failed (${response.status}). Please try again.`
    );
  }

  return data as T;
}
