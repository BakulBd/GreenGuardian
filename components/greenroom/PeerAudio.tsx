"use client";

/**
 * Remote audio playback, deliberately decoupled from the video grid.
 *
 * WHY THIS EXISTS AS ITS OWN COMPONENT
 * ------------------------------------
 * Audio used to be a side effect of a peer's `<video>` tile being on screen.
 * `MeetingStage` caps the grid at `MAX_VISIBLE_TILES` (rendering thirty live
 * video elements is what melts a laptop), so in any class larger than that cap
 * the participants past it had **no media element mounted at all** — and could
 * therefore not be heard by anyone, however correctly the WebRTC layer was
 * delivering their audio. That is the second, independent cause of "the UI says
 * they are unmuted but nobody can hear them", and no amount of fixing the peer
 * connection addresses it.
 *
 * So audio gets its own element per remote peer, mounted for EVERY peer for as
 * long as they are in the meeting, independent of layout, pagination, featured
 * speaker, or whether their camera is on. The video tiles are all muted; sound
 * comes from here and only here, which also removes any chance of a
 * participant being played twice.
 *
 * AUTOPLAY
 * --------
 * Browsers block audible playback that no user gesture authorised. Joining a
 * meeting is a gesture, so the first elements normally start fine — but an
 * element created later (someone joins twenty minutes in) can still be
 * refused, silently, with a rejected `play()` promise nobody was listening to.
 * Every rejection is reported up so the meeting UI can show one "Enable audio"
 * button; pressing it retries every blocked element at once, inside a real
 * gesture.
 */

import { useEffect, useRef } from "react";

export interface PeerAudioProps {
  /** The remote peer's stream. Video tracks on it are ignored by `<audio>`. */
  stream: MediaStream | null;
  /** Output device id, when the browser supports `setSinkId`. */
  outputDeviceId?: string;
  /** Called when playback was refused, so the UI can offer a gesture. */
  onBlocked?: () => void;
  /**
   * Bumped by the parent when the user has just made a gesture, to retry
   * everything that was blocked.
   */
  retryToken?: number;
}

export default function PeerAudio({
  stream,
  outputDeviceId,
  onBlocked,
  retryToken = 0,
}: PeerAudioProps) {
  const ref = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    if (element.srcObject !== (stream || null)) {
      element.srcObject = stream || null;
    }
    if (!stream) return;

    // `autoPlay` alone gives no way to learn that playback was refused.
    // Calling play() explicitly surfaces the rejection.
    const attempt = element.play();
    if (attempt && typeof attempt.catch === "function") {
      attempt.catch(() => {
        onBlocked?.();
      });
    }
    // `onBlocked` is intentionally not a dependency: it is a stable reporting
    // callback and including it would re-run playback on every parent render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stream, retryToken]);

  useEffect(() => {
    const element = ref.current as any;
    if (!element || !outputDeviceId) return;
    // Chromium-only. Absent elsewhere, where the OS default is the only option.
    if (typeof element.setSinkId !== "function") return;
    element.setSinkId(outputDeviceId).catch(() => {
      /* the device may have been unplugged; the default sink still plays */
    });
  }, [outputDeviceId]);

  // Not `hidden` and not `display:none`: some browsers refuse to play media in
  // a display:none element. Zero-size and out of the layout is safe everywhere.
  return (
    <audio
      ref={ref}
      autoPlay
      playsInline
      aria-hidden="true"
      style={{ position: "absolute", width: 0, height: 0, opacity: 0, pointerEvents: "none" }}
    />
  );
}
