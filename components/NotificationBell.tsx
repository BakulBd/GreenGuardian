"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Bell, Check, FileText, Megaphone, School, Award, AlertTriangle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  subscribeToNotifications,
  markNotificationRead,
  markAllNotificationsRead,
} from "@/lib/firebase/notices";
import { Notification, NotificationType } from "@/lib/types";

/**
 * Notification bell with a real dropdown.
 *
 * Replaces a plain <Link href="/dashboard/student/notices"> whose badge could
 * never clear: the count comes from the `notifications` collection, but the
 * notices pages only ever wrote `noticeReads`, so reading every notice left
 * the badge stuck. Clicking an item here marks THAT notification read and
 * routes by type — exam and classroom notifications previously dumped the
 * student on the Notices list, where the item didn't exist.
 */

const TYPE_ICONS: Record<string, typeof Bell> = {
  notice: Megaphone,
  exam: FileText,
  classroom: School,
  result: Award,
  warning: AlertTriangle,
  general: Bell,
};

/** Where each notification type should take the user when clicked. */
function routeFor(n: Notification): string {
  switch (n.type as NotificationType) {
    case "exam":
      return n.examId ? `/exam/${n.examId}` : "/exam";
    case "classroom":
      return n.classroomId
        ? `/dashboard/student/classrooms/${n.classroomId}`
        : "/dashboard/student/classrooms";
    case "result":
      return n.resultId
        ? `/dashboard/student/results/${n.resultId}`
        : "/dashboard/student/results";
    case "warning":
      return "/dashboard/student/results";
    case "notice":
      return n.noticeId
        ? `/dashboard/student/notices/${n.noticeId}`
        : "/dashboard/student/notices";
    default:
      return "/dashboard/student/notices";
  }
}

function timeAgo(value: any): string {
  const d = value?.toDate ? value.toDate() : value ? new Date(value) : null;
  if (!d || Number.isNaN(d.getTime())) return "";
  const secs = Math.floor((Date.now() - d.getTime()) / 1000);
  if (secs < 60) return "just now";
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  if (secs < 604800) return `${Math.floor(secs / 86400)}d ago`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export default function NotificationBell({ userId }: { userId: string }) {
  const router = useRouter();
  const [items, setItems] = useState<Notification[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!userId) return;
    const unsub = subscribeToNotifications(userId, setItems);
    return () => unsub();
  }, [userId]);

  // Close on outside click / Escape — the previous user dropdown in this app
  // had neither, and stayed open until a route change.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const unread = items.filter((n) => !n.read);
  const unreadCount = unread.length;

  const handleOpen = async (n: Notification) => {
    setOpen(false);
    if (!n.read) {
      markNotificationRead(n.id).catch((err) =>
        console.warn("[NotificationBell] Failed to mark read:", err)
      );
    }
    router.push(routeFor(n));
  };

  const handleMarkAll = async () => {
    if (unreadCount === 0) return;
    setBusy(true);
    try {
      await markAllNotificationsRead(userId);
    } catch (err) {
      console.warn("[NotificationBell] Mark-all failed:", err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative" ref={containerRef}>
      <Button
        variant="ghost"
        size="sm"
        className="relative"
        onClick={() => setOpen((v) => !v)}
        aria-label={
          unreadCount > 0 ? `Notifications, ${unreadCount} unread` : "Notifications"
        }
        aria-expanded={open}
        aria-haspopup="menu"
      >
        <Bell className="h-5 w-5" />
        {unreadCount > 0 && (
          <span
            aria-hidden="true"
            className="absolute -top-1 -right-1 bg-red-500 text-white text-xs font-bold rounded-full h-4 min-w-[16px] flex items-center justify-center px-1"
          >
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </Button>

      {open && (
        <div
          role="menu"
          aria-label="Notifications"
          className="absolute right-0 mt-2 w-[min(22rem,calc(100vw-2rem))] bg-white rounded-xl shadow-2xl border border-gray-200 z-50 overflow-hidden"
        >
          <div className="flex items-center justify-between px-4 py-3 border-b bg-gray-50/80">
            <p className="text-sm font-semibold text-gray-900">
              Notifications
              {unreadCount > 0 && (
                <span className="ml-2 text-xs font-medium text-emerald-700">{unreadCount} new</span>
              )}
            </p>
            {unreadCount > 0 && (
              <button
                onClick={handleMarkAll}
                disabled={busy}
                className="text-xs font-medium text-emerald-700 hover:text-emerald-800 inline-flex items-center gap-1 disabled:opacity-50"
              >
                {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                Mark all read
              </button>
            )}
          </div>

          <div className="max-h-[22rem] overflow-y-auto">
            {items.length === 0 ? (
              <div className="px-4 py-10 text-center">
                <Bell className="h-8 w-8 text-gray-300 mx-auto mb-2" />
                <p className="text-sm text-gray-500">You&apos;re all caught up.</p>
              </div>
            ) : (
              items.map((n) => {
                const Icon = TYPE_ICONS[n.type] || Bell;
                return (
                  <button
                    key={n.id}
                    role="menuitem"
                    onClick={() => handleOpen(n)}
                    className={`w-full text-left px-4 py-3 flex gap-3 border-b last:border-b-0 transition-colors hover:bg-gray-50 ${
                      n.read ? "bg-white" : "bg-emerald-50/50"
                    }`}
                  >
                    <div
                      className={`h-8 w-8 rounded-full flex items-center justify-center flex-shrink-0 ${
                        n.read ? "bg-gray-100 text-gray-500" : "bg-emerald-100 text-emerald-700"
                      }`}
                    >
                      <Icon className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className={`text-sm truncate ${n.read ? "text-gray-700" : "font-semibold text-gray-900"}`}>
                        {n.title}
                      </p>
                      {n.message && (
                        <p className="text-xs text-gray-500 line-clamp-2 mt-0.5">{n.message}</p>
                      )}
                      <p className="text-[11px] text-gray-400 mt-1">{timeAgo(n.createdAt)}</p>
                    </div>
                    {!n.read && (
                      <span className="h-2 w-2 rounded-full bg-emerald-500 flex-shrink-0 mt-1.5" aria-hidden="true" />
                    )}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
