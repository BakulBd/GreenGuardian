/**
 * Shared bearer-token admin gate for server API routes.
 *
 * Thin wrapper over `requireAuthedUser` (lib/server/api-auth.ts) — that
 * helper already verifies the token, fails closed when the Admin SDK isn't
 * configured, loads the caller's `users/{uid}` doc, and rejects hold/
 * suspended accounts. This used to duplicate all of that logic inline; the
 * duplication had already drifted (this copy didn't reject a restricted
 * `action` message the same way `requireAuthedUser` does), which is exactly
 * the kind of inconsistency centralizing it avoids.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAuthedUser } from "@/lib/server/api-auth";

export interface AdminCaller {
  uid: string;
  name: string;
  email: string;
}

export async function requireAdmin(
  req: NextRequest,
  action = "perform this action"
): Promise<AdminCaller | NextResponse> {
  const result = await requireAuthedUser(req, ["admin"], `Only administrators can ${action}.`);
  if (result instanceof NextResponse) return result;

  return { uid: result.uid, name: result.name || "An administrator", email: result.email };
}
