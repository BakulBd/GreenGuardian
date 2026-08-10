"use client";

/**
 * Teacher → Green Room.
 *
 * Lists the teacher's classes split by upcoming / live / past, and is where
 * instant and scheduled classes are created. The passcode is shown here right
 * after creation and on demand from the detail view — it is never stored in a
 * form the browser can read on its own (see /api/greenroom/meetings).
 */
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Video,
  Plus,
  Zap,
  Calendar,
  Clock,
  Users,
  Copy,
  Pencil,
  Trash2,
  Loader2,
  Radio,
  ChevronRight,
} from "lucide-react";
import DashboardLayout from "@/components/layouts/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import ScheduleMeetingDialog from "@/components/greenroom/ScheduleMeetingDialog";
import {
  createMeeting,
  listMeetings,
  updateMeeting,
  cancelMeeting,
} from "@/lib/greenroom/client";
import { buildInviteText, buildJoinUrl, toMillis } from "@/lib/greenroom/codes";
import { Meeting, MeetingSettings } from "@/lib/greenroom/types";

type Tab = "upcoming" | "past";

function formatWhen(value: any): string {
  const ms = toMillis(value);
  if (!ms) return "—";
  return new Date(ms).toLocaleString([], {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function TeacherGreenRoomPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const router = useRouter();

  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("upcoming");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Meeting | null>(null);
  const [saving, setSaving] = useState(false);
  const [startingInstant, setStartingInstant] = useState(false);

  const load = useCallback(async () => {
    try {
      setMeetings(await listMeetings());
    } catch (error: any) {
      toast({ title: "Could not load classes", description: error?.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    if (!user) return;
    load();
  }, [user, load]);

  const live = meetings.filter((m) => m.status === "live");
  const upcoming = meetings
    .filter((m) => m.status === "scheduled")
    .sort((a, b) => toMillis(a.scheduledStart) - toMillis(b.scheduledStart));
  const past = meetings.filter((m) => m.status === "ended" || m.status === "cancelled");

  const shareInvite = async (meeting: Meeting) => {
    const url = buildJoinUrl(window.location.origin, meeting.meetingCode);
    try {
      await navigator.clipboard.writeText(url);
      toast({ title: "Invite link copied", description: url });
    } catch {
      toast({ title: "Could not copy the link", variant: "destructive" });
    }
  };

  const startInstant = async () => {
    setStartingInstant(true);
    try {
      const { meeting, passcode } = await createMeeting({
        title: `${user?.name || "Teacher"}'s class`,
        durationMinutes: 60,
        instant: true,
      });
      toast({
        title: "Class started",
        description: `Meeting ID ${meeting.meetingCode} · Passcode ${passcode}`,
      });
      router.push(`/green-room/${meeting.meetingCode}`);
    } catch (error: any) {
      toast({ title: "Could not start the class", description: error?.message, variant: "destructive" });
    } finally {
      setStartingInstant(false);
    }
  };

  const handleSubmit = async (values: {
    title: string;
    description: string;
    scheduledStart: string;
    durationMinutes: number;
    settings: MeetingSettings;
  }) => {
    setSaving(true);
    try {
      if (editing) {
        await updateMeeting(editing.id, values);
        toast({ title: "Class updated" });
      } else {
        const { meeting, passcode } = await createMeeting(values);
        // The passcode is shown exactly once at creation; the invite text
        // below is the teacher's chance to capture it.
        toast({
          title: "Class scheduled",
          description: `Meeting ID ${meeting.meetingCode} · Passcode ${passcode}`,
        });
        await navigator.clipboard
          ?.writeText(
            buildInviteText({
              title: meeting.title,
              meetingCode: meeting.meetingCode,
              passcode,
              origin: window.location.origin,
              scheduledStart: new Date(toMillis(meeting.scheduledStart)),
              teacherName: user?.name,
            })
          )
          .catch(() => {});
      }
      setDialogOpen(false);
      setEditing(null);
      await load();
    } catch (error: any) {
      toast({ title: "Could not save the class", description: error?.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = async (meeting: Meeting) => {
    if (!confirm(`Cancel "${meeting.title}"? Students will see it as cancelled.`)) return;
    try {
      await cancelMeeting(meeting.id);
      toast({ title: "Class cancelled" });
      await load();
    } catch (error: any) {
      toast({ title: "Could not cancel", description: error?.message, variant: "destructive" });
    }
  };

  const MeetingCard = ({ meeting }: { meeting: Meeting }) => {
    const isLive = meeting.status === "live";
    const isCancelled = meeting.status === "cancelled";

    return (
      <Card className="transition hover:shadow-md">
        <CardContent className="p-4">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <h3 className="truncate font-semibold text-gray-900">{meeting.title}</h3>
              <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500">
                <span className="inline-flex items-center gap-1">
                  <Calendar className="h-3.5 w-3.5" aria-hidden="true" />
                  {formatWhen(meeting.scheduledStart)}
                </span>
                <span className="inline-flex items-center gap-1">
                  <Clock className="h-3.5 w-3.5" aria-hidden="true" />
                  {meeting.durationMinutes} min
                </span>
                <span className="font-mono">{meeting.meetingCode}</span>
              </p>
            </div>

            {isLive && (
              <Badge className="shrink-0 bg-red-100 text-red-700">
                <Radio className="mr-1 h-3 w-3 animate-pulse" aria-hidden="true" />
                Live
              </Badge>
            )}
            {isCancelled && <Badge className="shrink-0 bg-gray-100 text-gray-600">Cancelled</Badge>}
          </div>

          {meeting.description && (
            <p className="mt-2 line-clamp-2 text-sm text-gray-600">{meeting.description}</p>
          )}

          <div className="mt-3 flex flex-wrap gap-2">
            {!isCancelled && meeting.status !== "ended" && (
              <Button
                size="sm"
                className="bg-emerald-600 hover:bg-emerald-700"
                onClick={() => router.push(`/green-room/${meeting.meetingCode}`)}
              >
                <Video className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                {isLive ? "Rejoin" : "Start"}
              </Button>
            )}

            <Button size="sm" variant="outline" onClick={() => shareInvite(meeting)}>
              <Copy className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
              Invite
            </Button>

            <Link href={`/dashboard/teacher/green-room/${meeting.id}`}>
              <Button size="sm" variant="outline">
                <Users className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                Details
              </Button>
            </Link>

            {meeting.status === "scheduled" && (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setEditing(meeting);
                    setDialogOpen(true);
                  }}
                  aria-label={`Edit ${meeting.title}`}
                >
                  <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="text-red-600 hover:bg-red-50"
                  onClick={() => handleCancel(meeting)}
                  aria-label={`Cancel ${meeting.title}`}
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                </Button>
              </>
            )}
          </div>
        </CardContent>
      </Card>
    );
  };

  return (
    <DashboardLayout role="teacher">
      <div className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Green Room</h1>
            <p className="text-sm text-gray-500">Run live classes with your students.</p>
          </div>
          <div className="flex gap-2">
            <Button
              onClick={startInstant}
              disabled={startingInstant}
              className="bg-emerald-600 hover:bg-emerald-700"
            >
              {startingInstant ? (
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <Zap className="mr-1.5 h-4 w-4" aria-hidden="true" />
              )}
              Start now
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                setEditing(null);
                setDialogOpen(true);
              }}
            >
              <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" />
              Schedule
            </Button>
          </div>
        </div>

        {live.length > 0 && (
          <section aria-labelledby="live-heading">
            <h2 id="live-heading" className="mb-2 text-sm font-semibold text-gray-700">
              Live now
            </h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {live.map((m) => (
                <MeetingCard key={m.id} meeting={m} />
              ))}
            </div>
          </section>
        )}

        <div className="flex gap-1 border-b border-gray-200" role="tablist">
          {(["upcoming", "past"] as Tab[]).map((value) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={tab === value}
              onClick={() => setTab(value)}
              className={`px-4 py-2 text-sm font-medium capitalize transition ${
                tab === value
                  ? "border-b-2 border-emerald-600 text-emerald-700"
                  : "text-gray-500 hover:text-gray-700"
              }`}
            >
              {value} ({value === "upcoming" ? upcoming.length : past.length})
            </button>
          ))}
        </div>

        {loading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-emerald-600" aria-hidden="true" />
            <span className="sr-only">Loading classes</span>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {(tab === "upcoming" ? upcoming : past).map((m) => (
              <MeetingCard key={m.id} meeting={m} />
            ))}
          </div>
        )}

        {!loading && (tab === "upcoming" ? upcoming : past).length === 0 && live.length === 0 && (
          <Card>
            <CardContent className="py-12 text-center">
              <Video className="mx-auto h-10 w-10 text-gray-300" aria-hidden="true" />
              <p className="mt-3 font-medium text-gray-900">
                {tab === "upcoming" ? "No classes scheduled" : "No past classes yet"}
              </p>
              <p className="mt-1 text-sm text-gray-500">
                {tab === "upcoming"
                  ? "Start an instant class, or schedule one for later."
                  : "Classes you finish will appear here with attendance."}
              </p>
            </CardContent>
          </Card>
        )}
      </div>

      <ScheduleMeetingDialog
        open={dialogOpen}
        saving={saving}
        existing={editing}
        onClose={() => {
          setDialogOpen(false);
          setEditing(null);
        }}
        onSubmit={handleSubmit}
      />
    </DashboardLayout>
  );
}
