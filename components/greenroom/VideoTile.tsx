"use client";

/**
 * One participant's video tile.
 *
 * Attaching a `MediaStream` to a `<video>` is imperative (`srcObject` is not a
 * React prop), so the stream is applied in an effect keyed on the stream
 * identity — re-attaching the same stream restarts playback and produces a
 * visible flicker, which is why the guard is there.
 */
import { useEffect, useRef } from "react";
import { Mic, MicOff, Hand, MonitorUp, Crown, Shield, WifiOff, Loader2 } from "lucide-react";
import { PeerConnectionState } from "@/lib/greenroom/mesh";
import { MeetingRole } from "@/lib/greenroom/types";
import { cn } from "@/lib/utils";

export interface VideoTileProps {
  name: string;
  stream?: MediaStream | null;
  /** Local preview: muted and mirrored, never plays your own audio back. */
  isLocal?: boolean;
  micOn: boolean;
  camOn: boolean;
  handRaised?: boolean;
  screenSharing?: boolean;
  role?: MeetingRole;
  connectionState?: PeerConnectionState;
  /** Highlights the active speaker / pinned tile. */
  active?: boolean;
  className?: string;
}

function initialsOf(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() || "")
      .join("") || "?"
  );
}

export default function VideoTile({
  name,
  stream,
  isLocal = false,
  micOn,
  camOn,
  handRaised,
  screenSharing,
  role = "participant",
  connectionState = "connected",
  active = false,
  className,
}: VideoTileProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const element = videoRef.current;
    if (!element) return;
    if (element.srcObject !== (stream || null)) {
      element.srcObject = stream || null;
    }
  }, [stream]);

  const showVideo = Boolean(stream) && (camOn || screenSharing);
  const connecting = connectionState === "connecting" || connectionState === "new";
  const failed = connectionState === "failed";

  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-xl bg-slate-900 ring-1 ring-white/10",
        active && "ring-2 ring-emerald-400",
        className
      )}
    >
      {/* The element stays mounted even when the camera is off: tearing it
          down and rebuilding it on every toggle drops the stream binding. */}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted={isLocal}
        aria-label={`${name}${isLocal ? " (you)" : ""} video`}
        className={cn(
          "h-full w-full object-cover",
          !showVideo && "invisible",
          // Mirroring matches what people expect of their own camera, but a
          // shared screen must never be mirrored or text reads backwards.
          isLocal && !screenSharing && "scale-x-[-1]"
        )}
      />

      {!showVideo && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div
            className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-600 text-xl font-semibold text-white"
            aria-hidden="true"
          >
            {initialsOf(name)}
          </div>
        </div>
      )}

      {(connecting || failed) && !isLocal && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-slate-900/70 text-xs text-white">
          {failed ? (
            <>
              <WifiOff className="h-5 w-5 text-red-400" aria-hidden="true" />
              <span>Connection failed</span>
            </>
          ) : (
            <>
              <Loader2 className="h-5 w-5 animate-spin text-emerald-400" aria-hidden="true" />
              <span>Connecting…</span>
            </>
          )}
        </div>
      )}

      {/* Name plate + state badges */}
      <div className="absolute inset-x-0 bottom-0 flex items-center gap-1.5 bg-gradient-to-t from-black/80 to-transparent px-2 py-1.5">
        {micOn ? (
          <Mic className="h-3.5 w-3.5 shrink-0 text-emerald-400" aria-hidden="true" />
        ) : (
          <MicOff className="h-3.5 w-3.5 shrink-0 text-red-400" aria-hidden="true" />
        )}
        <span className="truncate text-xs font-medium text-white">
          {name}
          {isLocal && " (you)"}
        </span>
        <span className="sr-only">
          {micOn ? "Microphone on" : "Microphone muted"}, {camOn ? "camera on" : "camera off"}
        </span>

        <span className="ml-auto flex shrink-0 items-center gap-1">
          {screenSharing && (
            <MonitorUp className="h-3.5 w-3.5 text-emerald-400" aria-label="Sharing screen" />
          )}
          {handRaised && <Hand className="h-3.5 w-3.5 text-amber-400" aria-label="Hand raised" />}
          {role === "host" && <Crown className="h-3.5 w-3.5 text-amber-400" aria-label="Host" />}
          {role === "cohost" && (
            <Shield className="h-3.5 w-3.5 text-sky-400" aria-label="Co-host" />
          )}
        </span>
      </div>
    </div>
  );
}
