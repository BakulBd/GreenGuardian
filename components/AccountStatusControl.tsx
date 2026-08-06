"use client";

import { useState } from "react";
import { PauseCircle, Ban, PlayCircle, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { setUserStatus } from "@/lib/firebase/auth";
import { UserStatus } from "@/lib/types";

interface AccountStatusControlProps {
  userId: string;
  userName: string;
  status?: UserStatus;
  onChanged: () => void;
}

const STATUS_LABEL: Record<UserStatus, string> = {
  active: "Active",
  hold: "On Hold",
  suspended: "Suspended",
};

/**
 * Admin control for putting a student or teacher account on hold, suspending
 * it, or reactivating it. Shared by the students and teachers admin pages.
 */
export default function AccountStatusControl({ userId, userName, status, onChanged }: AccountStatusControlProps) {
  const { user: admin } = useAuth();
  const { toast } = useToast();
  const [pendingAction, setPendingAction] = useState<Exclude<UserStatus, "active"> | null>(null);
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const effectiveStatus: UserStatus = status || "active";

  const applyStatus = async (next: UserStatus, nextReason?: string) => {
    if (!admin) return;
    setSubmitting(true);
    try {
      await setUserStatus(userId, next, admin.id, nextReason);
      toast({
        title: `Account ${STATUS_LABEL[next]}`,
        description: `${userName}'s account is now ${STATUS_LABEL[next].toLowerCase()}.`,
      });
      setPendingAction(null);
      setReason("");
      onChanged();
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to update account status",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleActivate = () => {
    if (!confirm(`Reactivate ${userName}'s account? They will be able to log in immediately.`)) return;
    applyStatus("active");
  };

  return (
    <>
      <div className="flex flex-wrap items-center justify-end gap-1.5">
        <Badge
          variant={
            effectiveStatus === "active" ? "default" : effectiveStatus === "hold" ? "secondary" : "destructive"
          }
          className={effectiveStatus === "hold" ? "bg-yellow-100 text-yellow-800 border-yellow-200" : ""}
        >
          {STATUS_LABEL[effectiveStatus]}
        </Badge>
        {effectiveStatus !== "hold" && (
          <Button size="sm" variant="outline" onClick={() => setPendingAction("hold")} disabled={submitting}>
            <PauseCircle className="h-3.5 w-3.5 mr-1" />
            Hold
          </Button>
        )}
        {effectiveStatus !== "suspended" && (
          <Button size="sm" variant="destructive" onClick={() => setPendingAction("suspended")} disabled={submitting}>
            <Ban className="h-3.5 w-3.5 mr-1" />
            Suspend
          </Button>
        )}
        {effectiveStatus !== "active" && (
          <Button size="sm" variant="outline" onClick={handleActivate} disabled={submitting}>
            <PlayCircle className="h-3.5 w-3.5 mr-1" />
            Activate
          </Button>
        )}
      </div>

      {pendingAction && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <Card className="w-full max-w-sm bg-white shadow-2xl">
            <CardHeader className="flex flex-row items-center justify-between border-b pb-4">
              <CardTitle className="text-base">
                {pendingAction === "suspended" ? "Suspend" : "Hold"} {userName}&apos;s Account
              </CardTitle>
              <button onClick={() => setPendingAction(null)} className="text-gray-400 hover:text-gray-600">
                <X className="h-5 w-5" />
              </button>
            </CardHeader>
            <CardContent className="pt-4 space-y-3">
              <p className="text-sm text-gray-600">
                {userName} will be signed out immediately and unable to log in until reactivated.
              </p>
              <Textarea
                placeholder="Reason (optional, shown to the user)"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={3}
              />
              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="outline" onClick={() => setPendingAction(null)} disabled={submitting}>
                  Cancel
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  onClick={() => applyStatus(pendingAction, reason.trim() || undefined)}
                  disabled={submitting}
                >
                  Confirm {pendingAction === "suspended" ? "Suspend" : "Hold"}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </>
  );
}
