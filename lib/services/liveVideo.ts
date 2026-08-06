/**
 * GreenGuardian — Live Exam Video Service
 * =======================================
 *
 * Zoom-style live student video on the teacher dashboard **without any VPS / SFU
 * server**, so it works on a serverless deployment (Vercel) exactly like it does
 * on localhost.
 *
 * Three transports are layered, best first. The teacher UI automatically shows
 * whichever one is currently alive:
 *
 *   1. `webrtc`  — true peer-to-peer live video (real ~30fps stream).
 *                  Signaling runs through Firestore, media goes browser→browser.
 *                  Works across the internet as long as STUN (or TURN, for
 *                  symmetric NATs) can punch a route.
 *   2. `relay`   — Firestore frame relay. The student writes a small JPEG frame
 *                  into `liveFrames/{sessionId}` on an interval and the teacher
 *                  receives it through a realtime listener. This needs no P2P
 *                  connectivity at all, so it *always* works on Vercel, on
 *                  mobile data, behind school firewalls, etc.
 *   3. `local`   — BroadcastChannel, only for two tabs in the same browser
 *                  (developer testing on one PC).
 *
 * Cost control (important on the Firebase Spark free plan):
 *   • The student only relays frames while at least one teacher is actually
 *     watching (viewers register a presence doc with a heartbeat).
 *   • Once WebRTC connects for every active viewer, the relay drops to a slow
 *     idle heartbeat instead of a video-rate write loop.
 *   • Grid tiles request `thumb` quality (slow, small); the fullscreen/detail
 *     view requests `high` quality (fast, larger).
 */

import { db } from "@/lib/firebase/config";
import {
  collection,
  doc,
  setDoc,
  updateDoc,
  deleteDoc,
  getDocs,
  addDoc,
  onSnapshot,
  serverTimestamp,
} from "firebase/firestore";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Which transport is currently delivering pictures to a viewer. */
export type LiveTransport = "webrtc" | "relay" | "local" | "none";

export type LiveQuality = "thumb" | "high";

export interface LiveViewerHandlers {
  /** Fired when a real WebRTC MediaStream becomes available. */
  onStream?: (stream: MediaStream) => void;
  /** Fired for every relay / local frame (a `data:image/jpeg;base64,...` URL). */
  onFrame?: (frameDataUrl: string, capturedAt: number) => void;
  /** Fired whenever the active transport changes. */
  onTransport?: (transport: LiveTransport) => void;
}

export interface StartBroadcastOptions {
  sessionId: string;
  studentId?: string;
  studentName?: string;
  examId?: string;
  /** Camera stream — used for the WebRTC peer connections. */
  stream?: MediaStream | null;
  /** Video element — used as the frame source for the relay transport. */
  getVideoElement?: () => HTMLVideoElement | null;
}

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------

const SIGNALING_COLLECTION = "liveVideoSignaling";
const FRAMES_COLLECTION = "liveFrames";

/** A viewer whose heartbeat is older than this is treated as gone. */
const VIEWER_STALE_MS = 45_000;
/** How often a viewer refreshes its presence heartbeat. */
const VIEWER_HEARTBEAT_MS = 12_000;

/** Relay frame cadence per requested quality (milliseconds between writes). */
const RELAY_INTERVAL: Record<LiveQuality, number> = {
  thumb: 2_500,
  high: 1_000,
};
/** Cadence used when every viewer already has a healthy WebRTC stream. */
const RELAY_IDLE_INTERVAL = 15_000;

/** Relay frame size per quality. */
const RELAY_FRAME_SIZE: Record<LiveQuality, { width: number; quality: number }> = {
  thumb: { width: 320, quality: 0.5 },
  high: { width: 480, quality: 0.6 },
};

/** BroadcastChannel (same-browser) frame cadence — cheap, so keep it smooth. */
const LOCAL_FRAME_INTERVAL = 120;
/** Stop encoding same-browser frames this long after the last viewer ping. */
const LOCAL_VIEWER_TIMEOUT = 15_000;
/** How often a same-browser viewer announces itself. */
const LOCAL_PING_INTERVAL = 5_000;

// ---------------------------------------------------------------------------
// ICE configuration
// ---------------------------------------------------------------------------

const DEFAULT_STUN: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
  { urls: "stun:stun2.l.google.com:19302" },
  { urls: "stun:stun.cloudflare.com:3478" },
];

/**
 * Build the ICE server list.
 *
 * On a plain STUN-only setup roughly 10-20% of real-world pairs (symmetric NAT,
 * corporate/campus firewalls, some mobile carriers) can never connect P2P. Set
 * the TURN env vars below in Vercel to cover those; without them the service
 * silently falls back to the Firestore relay transport, so video still shows.
 *
 *   NEXT_PUBLIC_TURN_URLS=turn:host:3478,turns:host:5349
 *   NEXT_PUBLIC_TURN_USERNAME=...
 *   NEXT_PUBLIC_TURN_CREDENTIAL=...
 */
export function getIceServers(): RTCIceServer[] {
  const servers = [...DEFAULT_STUN];

  const urls = (process.env.NEXT_PUBLIC_TURN_URLS || "")
    .split(",")
    .map((u) => u.trim())
    .filter(Boolean);

  const username = process.env.NEXT_PUBLIC_TURN_USERNAME;
  const credential = process.env.NEXT_PUBLIC_TURN_CREDENTIAL;

  if (urls.length > 0) {
    servers.push(
      username && credential ? { urls, username, credential } : { urls }
    );
  }

  return servers;
}

function peerConfig(): RTCConfiguration {
  return {
    iceServers: getIceServers(),
    iceCandidatePoolSize: 4,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeId(): string {
  try {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
      return crypto.randomUUID();
    }
  } catch {
    /* ignore */
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Firestore Timestamp | Date | number → epoch millis (0 when unknown). */
function toMillis(value: any): number {
  if (!value) return 0;
  if (typeof value === "number") return value;
  if (typeof value?.toMillis === "function") return value.toMillis();
  if (typeof value?.toDate === "function") return value.toDate().getTime();
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
}

/** Delete every document in a (small) collection — used for ICE candidate cleanup. */
async function deleteCollection(colRef: ReturnType<typeof collection>): Promise<void> {
  try {
    const snap = await getDocs(colRef);
    await Promise.all(snap.docs.map((d) => deleteDoc(d.ref).catch(() => {})));
  } catch {
    /* best-effort cleanup */
  }
}

/** Draw the current video frame to a JPEG data URL, or null if not drawable. */
export function grabFrame(
  video: HTMLVideoElement | null | undefined,
  targetWidth: number,
  quality: number
): string | null {
  if (!video) return null;
  // readyState 2 (HAVE_CURRENT_DATA) is the first state with a paintable frame.
  if (video.readyState < 2 || !video.videoWidth || !video.videoHeight) return null;

  try {
    const ratio = video.videoHeight / video.videoWidth;
    const width = Math.min(targetWidth, video.videoWidth);
    const height = Math.round(width * ratio);

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    ctx.drawImage(video, 0, 0, width, height);
    return canvas.toDataURL("image/jpeg", quality);
  } catch {
    return null;
  }
}

function localChannelName(sessionId: string): string {
  return `gg_live_stream_${sessionId}`;
}

// ===========================================================================
// STUDENT SIDE — broadcaster
// ===========================================================================

interface ViewerPeer {
  viewerId: string;
  pc: RTCPeerConnection;
  unsubs: Array<() => void>;
}

interface ActiveViewer {
  quality: LiveQuality;
  /** True once WebRTC is carrying video for this viewer (relay can slow down). */
  connected: boolean;
}

/**
 * Start broadcasting this student's camera to any teacher who watches.
 *
 * Safe to call when the camera is not ready yet — the relay transport picks up
 * as soon as the video element has frames, and WebRTC only starts once a
 * teacher actually opens a viewer.
 *
 * @returns a cleanup function that tears down every peer, listener and doc.
 */
export function startStudentLiveBroadcast(options: StartBroadcastOptions): () => void {
  const { sessionId, studentId, studentName, examId, stream, getVideoElement } = options;

  if (typeof window === "undefined" || !sessionId) return () => {};

  const sessionRef = doc(db, SIGNALING_COLLECTION, sessionId);
  const viewersRef = collection(sessionRef, "viewers");
  const frameRef = doc(db, FRAMES_COLLECTION, sessionId);

  /** Teachers currently watching (drives the relay), keyed by viewer id. */
  const viewers = new Map<string, ActiveViewer>();
  /** WebRTC peer connections, keyed by viewer id — a subset of `viewers`. */
  const peers = new Map<string, ViewerPeer>();
  let stopped = false;
  let relayTimer: ReturnType<typeof setTimeout> | null = null;
  let relaySeq = 0;
  let lastRelayFrame: string | null = null;

  // --- announce that this session is broadcasting -------------------------
  setDoc(
    sessionRef,
    {
      sessionId,
      studentId: studentId || null,
      studentName: studentName || null,
      examId: examId || null,
      broadcasting: true,
      startedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  ).catch((err) => console.warn("[liveVideo] presence write failed:", err?.message));

  // --- 1. BroadcastChannel (same-browser dev testing) ---------------------
  let localChannel: BroadcastChannel | null = null;
  let localTimer: ReturnType<typeof setInterval> | null = null;

  if ("BroadcastChannel" in window) {
    try {
      localChannel = new BroadcastChannel(localChannelName(sessionId));

      // Encoding 8 frames a second is not free, and the student's machine is
      // already running face/object detection — so only encode while a viewer
      // in this browser is actually pinging.
      let lastLocalPing = 0;
      localChannel.onmessage = (event) => {
        if (event.data?.type === "viewer-ping") lastLocalPing = Date.now();
      };

      localTimer = setInterval(() => {
        if (Date.now() - lastLocalPing > LOCAL_VIEWER_TIMEOUT) return;
        const frame = grabFrame(getVideoElement?.(), 320, 0.6);
        if (frame && localChannel) {
          localChannel.postMessage({ frame, timestamp: Date.now() });
        }
      }, LOCAL_FRAME_INTERVAL);
    } catch {
      localChannel = null;
    }
  }

  // --- 2. Firestore frame relay ------------------------------------------
  // Runs only while a viewer is present. Interval adapts to (a) the highest
  // quality any viewer asked for and (b) whether WebRTC already covers them.
  function currentRelayPlan(): { interval: number; quality: LiveQuality } | null {
    if (viewers.size === 0) return null;

    let quality: LiveQuality = "thumb";
    let allConnected = true;
    viewers.forEach((viewer) => {
      if (viewer.quality === "high") quality = "high";
      if (!viewer.connected) allConnected = false;
    });

    return {
      quality,
      interval: allConnected ? RELAY_IDLE_INTERVAL : RELAY_INTERVAL[quality],
    };
  }

  async function relayTick() {
    if (stopped) return;

    const plan = currentRelayPlan();
    if (!plan) {
      // Nobody watching — check again shortly without writing anything.
      relayTimer = setTimeout(relayTick, 2_000);
      return;
    }

    const { width, quality } = RELAY_FRAME_SIZE[plan.quality];
    const frame = grabFrame(getVideoElement?.(), width, quality);

    // Skip writes when the picture has not changed at all (camera covered /
    // paused) — saves Firestore quota without the teacher noticing.
    if (frame && frame !== lastRelayFrame) {
      lastRelayFrame = frame;
      relaySeq += 1;
      try {
        await setDoc(frameRef, {
          sessionId,
          studentId: studentId || null,
          examId: examId || null,
          frame,
          seq: relaySeq,
          capturedAt: Date.now(),
          updatedAt: serverTimestamp(),
        });
      } catch (err: any) {
        console.warn("[liveVideo] relay frame write failed:", err?.message);
      }
    }

    relayTimer = setTimeout(relayTick, plan.interval);
  }
  relayTimer = setTimeout(relayTick, 500);

  // --- 3. WebRTC: one peer connection per watching teacher ----------------
  async function createPeerForViewer(viewerId: string) {
    if (stopped || peers.has(viewerId)) return;
    // Without a camera stream there is nothing to send over P2P — the Firestore
    // relay still gives the teacher a picture.
    if (!stream || stream.getVideoTracks().length === 0) return;

    const viewerRef = doc(viewersRef, viewerId);
    const offerCandidates = collection(viewerRef, "offerCandidates");
    const answerCandidates = collection(viewerRef, "answerCandidates");

    const pc = new RTCPeerConnection(peerConfig());
    const entry: ViewerPeer = { viewerId, pc, unsubs: [] };
    peers.set(viewerId, entry);

    stream.getTracks().forEach((track) => pc.addTrack(track, stream));

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        addDoc(offerCandidates, event.candidate.toJSON()).catch(() => {});
      }
    };

    pc.onconnectionstatechange = () => {
      const viewer = viewers.get(viewerId);
      if (viewer) viewer.connected = pc.connectionState === "connected";
      updateDoc(viewerRef, { broadcasterState: pc.connectionState }).catch(() => {});
    };

    try {
      const offer = await pc.createOffer({ offerToReceiveAudio: false, offerToReceiveVideo: false });
      await pc.setLocalDescription(offer);
      await updateDoc(viewerRef, {
        offer: { type: offer.type, sdp: offer.sdp },
        offeredAt: serverTimestamp(),
      });
    } catch (err: any) {
      console.warn("[liveVideo] offer failed for viewer", viewerId, err?.message);
    }

    // Apply the teacher's answer as soon as it arrives.
    const unsubAnswer = onSnapshot(
      viewerRef,
      async (snap) => {
        const data = snap.data();
        if (!data) return;
        if (data.answer && !pc.currentRemoteDescription) {
          try {
            await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
          } catch (err: any) {
            console.warn("[liveVideo] setRemoteDescription failed:", err?.message);
          }
        }
      },
      () => {}
    );
    entry.unsubs.push(unsubAnswer);

    const unsubCandidates = onSnapshot(
      answerCandidates,
      (snap) => {
        snap.docChanges().forEach(async (change) => {
          if (change.type !== "added") return;
          try {
            await pc.addIceCandidate(new RTCIceCandidate(change.doc.data() as RTCIceCandidateInit));
          } catch {
            /* candidate arrived before the description — WebRTC retries via relay */
          }
        });
      },
      () => {}
    );
    entry.unsubs.push(unsubCandidates);
  }

  function destroyPeer(viewerId: string) {
    const entry = peers.get(viewerId);
    if (!entry) return;
    entry.unsubs.forEach((u) => {
      try {
        u();
      } catch {
        /* ignore */
      }
    });
    try {
      entry.pc.close();
    } catch {
      /* ignore */
    }
    peers.delete(viewerId);
  }

  // Watch the viewer list: teachers add/remove themselves here.
  const unsubViewers = onSnapshot(
    viewersRef,
    (snap) => {
      if (stopped) return;
      const now = Date.now();
      const alive = new Set<string>();

      snap.docs.forEach((viewerDoc) => {
        const data = viewerDoc.data() || {};
        const lastSeen = toMillis(data.lastSeenAt) || toMillis(data.requestedAt);
        const isStale = lastSeen > 0 && now - lastSeen > VIEWER_STALE_MS;

        if (isStale) {
          // The teacher closed the tab without cleaning up — reclaim the slot.
          viewers.delete(viewerDoc.id);
          destroyPeer(viewerDoc.id);
          deleteDoc(viewerDoc.ref).catch(() => {});
          return;
        }

        alive.add(viewerDoc.id);
        const quality: LiveQuality = data.quality === "high" ? "high" : "thumb";

        const existing = viewers.get(viewerDoc.id);
        if (existing) {
          existing.quality = quality;
        } else {
          // Register first so the relay starts immediately, then try WebRTC.
          viewers.set(viewerDoc.id, { quality, connected: false });
          createPeerForViewer(viewerDoc.id).catch(() => {});
        }
      });

      // Viewers that vanished from the collection.
      Array.from(viewers.keys()).forEach((viewerId) => {
        if (!alive.has(viewerId)) {
          viewers.delete(viewerId);
          destroyPeer(viewerId);
        }
      });
    },
    (err) => console.warn("[liveVideo] viewer listener error:", err?.message)
  );

  // --- cleanup ------------------------------------------------------------
  return () => {
    if (stopped) return;
    stopped = true;

    if (localTimer) clearInterval(localTimer);
    if (localChannel) {
      try {
        localChannel.close();
      } catch {
        /* ignore */
      }
    }
    if (relayTimer) clearTimeout(relayTimer);

    try {
      unsubViewers();
    } catch {
      /* ignore */
    }
    Array.from(peers.keys()).forEach(destroyPeer);
    viewers.clear();

    // Best-effort remote cleanup so the teacher grid does not show a ghost.
    updateDoc(sessionRef, { broadcasting: false, endedAt: serverTimestamp() }).catch(() => {});
    deleteDoc(frameRef).catch(() => {});
  };
}

// ===========================================================================
// TEACHER SIDE — viewer
// ===========================================================================

export interface SubscribeViewerOptions extends LiveViewerHandlers {
  sessionId: string;
  /** Teacher uid, stored on the viewer doc for auditing. */
  viewerName?: string;
  /** `high` for fullscreen/detail views, `thumb` for grid tiles. */
  quality?: LiveQuality;
}

export interface LiveViewerHandle {
  /** Tear down the subscription (call from a React effect cleanup). */
  stop: () => void;
  /** Switch frame quality without renegotiating — e.g. tile → fullscreen. */
  setQuality: (quality: LiveQuality) => void;
  viewerId: string;
}

/**
 * Watch one student's live video.
 *
 * Registers a viewer presence document (which is what tells the student's
 * browser to start streaming), negotiates WebRTC, and simultaneously listens to
 * the Firestore relay so a picture appears even when P2P cannot connect.
 *
 * @returns a cleanup function.
 */
export function subscribeToStudentLiveVideo(options: SubscribeViewerOptions): LiveViewerHandle {
  const { sessionId, viewerName, quality = "thumb", onStream, onFrame, onTransport } = options;

  if (typeof window === "undefined" || !sessionId) {
    return { stop: () => {}, setQuality: () => {}, viewerId: "" };
  }

  const viewerId = makeId();
  const sessionRef = doc(db, SIGNALING_COLLECTION, sessionId);
  const viewerRef = doc(collection(sessionRef, "viewers"), viewerId);
  const offerCandidates = collection(viewerRef, "offerCandidates");
  const answerCandidates = collection(viewerRef, "answerCandidates");
  const frameRef = doc(db, FRAMES_COLLECTION, sessionId);

  let stopped = false;
  let transport: LiveTransport = "none";
  let hasWebrtc = false;
  let hasLocal = false;
  let hasRelay = false;
  const pendingCandidates: RTCIceCandidateInit[] = [];

  function refreshTransport() {
    const next: LiveTransport = hasWebrtc
      ? "webrtc"
      : hasLocal
      ? "local"
      : hasRelay
      ? "relay"
      : "none";
    if (next !== transport) {
      transport = next;
      onTransport?.(next);
    }
  }

  // --- 1. presence + heartbeat -------------------------------------------
  setDoc(viewerRef, {
    viewerId,
    viewerName: viewerName || null,
    quality,
    requestedAt: serverTimestamp(),
    lastSeenAt: serverTimestamp(),
  }).catch((err) => console.warn("[liveVideo] viewer registration failed:", err?.message));

  const heartbeat = setInterval(() => {
    updateDoc(viewerRef, { lastSeenAt: serverTimestamp() }).catch(() => {});
  }, VIEWER_HEARTBEAT_MS);

  // --- 2. WebRTC answer flow ---------------------------------------------
  const pc = new RTCPeerConnection(peerConfig());
  const remoteStream = new MediaStream();

  pc.addTransceiver("video", { direction: "recvonly" });

  pc.ontrack = (event) => {
    event.streams[0]?.getTracks().forEach((track) => {
      if (!remoteStream.getTracks().includes(track)) remoteStream.addTrack(track);
    });
    onStream?.(remoteStream);
  };

  pc.onicecandidate = (event) => {
    if (event.candidate) {
      addDoc(answerCandidates, event.candidate.toJSON()).catch(() => {});
    }
  };

  pc.onconnectionstatechange = () => {
    hasWebrtc = pc.connectionState === "connected";
    refreshTransport();
  };

  const unsubViewerDoc = onSnapshot(
    viewerRef,
    async (snap) => {
      if (stopped) return;
      const data = snap.data();
      if (!data?.offer || pc.currentRemoteDescription) return;

      try {
        await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        await updateDoc(viewerRef, {
          answer: { type: answer.type, sdp: answer.sdp },
          answeredAt: serverTimestamp(),
        });

        while (pendingCandidates.length) {
          const candidate = pendingCandidates.shift();
          if (candidate) {
            await pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(() => {});
          }
        }
      } catch (err: any) {
        console.warn("[liveVideo] answer failed:", err?.message);
      }
    },
    () => {}
  );

  const unsubOfferCandidates = onSnapshot(
    offerCandidates,
    (snap) => {
      snap.docChanges().forEach(async (change) => {
        if (change.type !== "added") return;
        const candidate = change.doc.data() as RTCIceCandidateInit;
        if (pc.currentRemoteDescription) {
          await pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(() => {});
        } else {
          pendingCandidates.push(candidate);
        }
      });
    },
    () => {}
  );

  // --- 3. Firestore relay -------------------------------------------------
  const unsubFrames = onSnapshot(
    frameRef,
    (snap) => {
      const data = snap.data();
      if (!data?.frame) return;
      hasRelay = true;
      refreshTransport();
      if (!hasWebrtc) onFrame?.(data.frame, data.capturedAt || Date.now());
    },
    (err) => console.warn("[liveVideo] relay listener error:", err?.message)
  );

  // --- 4. BroadcastChannel (same browser) ---------------------------------
  let localChannel: BroadcastChannel | null = null;
  let localPing: ReturnType<typeof setInterval> | null = null;
  if ("BroadcastChannel" in window) {
    try {
      localChannel = new BroadcastChannel(localChannelName(sessionId));
      localChannel.onmessage = (event) => {
        const frame = event.data?.frame;
        if (typeof frame !== "string") return;
        hasLocal = true;
        refreshTransport();
        if (!hasWebrtc) onFrame?.(frame, event.data?.timestamp || Date.now());
      };

      // Tell a student tab in this same browser that someone is watching.
      const ping = () => localChannel?.postMessage({ type: "viewer-ping" });
      ping();
      localPing = setInterval(ping, LOCAL_PING_INTERVAL);
    } catch {
      localChannel = null;
    }
  }

  // --- cleanup ------------------------------------------------------------
  const stop = () => {
    if (stopped) return;
    stopped = true;

    clearInterval(heartbeat);
    try {
      unsubViewerDoc();
      unsubOfferCandidates();
      unsubFrames();
    } catch {
      /* ignore */
    }
    if (localPing) clearInterval(localPing);
    if (localChannel) {
      try {
        localChannel.close();
      } catch {
        /* ignore */
      }
    }
    try {
      pc.close();
    } catch {
      /* ignore */
    }

    // Remove our presence so the student stops streaming for us.
    (async () => {
      await deleteCollection(answerCandidates);
      await deleteCollection(offerCandidates);
      await deleteDoc(viewerRef).catch(() => {});
    })();
  };

  const setQuality = (next: LiveQuality) => {
    if (stopped) return;
    updateDoc(viewerRef, { quality: next }).catch(() => {});
  };

  return { stop, setQuality, viewerId };
}

/** Human-readable label for the current transport (teacher UI badge). */
export function describeTransport(transport: LiveTransport): {
  label: string;
  tone: "live" | "relay" | "off";
} {
  switch (transport) {
    case "webrtc":
      return { label: "LIVE HD", tone: "live" };
    case "local":
      return { label: "LIVE", tone: "live" };
    case "relay":
      return { label: "LIVE", tone: "relay" };
    default:
      return { label: "OFFLINE", tone: "off" };
  }
}
