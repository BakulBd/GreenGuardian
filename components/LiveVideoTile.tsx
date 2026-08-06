"use client";

/**
 * LiveVideoTile — the teacher-side live view of one student.
 *
 * Handles every transport transparently (WebRTC P2P → Firestore frame relay →
 * same-browser BroadcastChannel → stored proctoring snapshot) and shows which
 * one is currently feeding the picture, so live monitoring behaves identically
 * on localhost and on the deployed (Vercel) site.
 */

import { useEffect, useRef, useState } from "react";
import { CameraOff, Loader2 } from "lucide-react";
import {
  subscribeToStudentLiveVideo,
  describeTransport,
  LiveTransport,
  LiveQuality,
} from "@/lib/services/liveVideo";

interface LiveVideoTileProps {
  sessionId: string;
  studentName?: string;
  /** Stored snapshot used until a live transport delivers its first frame. */
  fallbackSnapshotUrl?: string;
  /** `high` for fullscreen / detail dialogs, `thumb` for grid tiles. */
  quality?: LiveQuality;
  /** Teacher identity recorded on the viewer presence document. */
  viewerName?: string;
  className?: string;
  /** Hide the LIVE / OFFLINE badge (e.g. when the parent renders its own). */
  hideBadge?: boolean;
  onTransportChange?: (transport: LiveTransport) => void;
}

const TONE_CLASSES: Record<string, string> = {
  live: "bg-red-600 text-white",
  relay: "bg-amber-500 text-white",
  off: "bg-gray-600 text-white",
};

export default function LiveVideoTile({
  sessionId,
  studentName,
  fallbackSnapshotUrl,
  quality = "thumb",
  viewerName,
  className = "",
  hideBadge = false,
  onTransportChange,
}: LiveVideoTileProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [transport, setTransport] = useState<LiveTransport>("none");
  const [frame, setFrame] = useState<string | null>(null);
  const [lastFrameAt, setLastFrameAt] = useState<number>(0);

  // Kept in a ref so a parent re-render never tears down the live connection.
  const transportCallbackRef = useRef(onTransportChange);
  transportCallbackRef.current = onTransportChange;

  useEffect(() => {
    if (!sessionId) return;

    const handle = subscribeToStudentLiveVideo({
      sessionId,
      viewerName,
      quality,
      onStream: (stream) => {
        const el = videoRef.current;
        if (!el) return;
        if (el.srcObject !== stream) {
          el.srcObject = stream;
          // Autoplay can reject while the tab is backgrounded — not fatal.
          el.play().catch(() => {});
        }
      },
      onFrame: (dataUrl, capturedAt) => {
        setFrame(dataUrl);
        setLastFrameAt(capturedAt);
      },
      onTransport: (next) => {
        setTransport(next);
        transportCallbackRef.current?.(next);
      },
    });

    return () => handle.stop();
    // `quality` intentionally re-subscribes: it changes only on fullscreen open.
  }, [sessionId, quality, viewerName]);

  const isWebrtc = transport === "webrtc";
  const hasLiveFrame = !isWebrtc && !!frame;
  const badge = describeTransport(transport);

  // A relay frame older than 20s means the student's tab froze or went offline.
  const frameIsStale = hasLiveFrame && lastFrameAt > 0 && Date.now() - lastFrameAt > 20_000;

  return (
    <div className={`relative w-full h-full bg-gray-900 overflow-hidden ${className}`}>
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className={`w-full h-full object-cover ${isWebrtc ? "block" : "hidden"}`}
      />

      {hasLiveFrame && (
        <img
          src={frame as string}
          alt={studentName ? `${studentName} live video` : "Live video"}
          className={`w-full h-full object-cover ${frameIsStale ? "opacity-60" : ""}`}
        />
      )}

      {!isWebrtc && !hasLiveFrame && (
        fallbackSnapshotUrl ? (
          <img
            src={fallbackSnapshotUrl}
            alt={studentName ? `${studentName} snapshot` : "Snapshot"}
            className="w-full h-full object-cover opacity-80"
          />
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-gray-500">
            {transport === "none" ? (
              <>
                <Loader2 className="h-8 w-8 mb-2 animate-spin opacity-60" />
                <span className="text-xs">Connecting to camera…</span>
              </>
            ) : (
              <>
                <CameraOff className="h-8 w-8 mb-2" />
                <span className="text-xs">No camera feed</span>
              </>
            )}
          </div>
        )
      )}

      {!hideBadge && (
        <div className="absolute top-2 left-2 flex items-center gap-1">
          <span
            className={`px-1.5 py-0.5 rounded text-[10px] font-bold tracking-wide flex items-center gap-1 ${
              TONE_CLASSES[badge.tone]
            }`}
          >
            {badge.tone !== "off" && (
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
            )}
            {badge.label}
          </span>
        </div>
      )}
    </div>
  );
}
