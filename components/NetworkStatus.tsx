"use client";

/**
 * Connection banner.
 *
 * Exams run for an hour on whatever Wi-Fi the student has. Firestore queues
 * writes while offline and replays them on reconnect, so work is not lost — but
 * without feedback a student sees a frozen page and panics (or refreshes, which
 * is worse). This surfaces the state instead.
 */

import { useEffect, useState } from "react";
import { WifiOff, Wifi } from "lucide-react";

export default function NetworkStatus() {
  const [isOnline, setIsOnline] = useState(true);
  const [showReconnected, setShowReconnected] = useState(false);

  useEffect(() => {
    // navigator.onLine is only meaningful in the browser.
    setIsOnline(navigator.onLine);

    const handleOnline = () => {
      setIsOnline(true);
      setShowReconnected(true);
      window.setTimeout(() => setShowReconnected(false), 4000);
    };
    const handleOffline = () => setIsOnline(false);

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  if (isOnline && !showReconnected) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className={`fixed inset-x-0 top-0 z-[200] px-4 py-2 text-center text-sm font-medium text-white shadow-lg ${
        isOnline ? "bg-green-600" : "bg-red-600"
      }`}
    >
      <span className="inline-flex items-center gap-2">
        {isOnline ? <Wifi className="h-4 w-4" /> : <WifiOff className="h-4 w-4" />}
        {isOnline
          ? "Back online — your work has been synced."
          : "You are offline. Your answers are saved locally and will sync automatically."}
      </span>
    </div>
  );
}
