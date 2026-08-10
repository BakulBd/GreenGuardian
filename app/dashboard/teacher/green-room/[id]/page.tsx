"use client";

/**
 * Teacher → Green Room → class detail.
 *
 * Shows the invite credentials (host only) and the attendance record. The
 * passcode arrives from `/api/greenroom/meetings/[id]`, which only includes it
 * for the host — it is not derivable client-side, by design.
 */
import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  Copy,
  Video,
  Loader2,
  Eye,
  EyeOff,
  CheckCircle2,
  MinusCircle,
  XCircle,
} from "lucide-react";
import DashboardLayout from "@/components/layouts/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { getMeetingDetail, MeetingDetail } from "@/lib/greenroom/client";
import { buildInviteText, buildJoinUrl, formatDuration, toMillis } from "@/lib/greenroom/codes";
import { AttendanceRow } from "@/lib/greenroom/types";

const STATUS_STYLE: Record<AttendanceRow["status"], { label: string; className: string; Icon: typeof CheckCircle2 }> = {
  present: { label: "Present", className: "bg-emerald-100 text-emerald-700", Icon: CheckCircle2 },
  partial: { label: "Partial", className: "bg-amber-100 text-amber-700", Icon: MinusCircle },
  absent: { label: "Absent", className: "bg-red-100 text-red-700", Icon: XCircle },
};

export default function GreenRoomDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { user } = useAuth();
  const { toast } = useToast();

  const meetingId = String(params?.id || "");
  const [detail, setDetail] = useState<MeetingDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showPasscode, setShowPasscode] = useState(false);

  const load = useCallback(async () => {
    try {
      setDetail(await getMeetingDetail(meetingId));
    } catch (err: any) {
      // Surface the server's own message: 403 "only the host", 404 "not found"
      // and a session error all need to read differently to the teacher.
      setError(err?.message || "Could not load this class.");
    } finally {
      setLoading(false);
    }
  }, [meetingId]);

  useEffect(() => {
    if (!user || !meetingId) return;
    load();
  }, [user, meetingId, load]);

  const copyInvite = async () => {
    if (!detail) return;
    const text = buildInviteText({
      title: detail.meeting.title,
      meetingCode: detail.meeting.meetingCode,
      passcode: detail.passcode || "(ask the host)",
      origin: window.location.origin,
      scheduledStart: new Date(toMillis(detail.meeting.scheduledStart)),
      teacherName: detail.meeting.teacherName,
    });
    try {
      await navigator.clipboard.writeText(text);
      toast({ title: "Invitation copied" });
    } catch {
      toast({ title: "Could not copy", variant: "destructive" });
    }
  };

  if (loading) {
    return (
      <DashboardLayout role="teacher">
        <div className="flex justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-emerald-600" aria-hidden="true" />
          <span className="sr-only">Loading class</span>
        </div>
      </DashboardLayout>
    );
  }

  if (error || !detail) {
    return (
      <DashboardLayout role="teacher">
        <div className="py-16 text-center">
          <p className="text-gray-600">{error || "Class not found."}</p>
          <Link href="/dashboard/teacher/green-room">
            <Button className="mt-4 bg-emerald-600 hover:bg-emerald-700">Back to Green Room</Button>
          </Link>
        </div>
      </DashboardLayout>
    );
  }

  const { meeting, attendance = [] } = detail;
  const present = attendance.filter((a) => a.status === "present").length;

  return (
    <DashboardLayout role="teacher">
      <div className="space-y-5">
        <div>
          <Link
            href="/dashboard/teacher/green-room"
            className="inline-flex items-center text-sm text-gray-500 hover:text-gray-700"
          >
            <ArrowLeft className="mr-1 h-4 w-4" aria-hidden="true" />
            Green Room
          </Link>
          <h1 className="mt-2 text-2xl font-bold text-gray-900">{meeting.title}</h1>
          {meeting.description && <p className="mt-1 text-sm text-gray-600">{meeting.description}</p>}
        </div>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Invitation</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <dl className="grid gap-3 sm:grid-cols-3">
              <div>
                <dt className="text-xs text-gray-500">Meeting ID</dt>
                <dd className="font-mono text-sm text-gray-900">{meeting.meetingCode}</dd>
              </div>
              <div>
                <dt className="text-xs text-gray-500">Passcode</dt>
                <dd className="flex items-center gap-2 font-mono text-sm text-gray-900">
                  {detail.passcode ? (
                    <>
                      <span>{showPasscode ? detail.passcode : "••••••"}</span>
                      <button
                        type="button"
                        onClick={() => setShowPasscode((v) => !v)}
                        aria-label={showPasscode ? "Hide passcode" : "Show passcode"}
                        className="rounded p-0.5 text-gray-400 hover:text-gray-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
                      >
                        {showPasscode ? (
                          <EyeOff className="h-4 w-4" aria-hidden="true" />
                        ) : (
                          <Eye className="h-4 w-4" aria-hidden="true" />
                        )}
                      </button>
                    </>
                  ) : (
                    <span className="text-gray-400">Host only</span>
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-gray-500">Status</dt>
                <dd className="text-sm capitalize text-gray-900">{meeting.status}</dd>
              </div>
            </dl>

            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={copyInvite}>
                <Copy className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                Copy invitation
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  navigator.clipboard
                    ?.writeText(buildJoinUrl(window.location.origin, meeting.meetingCode))
                    .then(() => toast({ title: "Link copied" }))
                    .catch(() => toast({ title: "Could not copy", variant: "destructive" }));
                }}
              >
                <Copy className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                Copy link
              </Button>
              {meeting.status !== "ended" && meeting.status !== "cancelled" && (
                <Button
                  size="sm"
                  className="bg-emerald-600 hover:bg-emerald-700"
                  onClick={() => router.push(`/green-room/${meeting.meetingCode}`)}
                >
                  <Video className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                  {meeting.status === "live" ? "Rejoin" : "Start"}
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">
              Attendance{" "}
              <span className="font-normal text-gray-500">
                ({present} present of {attendance.length})
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {attendance.length === 0 ? (
              <p className="py-6 text-center text-sm text-gray-500">
                Nobody has joined this class yet.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <caption className="sr-only">Attendance for {meeting.title}</caption>
                  <thead>
                    <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-500">
                      <th scope="col" className="py-2 pr-3 font-medium">Student</th>
                      <th scope="col" className="py-2 pr-3 font-medium">Joined</th>
                      <th scope="col" className="py-2 pr-3 font-medium">Time in class</th>
                      <th scope="col" className="py-2 pr-3 font-medium">Reconnects</th>
                      <th scope="col" className="py-2 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {attendance.map((row) => {
                      const style = STATUS_STYLE[row.status];
                      const joined = toMillis(row.firstJoinedAt);
                      return (
                        <tr key={row.userId} className="border-b border-gray-100 last:border-0">
                          <td className="py-2 pr-3">
                            <span className="font-medium text-gray-900">{row.name}</span>
                            {row.email && (
                              <span className="block text-xs text-gray-500">{row.email}</span>
                            )}
                          </td>
                          <td className="py-2 pr-3 text-gray-600">
                            {joined ? new Date(joined).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—"}
                          </td>
                          <td className="py-2 pr-3 text-gray-600">
                            {formatDuration(row.totalDurationMs)}
                          </td>
                          <td className="py-2 pr-3 text-gray-600">{row.reconnects || 0}</td>
                          <td className="py-2">
                            <Badge className={style.className}>
                              <style.Icon className="mr-1 h-3 w-3" aria-hidden="true" />
                              {style.label}
                            </Badge>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
