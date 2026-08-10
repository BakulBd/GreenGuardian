"use client";

/**
 * Green Room — camera/microphone acquisition and device selection.
 *
 * The failure modes here are the ones users actually hit (permission denied,
 * camera busy in another app, no device at all), so every path returns a
 * message a student can act on rather than a raw DOMException name. A blank
 * pre-join screen with "NotAllowedError" in the console is the outcome this
 * module exists to prevent.
 */
import { videoConstraintsForPeerCount } from "./constants";

export interface MediaDeviceOption {
  deviceId: string;
  label: string;
}

export interface AvailableDevices {
  cameras: MediaDeviceOption[];
  microphones: MediaDeviceOption[];
  speakers: MediaDeviceOption[];
}

export class MediaError extends Error {
  constructor(
    message: string,
    /** Machine-readable reason, for deciding whether retrying makes sense. */
    readonly reason:
      | "permission-denied"
      | "not-found"
      | "in-use"
      | "unsupported"
      | "unknown"
  ) {
    super(message);
    this.name = "MediaError";
  }
}

/** Turn a getUserMedia rejection into something worth showing a user. */
export function describeMediaError(error: any): MediaError {
  const name = String(error?.name || "");

  switch (name) {
    case "NotAllowedError":
    case "SecurityError":
      return new MediaError(
        "Your browser blocked access to the camera and microphone. Allow access in the address bar, then try again.",
        "permission-denied"
      );
    case "NotFoundError":
    case "OverconstrainedError":
      return new MediaError(
        "No camera or microphone was found. Check that your device is connected, then try again.",
        "not-found"
      );
    case "NotReadableError":
    case "AbortError":
      return new MediaError(
        "Your camera or microphone is already in use by another app. Close it (Zoom, Teams, another tab) and try again.",
        "in-use"
      );
    default:
      if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
        return new MediaError(
          "This browser does not support video calling. Try the latest Chrome, Edge, Firefox, or Safari.",
          "unsupported"
        );
      }
      return new MediaError(
        error?.message || "Could not access your camera or microphone.",
        "unknown"
      );
  }
}

/**
 * Secure-context check.
 *
 * `getUserMedia` is unavailable on plain http (except localhost), and the
 * resulting error is otherwise indistinguishable from a missing device — a
 * confusing failure for anyone testing over a LAN IP.
 */
export function isMediaSupported(): { supported: boolean; reason?: string } {
  if (typeof navigator === "undefined") return { supported: false, reason: "Not a browser." };
  if (typeof window !== "undefined" && !window.isSecureContext) {
    return {
      supported: false,
      reason:
        "Video calling requires a secure connection (https). Open this site over https, or use localhost for testing.",
    };
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    return {
      supported: false,
      reason: "This browser does not support video calling. Try the latest Chrome, Edge, or Safari.",
    };
  }
  return { supported: true };
}

/**
 * Enumerate cameras/mics/speakers.
 *
 * Labels are empty until permission has been granted at least once — that is a
 * browser privacy rule, not a bug — so callers should enumerate again after
 * acquiring a stream to populate the picker properly.
 */
export async function listDevices(): Promise<AvailableDevices> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.enumerateDevices) {
    return { cameras: [], microphones: [], speakers: [] };
  }

  const devices = await navigator.mediaDevices.enumerateDevices().catch(() => []);
  const pick = (kind: MediaDeviceKind, fallback: string): MediaDeviceOption[] =>
    devices
      .filter((d) => d.kind === kind)
      .map((d, index) => ({
        deviceId: d.deviceId,
        label: d.label || `${fallback} ${index + 1}`,
      }));

  return {
    cameras: pick("videoinput", "Camera"),
    microphones: pick("audioinput", "Microphone"),
    speakers: pick("audiooutput", "Speaker"),
  };
}

export interface AcquireOptions {
  video: boolean;
  audio: boolean;
  cameraId?: string;
  microphoneId?: string;
  /** Current mesh size, used to pick a resolution that will actually sustain. */
  peerCount?: number;
}

/**
 * Acquire a camera/mic stream.
 *
 * Video constraints scale down with the number of peers because each peer is
 * a separate encode — see the note in `mesh.ts`.
 */
export async function acquireStream(options: AcquireOptions): Promise<MediaStream> {
  const support = isMediaSupported();
  if (!support.supported) {
    throw new MediaError(support.reason || "Media is unavailable.", "unsupported");
  }

  if (!options.video && !options.audio) {
    // A stream with no tracks is valid and lets a participant join muted and
    // dark without a permission prompt at all.
    return new MediaStream();
  }

  const videoConstraints: MediaTrackConstraints | false = options.video
    ? {
        ...videoConstraintsForPeerCount(options.peerCount ?? 0),
        ...(options.cameraId ? { deviceId: { exact: options.cameraId } } : {}),
      }
    : false;

  const audioConstraints: MediaTrackConstraints | false = options.audio
    ? {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        ...(options.microphoneId ? { deviceId: { exact: options.microphoneId } } : {}),
      }
    : false;

  try {
    return await navigator.mediaDevices.getUserMedia({
      video: videoConstraints,
      audio: audioConstraints,
    });
  } catch (error: any) {
    // An exact deviceId that has since been unplugged fails as
    // OverconstrainedError. Retrying without the pin is much better than
    // telling someone their camera is missing when they simply switched it.
    if (error?.name === "OverconstrainedError" && (options.cameraId || options.microphoneId)) {
      return acquireStream({ ...options, cameraId: undefined, microphoneId: undefined });
    }
    throw describeMediaError(error);
  }
}

/** Begin a screen share. Returns null if the user dismissed the picker. */
export async function acquireScreenShare(): Promise<MediaStream | null> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getDisplayMedia) {
    throw new MediaError(
      "This browser does not support screen sharing. Try the latest Chrome or Edge on a desktop.",
      "unsupported"
    );
  }

  try {
    return await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: { ideal: 15, max: 30 } },
      // Shared tab/system audio where the browser and user allow it.
      audio: true,
    });
  } catch (error: any) {
    // Cancelling the picker is a normal choice, not an error worth reporting.
    if (error?.name === "NotAllowedError" || error?.name === "AbortError") return null;
    throw describeMediaError(error);
  }
}

/** Stop every track on a stream. Safe with null. */
export function stopStream(stream: MediaStream | null | undefined): void {
  stream?.getTracks().forEach((track) => {
    try {
      track.stop();
    } catch {
      /* already stopped */
    }
  });
}

/**
 * Route audio output to a chosen speaker.
 *
 * `setSinkId` is Chromium-only; elsewhere this is a no-op rather than an
 * error, since output selection is a nicety and not worth blocking a join.
 */
export async function setAudioOutput(
  element: HTMLMediaElement,
  deviceId: string
): Promise<boolean> {
  const withSink = element as HTMLMediaElement & { setSinkId?: (id: string) => Promise<void> };
  if (typeof withSink.setSinkId !== "function" || !deviceId) return false;
  try {
    await withSink.setSinkId(deviceId);
    return true;
  } catch {
    return false;
  }
}
