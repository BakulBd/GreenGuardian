"use client";

/**
 * Green Room — full-mesh WebRTC connection manager.
 *
 * Every participant holds one `RTCPeerConnection` to every other participant.
 * The mesh is driven entirely by the participant roster: when someone appears
 * in the roster a connection is opened to them, when they disappear it is torn
 * down. `syncPeers()` is idempotent, so it can be called on every roster
 * snapshot without churning existing connections.
 *
 * WHY MESH, AND WHAT IT COSTS
 * ---------------------------
 * There is no media server in this deployment (Vercel serverless + Firebase
 * Spark cannot host one), so media goes peer-to-peer. That means each
 * participant uploads their camera once PER PEER: connection count grows as
 * N x (N-1) / 2 and each browser's encode/upload cost grows linearly with the
 * room. Past ~8 participants ordinary hardware and home uplinks saturate.
 * `MAX_MESH_PARTICIPANTS` enforces that ceiling server-side at join time, and
 * `videoConstraintsForPeerCount()` steps resolution down as the room grows so
 * the degradation is gradual rather than a cliff.
 *
 * This module is intentionally the ONLY place that knows media is peer-to-peer.
 * The UI talks to it through `MeshConnection`'s events, so replacing it with an
 * SFU client later does not touch a single component.
 */
import { getIceServers } from "@/lib/services/liveVideo";
import { publishCandidate, publishSdp, subscribeToPair, clearPair } from "./signaling";
import { isInitiator } from "./pairing";

export type PeerConnectionState = "new" | "connecting" | "connected" | "failed" | "closed";

export interface RemotePeer {
  userId: string;
  stream: MediaStream;
  state: PeerConnectionState;
}

export interface MeshEvents {
  /** A peer's media stream became available or changed. */
  onPeerStream: (userId: string, stream: MediaStream) => void;
  /** A peer's connection state changed (drives the per-tile indicator). */
  onPeerState: (userId: string, state: PeerConnectionState) => void;
  /** A peer left the mesh entirely. */
  onPeerGone: (userId: string) => void;
}

interface Peer {
  userId: string;
  pc: RTCPeerConnection;
  stream: MediaStream;
  unsubscribe: () => void;
  /** Guards against applying an answer before the offer is set (rollback). */
  makingOffer: boolean;
  /** Candidates that arrived before `setRemoteDescription`. */
  pendingCandidates: RTCIceCandidateInit[];
}

export class MeshConnection {
  private peers = new Map<string, Peer>();
  private localStream: MediaStream | null = null;
  /** Screen-share track, published in addition to the camera when present. */
  private screenTrack: MediaStreamTrack | null = null;
  private closed = false;

  constructor(
    private readonly meetingId: string,
    private readonly selfUid: string,
    private readonly events: MeshEvents
  ) {}

  /** Number of live peer connections — drives adaptive video constraints. */
  get peerCount(): number {
    return this.peers.size;
  }

  /**
   * Publish (or replace) the local camera/mic stream.
   *
   * `replaceTrack` is used rather than removing and re-adding the track so an
   * established connection is not renegotiated — switching camera mid-call
   * should not cause a visible reconnect for everyone else.
   */
  async setLocalStream(stream: MediaStream | null): Promise<void> {
    this.localStream = stream;

    for (const peer of this.peers.values()) {
      const senders = peer.pc.getSenders();

      for (const kind of ["audio", "video"] as const) {
        const track = stream?.getTracks().find((t) => t.kind === kind) || null;
        // Don't clobber the video sender while a screen share owns it.
        if (kind === "video" && this.screenTrack) continue;

        const sender = senders.find((s) => s.track?.kind === kind);
        if (sender) {
          await sender.replaceTrack(track).catch((error) => {
            console.warn("[greenroom/mesh] replaceTrack failed:", error);
          });
        } else if (track) {
          peer.pc.addTrack(track, stream!);
        }
      }
    }
  }

  /**
   * Start or stop sharing a screen track.
   *
   * The screen replaces the outgoing video track rather than adding a second
   * one: a second video m-line per peer would double the already-expensive
   * mesh encode cost, and every conferencing UI shows one video per participant
   * anyway (the shared screen takes the main stage).
   */
  async setScreenTrack(track: MediaStreamTrack | null): Promise<void> {
    this.screenTrack = track;
    const replacement = track || this.localStream?.getVideoTracks()[0] || null;

    for (const peer of this.peers.values()) {
      const sender = peer.pc.getSenders().find((s) => s.track?.kind === "video");
      if (sender) {
        await sender.replaceTrack(replacement).catch((error) => {
          console.warn("[greenroom/mesh] screen replaceTrack failed:", error);
        });
      } else if (replacement) {
        peer.pc.addTrack(replacement, this.localStream || new MediaStream([replacement]));
      }
    }
  }

  /**
   * Reconcile the mesh against the current roster.
   *
   * Idempotent: existing peers are left alone, missing ones are created, and
   * departed ones are torn down. Safe to call on every roster snapshot.
   */
  syncPeers(peerUids: string[]): void {
    if (this.closed) return;

    const wanted = new Set(peerUids.filter((uid) => uid && uid !== this.selfUid));

    for (const uid of wanted) {
      if (!this.peers.has(uid)) this.openPeer(uid);
    }
    for (const uid of Array.from(this.peers.keys())) {
      if (!wanted.has(uid)) this.closePeer(uid);
    }
  }

  private openPeer(peerUid: string): void {
    const pc = new RTCPeerConnection({
      iceServers: getIceServers(),
      iceCandidatePoolSize: 4,
    });

    const stream = new MediaStream();
    const peer: Peer = {
      userId: peerUid,
      pc,
      stream,
      unsubscribe: () => {},
      makingOffer: false,
      pendingCandidates: [],
    };
    this.peers.set(peerUid, peer);

    // Publish our current media to this new peer.
    const videoTrack = this.screenTrack || this.localStream?.getVideoTracks()[0] || null;
    const audioTrack = this.localStream?.getAudioTracks()[0] || null;
    // Transceivers are added even when a track is absent so the m-line layout
    // is stable; otherwise enabling the camera later would force a full
    // renegotiation with every peer at once.
    pc.addTransceiver(audioTrack || "audio", { direction: "sendrecv" });
    pc.addTransceiver(videoTrack || "video", { direction: "sendrecv" });

    pc.ontrack = (event) => {
      event.streams[0]?.getTracks().forEach((track) => {
        if (!stream.getTracks().some((t) => t.id === track.id)) stream.addTrack(track);
      });
      this.events.onPeerStream(peerUid, stream);
    };

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        publishCandidate(this.meetingId, this.selfUid, peerUid, event.candidate).catch(() => {});
      }
    };

    pc.onconnectionstatechange = () => {
      const state = mapConnectionState(pc.connectionState);
      this.events.onPeerState(peerUid, state);

      // A failed connection is usually a NAT traversal problem. An ICE restart
      // is the cheap fix and works often enough to be worth trying before the
      // participant sees a dead tile; without TURN configured some pairs can
      // never connect and this will simply fail again (documented limitation).
      if (pc.connectionState === "failed" && isInitiator(this.selfUid, peerUid)) {
        this.renegotiate(peerUid, true).catch(() => {});
      }
    };

    // Only the deterministic initiator creates offers, which is what prevents
    // both sides offering at once (see signaling.ts).
    pc.onnegotiationneeded = () => {
      if (!isInitiator(this.selfUid, peerUid)) return;
      this.renegotiate(peerUid, false).catch((error) => {
        console.warn("[greenroom/mesh] negotiation failed:", error);
      });
    };

    peer.unsubscribe = subscribeToPair(this.meetingId, this.selfUid, peerUid, {
      onRemoteSdp: (sdp) => this.handleRemoteSdp(peerUid, sdp).catch(() => {}),
      onRemoteCandidate: (candidate) => this.handleRemoteCandidate(peerUid, candidate),
    });

    this.events.onPeerState(peerUid, "connecting");
  }

  private async renegotiate(peerUid: string, iceRestart: boolean): Promise<void> {
    const peer = this.peers.get(peerUid);
    if (!peer || peer.makingOffer) return;

    try {
      peer.makingOffer = true;
      const offer = await peer.pc.createOffer({ iceRestart });
      // `signalingState` can change while awaiting; bail rather than throwing.
      if (peer.pc.signalingState !== "stable") return;
      await peer.pc.setLocalDescription(offer);
      await publishSdp(this.meetingId, this.selfUid, peerUid, offer);
    } finally {
      peer.makingOffer = false;
    }
  }

  private async handleRemoteSdp(peerUid: string, sdp: RTCSessionDescriptionInit): Promise<void> {
    const peer = this.peers.get(peerUid);
    if (!peer) return;

    if (sdp.type === "offer") {
      // Only the answering side should ever receive an offer; ignoring a
      // stray one is safer than entering a renegotiation loop.
      if (isInitiator(this.selfUid, peerUid)) return;
      await peer.pc.setRemoteDescription(new RTCSessionDescription(sdp));
      this.flushCandidates(peer);
      const answer = await peer.pc.createAnswer();
      await peer.pc.setLocalDescription(answer);
      await publishSdp(this.meetingId, this.selfUid, peerUid, answer);
      return;
    }

    // An answer only makes sense while we have an outstanding local offer.
    if (peer.pc.signalingState !== "have-local-offer") return;
    await peer.pc.setRemoteDescription(new RTCSessionDescription(sdp));
    this.flushCandidates(peer);
  }

  private handleRemoteCandidate(peerUid: string, candidate: RTCIceCandidateInit): void {
    const peer = this.peers.get(peerUid);
    if (!peer) return;

    // Candidates routinely arrive before the remote description is applied.
    // Adding one then throws, so queue until there is somewhere to put it.
    if (!peer.pc.remoteDescription) {
      peer.pendingCandidates.push(candidate);
      return;
    }
    peer.pc.addIceCandidate(new RTCIceCandidate(candidate)).catch((error) => {
      console.warn("[greenroom/mesh] addIceCandidate failed:", error);
    });
  }

  private flushCandidates(peer: Peer): void {
    const queued = peer.pendingCandidates.splice(0);
    for (const candidate of queued) {
      peer.pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(() => {});
    }
  }

  private closePeer(peerUid: string): void {
    const peer = this.peers.get(peerUid);
    if (!peer) return;

    peer.unsubscribe();
    try {
      peer.pc.close();
    } catch {
      /* already closed */
    }
    this.peers.delete(peerUid);
    clearPair(this.meetingId, this.selfUid, peerUid).catch(() => {});
    this.events.onPeerGone(peerUid);
  }

  /** Tear the whole mesh down. Safe to call more than once. */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const uid of Array.from(this.peers.keys())) this.closePeer(uid);
  }
}

function mapConnectionState(state: RTCPeerConnectionState): PeerConnectionState {
  switch (state) {
    case "connected":
      return "connected";
    case "connecting":
    case "new":
      return "connecting";
    case "failed":
      return "failed";
    case "closed":
    case "disconnected":
      return "closed";
    default:
      return "new";
  }
}
