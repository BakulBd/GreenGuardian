"use client";

import { useState } from "react";
import { KeyRound, X, Loader2, Copy, Check, Mail, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/components/ui/use-toast";
import { auth } from "@/lib/firebase/config";

interface ResetPasswordControlProps {
  userId: string;
  userName: string;
  userEmail: string;
}

/**
 * Admin control for recovering a user's account access. Shared by the students
 * and teachers admin pages.
 *
 * Two deliberately distinct options, because they carry different risk:
 *   - "Email reset link" is the default. The admin never sees the password and
 *     the user picks their own.
 *   - "Set temporary password" exists for users who cannot receive email (a
 *     mistyped address, a dead account). It is shown to the admin exactly once
 *     and is never stored anywhere readable, so it must be copied before the
 *     dialog closes.
 */
export default function ResetPasswordControl({
  userId,
  userName,
  userEmail,
}: ResetPasswordControlProps) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [tempPassword, setTempPassword] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const close = () => {
    setOpen(false);
    setTempPassword(null);
    setCopied(false);
  };

  const run = async (mode: "link" | "set") => {
    const currentUser = auth.currentUser;
    if (!currentUser) {
      toast({
        title: "Session expired",
        description: "Please sign in again.",
        variant: "destructive",
      });
      return;
    }

    setSubmitting(true);
    try {
      const token = await currentUser.getIdToken();
      const res = await fetch("/api/admin/reset-password", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ userId, mode }),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok || !data?.success) {
        throw new Error(
          data?.results?.[0]?.error || data?.error || "The reset could not be completed."
        );
      }

      if (mode === "set") {
        setTempPassword(data.results?.[0]?.temporaryPassword || null);
        toast({
          title: "Temporary password set",
          description: `Copy it now — it won't be shown again.`,
        });
      } else {
        toast({
          title: "Reset link sent",
          description: `${userName} will receive an email at ${userEmail}.`,
        });
        close();
      }
    } catch (error: any) {
      toast({
        title: "Reset failed",
        description: error?.message || "Something went wrong.",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const copy = async () => {
    if (!tempPassword) return;
    try {
      await navigator.clipboard.writeText(tempPassword);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast({
        title: "Couldn't copy",
        description: "Please select and copy the password manually.",
        variant: "destructive",
      });
    }
  };

  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <KeyRound className="h-3.5 w-3.5 mr-1" />
        Reset Password
      </Button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <Card className="w-full max-w-md bg-white shadow-2xl">
            <CardHeader className="flex flex-row items-center justify-between border-b pb-4">
              <CardTitle className="text-base">Reset {userName}&apos;s Password</CardTitle>
              <button
                onClick={close}
                className="text-gray-400 hover:text-gray-600"
                aria-label="Close"
              >
                <X className="h-5 w-5" />
              </button>
            </CardHeader>

            <CardContent className="pt-4 space-y-4">
              {tempPassword ? (
                <div className="space-y-3">
                  <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 flex gap-2">
                    <ShieldAlert className="h-4 w-4 shrink-0 mt-0.5" />
                    <span>
                      This password is shown once. Copy it and share it with {userName}{" "}
                      through a channel you trust. They&apos;ll be asked to change it after
                      signing in.
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 rounded-lg border bg-gray-50 px-3 py-2.5 font-mono text-sm tracking-wide break-all">
                      {tempPassword}
                    </code>
                    <Button size="sm" variant="outline" onClick={copy}>
                      {copied ? (
                        <Check className="h-4 w-4 text-green-600" />
                      ) : (
                        <Copy className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                  <div className="flex justify-end pt-1">
                    <Button onClick={close}>Done</Button>
                  </div>
                </div>
              ) : (
                <>
                  <p className="text-sm text-gray-600">
                    Choose how {userName} should regain access to their account.
                  </p>

                  <button
                    type="button"
                    disabled={submitting}
                    onClick={() => run("link")}
                    className="w-full text-left rounded-lg border p-3.5 hover:border-green-400 hover:bg-green-50/50 transition-colors disabled:opacity-60"
                  >
                    <div className="flex items-start gap-3">
                      <Mail className="h-5 w-5 text-green-600 shrink-0 mt-0.5" />
                      <div>
                        <div className="font-medium text-sm">Email a reset link</div>
                        <div className="text-xs text-gray-500 mt-0.5 leading-relaxed">
                          Sends a one-hour link to{" "}
                          <span className="font-medium">{userEmail || "their address"}</span>.
                          They choose their own new password. Recommended.
                        </div>
                      </div>
                    </div>
                  </button>

                  <button
                    type="button"
                    disabled={submitting}
                    onClick={() => {
                      if (
                        confirm(
                          `Immediately replace ${userName}'s password with a temporary one? Their current password stops working right away.`
                        )
                      ) {
                        run("set");
                      }
                    }}
                    className="w-full text-left rounded-lg border p-3.5 hover:border-amber-400 hover:bg-amber-50/50 transition-colors disabled:opacity-60"
                  >
                    <div className="flex items-start gap-3">
                      <KeyRound className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
                      <div>
                        <div className="font-medium text-sm">Set a temporary password</div>
                        <div className="text-xs text-gray-500 mt-0.5 leading-relaxed">
                          For users who can&apos;t receive email. Shown to you once, and
                          their existing password stops working immediately.
                        </div>
                      </div>
                    </div>
                  </button>

                  {submitting && (
                    <div className="flex items-center justify-center gap-2 text-sm text-gray-500 pt-1">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Working...
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </>
  );
}
