/**
 * WebRTC P2P & Firestore Signaling Service for Live Exam Proctoring Video Streams
 * Enables Zoom-style live student video feeds on teacher dashboard without VPS/SFU server.
 */

import { db } from "@/lib/firebase/config";
import { 
  collection, 
  doc, 
  setDoc, 
  onSnapshot, 
  addDoc, 
  getDocs, 
  deleteDoc, 
  serverTimestamp 
} from "firebase/firestore";

const ICE_SERVERS = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    { urls: "stun:stun2.l.google.com:19302" },
  ],
};

/**
 * Initialize WebRTC Broadcaster (Student side)
 * Publishes live MediaStream to Firestore signaling collection
 */
export async function startStudentVideoBroadcast(
  sessionId: string,
  stream: MediaStream
): Promise<() => void> {
  if (!sessionId || !stream) return () => {};

  try {
    const sessionRef = doc(db, "liveVideoSignaling", sessionId);
    const peerConnection = new RTCPeerConnection(ICE_SERVERS);
    const pendingCandidates: RTCIceCandidateInit[] = [];

    // Add local webcam video tracks to peer connection
    stream.getTracks().forEach((track) => {
      peerConnection.addTrack(track, stream);
    });

    const callerCandidatesCollection = collection(sessionRef, "callerCandidates");

    // Send ICE candidates to Firestore
    peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        addDoc(callerCandidatesCollection, event.candidate.toJSON()).catch(() => {});
      }
    };

    // Create SDP Offer
    const offer = await peerConnection.createOffer({
      offerToReceiveAudio: false,
      offerToReceiveVideo: true,
    });
    await peerConnection.setLocalDescription(offer);

    const roomWithOffer = {
      offer: {
        type: offer.type,
        sdp: offer.sdp,
      },
      updatedAt: serverTimestamp(),
    };
    await setDoc(sessionRef, roomWithOffer, { merge: true });

    // Listen for Answer from Teacher viewer
    const unsubRoom = onSnapshot(sessionRef, async (snapshot) => {
      const data = snapshot.data();
      if (!peerConnection.currentRemoteDescription && data?.answer) {
        const rtcSessionDescription = new RTCSessionDescription(data.answer);
        await peerConnection.setRemoteDescription(rtcSessionDescription).catch(console.error);

        // Process any queued candidates after remote description is set
        while (pendingCandidates.length > 0) {
          const cand = pendingCandidates.shift();
          if (cand) {
            await peerConnection.addIceCandidate(new RTCIceCandidate(cand)).catch(() => {});
          }
        }
      }
    }, (error) => console.warn("Broadcaster signaling listener note:", error.message));

    // Listen for Callee ICE Candidates (Teacher side)
    const calleeCandidatesCollection = collection(sessionRef, "calleeCandidates");
    const unsubCalleeCandidates = onSnapshot(calleeCandidatesCollection, (snapshot) => {
      snapshot.docChanges().forEach(async (change) => {
        if (change.type === "added") {
          const candData = change.doc.data();
          if (peerConnection.remoteDescription && peerConnection.remoteDescription.type) {
            await peerConnection.addIceCandidate(new RTCIceCandidate(candData)).catch(() => {});
          } else {
            pendingCandidates.push(candData);
          }
        }
      });
    }, (error) => console.warn("Callee candidate listener note:", error.message));

    // Cleanup function
    return () => {
      unsubRoom();
      unsubCalleeCandidates();
      peerConnection.close();
      deleteDoc(sessionRef).catch(() => {});
    };
  } catch (error) {
    console.error("Failed to start student video broadcast:", error);
    return () => {};
  }
}

/**
 * Connect to Student Live Video Stream (Teacher side)
 * Consumes WebRTC MediaStream and attaches to HTML5 Video element
 */
export async function connectTeacherToStudentStream(
  sessionId: string,
  onRemoteStream: (stream: MediaStream) => void
): Promise<() => void> {
  if (!sessionId) return () => {};

  try {
    const sessionRef = doc(db, "liveVideoSignaling", sessionId);
    const peerConnection = new RTCPeerConnection(ICE_SERVERS);
    const remoteStream = new MediaStream();
    const pendingCandidates: RTCIceCandidateInit[] = [];

    peerConnection.ontrack = (event) => {
      event.streams[0].getTracks().forEach((track) => {
        remoteStream.addTrack(track);
      });
      onRemoteStream(remoteStream);
    };

    const calleeCandidatesCollection = collection(sessionRef, "calleeCandidates");
    peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        addDoc(calleeCandidatesCollection, event.candidate.toJSON()).catch(() => {});
      }
    };

    // Listen for Offer from Student broadcaster
    const unsubRoom = onSnapshot(sessionRef, async (snapshot) => {
      const data = snapshot.data();
      if (data?.offer && !peerConnection.currentRemoteDescription) {
        await peerConnection.setRemoteDescription(new RTCSessionDescription(data.offer));
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);

        const roomWithAnswer = {
          answer: {
            type: answer.type,
            sdp: answer.sdp,
          },
        };
        await setDoc(sessionRef, roomWithAnswer, { merge: true });

        // Process queued candidates
        while (pendingCandidates.length > 0) {
          const cand = pendingCandidates.shift();
          if (cand) {
            await peerConnection.addIceCandidate(new RTCIceCandidate(cand)).catch(() => {});
          }
        }
      }
    }, (error) => console.warn("Viewer signaling listener note:", error.message));

    // Listen for Caller Candidates (Student side)
    const callerCandidatesCollection = collection(sessionRef, "callerCandidates");
    const unsubCallerCandidates = onSnapshot(callerCandidatesCollection, (snapshot) => {
      snapshot.docChanges().forEach(async (change) => {
        if (change.type === "added") {
          const candData = change.doc.data();
          if (peerConnection.remoteDescription && peerConnection.remoteDescription.type) {
            await peerConnection.addIceCandidate(new RTCIceCandidate(candData)).catch(() => {});
          } else {
            pendingCandidates.push(candData);
          }
        }
      });
    }, (error) => console.warn("Caller candidate listener note:", error.message));

    return () => {
      unsubRoom();
      unsubCallerCandidates();
      peerConnection.close();
    };
  } catch (error) {
    console.error("Failed to connect teacher to student video stream:", error);
    return () => {};
  }
}

/**
 * Broadcast local live video frame sequence over inter-tab BroadcastChannel
 * Enables zero-latency live video streaming on local PC testing without VPS
 */
export function subscribeToLocalLiveVideo(
  sessionId: string,
  onFrame: (frameUrl: string) => void
): () => void {
  if (typeof window === "undefined" || !("BroadcastChannel" in window)) {
    return () => {};
  }

  try {
    const channel = new BroadcastChannel(`gg_live_stream_${sessionId}`);
    channel.onmessage = (event) => {
      if (event.data && typeof event.data.frame === "string") {
        onFrame(event.data.frame);
      }
    };
    return () => channel.close();
  } catch (err) {
    console.warn("BroadcastChannel live video error:", err);
    return () => {};
  }
}

/**
 * Start streaming local video frames via BroadcastChannel (Student side)
 */
export function startLocalLiveVideoBroadcaster(
  sessionId: string,
  videoEl: HTMLVideoElement
): () => void {
  if (typeof window === "undefined" || !("BroadcastChannel" in window) || !videoEl) {
    return () => {};
  }

  let channel: BroadcastChannel | null = null;
  let intervalId: any = null;

  try {
    channel = new BroadcastChannel(`gg_live_stream_${sessionId}`);
    const canvas = document.createElement("canvas");
    canvas.width = 320;
    canvas.height = 240;
    const ctx = canvas.getContext("2d");

    intervalId = setInterval(() => {
      if (videoEl && ctx && (videoEl.videoWidth > 0 || videoEl.readyState >= 1)) {
        ctx.drawImage(videoEl, 0, 0, canvas.width, canvas.height);
        const frame = canvas.toDataURL("image/jpeg", 0.65);
        channel?.postMessage({ frame, timestamp: Date.now() });
      }
    }, 120); // ~8 FPS smooth live stream on local PC
  } catch (err) {
    console.warn("Failed to start BroadcastChannel live video stream:", err);
  }

  return () => {
    if (intervalId) clearInterval(intervalId);
    if (channel) channel.close();
  };
}
