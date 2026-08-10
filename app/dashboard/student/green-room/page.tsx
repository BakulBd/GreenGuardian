"use client";

/**
 * Student → Green Room.
 *
 * Two ways in, because both happen in practice: click an upcoming class the
 * teacher scheduled, or type a Meeting ID that arrived by email/chat. Both
 * land on the same `/green-room/[code]` route, which handles the passcode and
 * eligibility checks server-side.
 */
import { FormEvent, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Video, Calendar, Clock, LogIn, Loader2, Radio, User } from "lucide-react";
import DashboardLayout from "@/components/layouts/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { listMeetings } from "@/lib/greenroom/client";
import { normalizeMeetingCode, toMillis } from "@/lib/greenroom/codes";
import { Meeting } from "@/lib/greenroom/types";

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

export default function StudentGreenRoomPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const router = useRouter();

  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [loading, setLoading] = useState(true);
  const [codeInput, setCodeInput] = useState("");
  const [tab, setTab] = useState<"upcoming" | "past">("upcoming");

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
  const past = meetings.filter((m) => m.status === "ended");

  const joinByCode = (event: FormEvent) => {
    event.preventDefault();
    const normalized = normalizeMeetingCode(codeInput);
    if (!normalized) {
      toast({
        title: "Check the Meeting ID",
        description: "A Meeting ID looks like 123-456-789.",
        variant: "destructive",
      });
      return;
    }
    router.push(`/green-room/${normalized}`);
  };

  const ClassCard = ({ meeting }: { meeting: Meeting }) => {
    const isLive = meeting.status === "live";
    return (
      <Card className="transition hover:shadow-md">
        <CardContent className="p-4">
          <div className="flex items-start justify-between gap-2">
            <h3 className="min-w-0 flex-1 truncate font-semibold text-gray-900">{meeting.title}</h3>
            {isLive && (
              <Badge className="shrink-0 bg-red-100 text-red-700">
                <Radio className="mr-1 h-3 w-3 animate-pulse" aria-hidden="true" />
                Live
              </Badge>
            )}
          </div>

          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500">
            <span className="inline-flex items-center gap-1">
              <User className="h-3.5 w-3.5" aria-hidden="true" />
              {meeting.teacherName}
            </span>
            <span className="inline-flex items-center gap-1">
              <Calendar className="h-3.5 w-3.5" aria-hidden="true" />
              {formatWhen(meeting.scheduledStart)}
            </span>
            <span className="inline-flex items-center gap-1">
              <Clock className="h-3.5 w-3.5" aria-hidden="true" />
              {meeting.durationMinutes} min
            </span>
          </p>

          {meeting.description && (
            <p className="mt-2 line-clamp-2 text-sm text-gray-600">{meeting.description}</p>
          )}

          {meeting.status !== "ended" && (
            <Button
              size="sm"
              className="mt-3 bg-emerald-600 hover:bg-emerald-700"
              onClick={() => router.push(`/green-room/${meeting.meetingCode}`)}
            >
              <Video className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
              {isLive ? "Join now" : "Join"}
            </Button>
          )}
        </CardContent>
      </Card>
    );
  };

  return (
    <DashboardLayout role="student">
      <div className="space-y-5">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Green Room</h1>
          <p className="text-sm text-gray-500">Join your live classes.</p>
        </div>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Join with a Meeting ID</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={joinByCode} className="flex flex-wrap items-end gap-2">
              <div className="min-w-[12rem] flex-1">
                <Label htmlFor="meeting-code">Meeting ID</Label>
                <Input
                  id="meeting-code"
                  value={codeInput}
                  onChange={(e) => setCodeInput(e.target.value)}
                  placeholder="123-456-789"
                  inputMode="numeric"
                  autoComplete="off"
                />
              </div>
              <Button type="submit" className="bg-emerald-600 hover:bg-emerald-700">
                <LogIn className="mr-1.5 h-4 w-4" aria-hidden="true" />
                Join
              </Button>
            </form>
            <p className="mt-2 text-xs text-gray-500">
              You&apos;ll be asked for the passcode your teacher shared.
            </p>
          </CardContent>
        </Card>

        {live.length > 0 && (
          <section aria-labelledby="live-now">
            <h2 id="live-now" className="mb-2 text-sm font-semibold text-gray-700">
              Happening now
            </h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {live.map((m) => (
                <ClassCard key={m.id} meeting={m} />
              ))}
            </div>
          </section>
        )}

        <div className="flex gap-1 border-b border-gray-200" role="tablist">
          {(["upcoming", "past"] as const).map((value) => (
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
          <>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {(tab === "upcoming" ? upcoming : past).map((m) => (
                <ClassCard key={m.id} meeting={m} />
              ))}
            </div>

            {(tab === "upcoming" ? upcoming : past).length === 0 && live.length === 0 && (
              <Card>
                <CardContent className="py-12 text-center">
                  <Video className="mx-auto h-10 w-10 text-gray-300" aria-hidden="true" />
                  <p className="mt-3 font-medium text-gray-900">
                    {tab === "upcoming" ? "No upcoming classes" : "No past classes"}
                  </p>
                  <p className="mt-1 text-sm text-gray-500">
                    Classes your teachers schedule will appear here. You can also join with a
                    Meeting ID above.
                  </p>
                </CardContent>
              </Card>
            )}
          </>
        )}
      </div>
    </DashboardLayout>
  );
}
