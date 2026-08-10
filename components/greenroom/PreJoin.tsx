"use client";

/**
 * Pre-join screen: preview your camera and pick devices before anyone sees you.
 *
 * This exists so the first thing a class sees is never an accidental camera.
 * The preview stream is acquired here, and the SAME stream is handed to the
 * meeting on join rather than being re-acquired — re-requesting the camera
 * causes a second permission prompt in some browsers and a visible flash in
 * all of them.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Mic, MicOff, Video, VideoOff, Loader2, AlertTriangle, LogIn } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  acquireStream,
  listDevices,
  stopStream,
  isMediaSupported,
  AvailableDevices,
  MediaError,
} from "@/lib/greenroom/devices";

export interface PreJoinProps {
  meetingTitle: string;
  hostName?: string;
  /** Disables the camera controls entirely for an audio-only meeting. */
  audioOnly?: boolean;
  joining?: boolean;
  /** Extra note under the title (e.g. "Waiting for the host to admit you"). */
  notice?: string;
  onJoin: (options: {
    stream: MediaStream | null;
    micOn: boolean;
    camOn: boolean;
    cameraId?: string;
    microphoneId?: string;
  }) => void;
  onCancel: () => void;
}

export default function PreJoin({
  meetingTitle,
  hostName,
  audioOnly = false,
  joining = false,
  notice,
  onJoin,
  onCancel,
}: PreJoinProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(!audioOnly);
  const [devices, setDevices] = useState<AvailableDevices>({
    cameras: [],
    microphones: [],
    speakers: [],
  });
  const [cameraId, setCameraId] = useState<string>("");
  const [microphoneId, setMicrophoneId] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const support = isMediaSupported();

  /** (Re)acquire the preview stream for the current toggles and device ids. */
  const refreshPreview = useCallback(
    async (nextMic: boolean, nextCam: boolean, nextCameraId?: string, nextMicId?: string) => {
      setLoading(true);
      setError(null);
      // Release the old stream first, or the camera stays busy and the second
      // acquisition fails with NotReadableError on some platforms.
      stopStream(streamRef.current);
      streamRef.current = null;

      try {
        const stream = await acquireStream({
          video: nextCam && !audioOnly,
          audio: nextMic,
          cameraId: nextCameraId || undefined,
          microphoneId: nextMicId || undefined,
        });
        streamRef.current = stream;
        if (videoRef.current) videoRef.current.srcObject = stream;

        // Labels are only populated after permission is granted, so enumerate
        // again now that we (probably) have it.
        setDevices(await listDevices());
      } catch (err: any) {
        const mediaError = err instanceof MediaError ? err : null;
        setError(mediaError?.message || err?.message || "Could not access your camera or microphone.");
        // Joining with no media is still valid — a student with a broken
        // webcam should be able to attend and listen.
      } finally {
        setLoading(false);
      }
    },
    [audioOnly]
  );

  useEffect(() => {
    if (!support.supported) {
      setError(support.reason || "Video calling is not supported here.");
      setLoading(false);
      return;
    }
    refreshPreview(micOn, camOn, cameraId, microphoneId);

    return () => {
      // Only stop the preview if it was never handed to the meeting.
      if (streamRef.current) stopStream(streamRef.current);
    };
    // Intentionally runs once: subsequent changes go through the explicit
    // toggle/select handlers so we control exactly when the camera restarts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleMic = () => {
    const next = !micOn;
    setMicOn(next);
    refreshPreview(next, camOn, cameraId, microphoneId);
  };

  const toggleCam = () => {
    if (audioOnly) return;
    const next = !camOn;
    setCamOn(next);
    refreshPreview(micOn, next, cameraId, microphoneId);
  };

  const handleJoin = () => {
    const stream = streamRef.current;
    // Ownership transfers to the meeting; clear the ref so the cleanup effect
    // does not stop the tracks out from under the call.
    streamRef.current = null;
    onJoin({ stream, micOn, camOn: camOn && !audioOnly, cameraId, microphoneId });
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 p-4">
      <Card className="w-full max-w-3xl border-white/10 bg-slate-900 text-slate-100">
        <CardContent className="p-5 sm:p-6">
          <div className="mb-4">
            <h1 className="text-xl font-semibold">{meetingTitle}</h1>
            {hostName && <p className="text-sm text-slate-400">Hosted by {hostName}</p>}
            {notice && (
              <p className="mt-2 rounded-lg bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
                {notice}
              </p>
            )}
          </div>

          <div className="grid gap-5 md:grid-cols-[3fr_2fr]">
            {/* Preview */}
            <div className="relative aspect-video overflow-hidden rounded-xl bg-slate-800">
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                aria-label="Camera preview"
                className={`h-full w-full scale-x-[-1] object-cover ${camOn && !audioOnly ? "" : "invisible"}`}
              />
              {(!camOn || audioOnly) && (
                <div className="absolute inset-0 flex items-center justify-center text-sm text-slate-400">
                  {audioOnly ? "This is an audio-only class" : "Your camera is off"}
                </div>
              )}
              {loading && (
                <div className="absolute inset-0 flex items-center justify-center bg-slate-900/60">
                  <Loader2 className="h-6 w-6 animate-spin text-emerald-400" aria-hidden="true" />
                  <span className="sr-only">Starting camera preview</span>
                </div>
              )}

              <div className="absolute inset-x-0 bottom-0 flex justify-center gap-2 p-3">
                <Button
                  type="button"
                  size="sm"
                  onClick={toggleMic}
                  aria-pressed={micOn}
                  className={micOn ? "bg-emerald-600 hover:bg-emerald-700" : "bg-red-600 hover:bg-red-700"}
                >
                  {micOn ? <Mic className="h-4 w-4" /> : <MicOff className="h-4 w-4" />}
                  <span className="ml-1.5 hidden sm:inline">{micOn ? "Mic on" : "Mic off"}</span>
                </Button>
                <Button
                  type="button"
                  size="sm"
                  onClick={toggleCam}
                  disabled={audioOnly}
                  aria-pressed={camOn && !audioOnly}
                  className={
                    camOn && !audioOnly
                      ? "bg-emerald-600 hover:bg-emerald-700"
                      : "bg-red-600 hover:bg-red-700"
                  }
                >
                  {camOn && !audioOnly ? <Video className="h-4 w-4" /> : <VideoOff className="h-4 w-4" />}
                  <span className="ml-1.5 hidden sm:inline">
                    {camOn && !audioOnly ? "Camera on" : "Camera off"}
                  </span>
                </Button>
              </div>
            </div>

            {/* Device selection */}
            <div className="space-y-3">
              {error && (
                <div className="flex items-start gap-2 rounded-lg bg-red-500/10 p-3 text-xs text-red-200">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                  <div>
                    <p>{error}</p>
                    <p className="mt-1 text-red-300/80">
                      You can still join and listen without a camera or microphone.
                    </p>
                  </div>
                </div>
              )}

              {!audioOnly && (
                <div>
                  <label htmlFor="prejoin-camera" className="mb-1 block text-xs font-medium text-slate-300">
                    Camera
                  </label>
                  <select
                    id="prejoin-camera"
                    value={cameraId}
                    onChange={(e) => {
                      setCameraId(e.target.value);
                      refreshPreview(micOn, camOn, e.target.value, microphoneId);
                    }}
                    className="w-full rounded-lg border border-white/15 bg-slate-800 px-2.5 py-2 text-sm text-slate-100 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  >
                    <option value="">Default camera</option>
                    {devices.cameras.map((device) => (
                      <option key={device.deviceId} value={device.deviceId}>
                        {device.label}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div>
                <label htmlFor="prejoin-mic" className="mb-1 block text-xs font-medium text-slate-300">
                  Microphone
                </label>
                <select
                  id="prejoin-mic"
                  value={microphoneId}
                  onChange={(e) => {
                    setMicrophoneId(e.target.value);
                    refreshPreview(micOn, camOn, cameraId, e.target.value);
                  }}
                  className="w-full rounded-lg border border-white/15 bg-slate-800 px-2.5 py-2 text-sm text-slate-100 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                >
                  <option value="">Default microphone</option>
                  {devices.microphones.map((device) => (
                    <option key={device.deviceId} value={device.deviceId}>
                      {device.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex gap-2 pt-1">
                <Button
                  type="button"
                  onClick={handleJoin}
                  disabled={joining}
                  className="flex-1 bg-emerald-600 hover:bg-emerald-700"
                >
                  {joining ? (
                    <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <LogIn className="mr-1.5 h-4 w-4" aria-hidden="true" />
                  )}
                  {joining ? "Joining…" : "Join now"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={onCancel}
                  className="border-white/20 bg-transparent text-slate-200 hover:bg-white/10"
                >
                  Cancel
                </Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
