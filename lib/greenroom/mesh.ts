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
 * THE THREE BUGS THIS MODULE WAS REPORTED FOR
 * -------------------------------------------
 * "Camera visible only to yourself", "nobody can hear me", and "participants
 * can no longer see the shared screen" were all one defect wearing three hats,
 * plus a second defect that hid any media that did get through.
 *
 *  1. **Senders were looked up by `sender.track.kind`.** Connections are opened
 *     with two transceivers so the m-line layout is stable, but a transceiver
 *     created without a track has `sender.track === null`. So
 *     `getSenders().find(s => s.track?.kind === "video")` matched NOTHING for
 *     anyone who joined with their camera off — the overwhelmingly common case.
 *     The code then fell through to `addTrack()`, which appended a SECOND video
 *     m-line instead of filling the empty one that was already there. Senders
 *     are now held directly off the transceivers created at open time, so
 *     `replaceTrack` always finds its slot and `addTrack` is never needed.
 *
 *  2. **Only one side of a pair could ever negotiate.** See `./pairing`: the
 *     answerer's `negotiationneeded` was suppressed outright, so the extra
 *     m-line from (1) was never signalled and its media never left the browser.
 *     Replaced with the spec's perfect-negotiation pattern.
 *
 *  3. **`ontrack` read `event.streams[0]`, which is empty here.** A transceiver
 *     added without an associated stream produces no `a=msid` in the SDP, so
 *     the remote's track event carries an empty `streams` array. The old
 *     handler therefore added nothing to the peer's `MediaStream` and reported
 *     an empty stream upward — a black tile even when negotiation had
 *     succeeded. `event.track` is used directly now.
 *
 * The practical consequence of the fix: toggling camera, mic, or screen share
 * is a pure `replaceTrack` on an already-negotiated sender, which needs NO
 * renegotiation at all and works identically on both sides of every pair.
 *
 * This module is intentionally the ONLY place that knows media is peer-to-peer.
 * The UI talks to it through `MeshConnection`'s events, so replacing it with an
 * SFU client later does not touch a single component.
 */
import { getIceServers } from "@/lib/services/liveVideo";
import {
  publishCandidate,
  publishSdp,
  subscribeToPair,
  clearPair,
  resetOwnSlot,
} from "./signaling";
import { isInitiator, isPolite } from "./pairing";

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
  /**
   * The two transceivers created at open time, held so their senders can be
   * addressed directly. Looking senders up by their current track is what
   * broke — an empty sender is exactly the one we need to fill.
   */
  audioSender: RTCRtpSender;
  videoSender: RTCRtpSender;
  /** Perfect-negotiation state. */
  polite: boolean;
  makingOffer: boolean;
  ignoreOffer: boolean;
  isSettingRemoteAnswerPending: boolean;
  /** Monotonic revision for our published descriptions. */
  rev: number;
  /** Candidates that arrived before `setRemoteDescription`. */
  pendingCandidates: RTCIceCandidateInit[];
}

export class MeshConnection {
  private peers = new Map<string, Peer>();
  private localStream: MediaStream | null = null;
  /** Screen-share track, published in place of the camera when present. */
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

  /** The video track we should currently be sending: screen wins over camera. */
  private outboundVideoTrack(): MediaStreamTrack | null {
    return this.screenTrack || this.localStream?.getVideoTracks()[0] || null;
  }

  private outboundAudioTrack(): MediaStreamTrack | null {
    return this.localStream?.getAudioTracks()[0] || null;
  }

  /**
   * Publish (or replace) the local camera/mic stream.
   *
   * `replaceTrack` on the sender that already exists — never `addTrack`. On an
   * already-negotiated sender this needs no renegotiation at all, so turning a
   * camera or microphone on mid-call is immediate for every peer and does not
   * depend on which side of the pair we are.
   */
  async setLocalStream(stream: MediaStream | null): Promise<void> {
    this.localStream = stream;
    await this.publishTracks();
  }

  /**
   * Start or stop sharing a screen track.
   *
   * The screen replaces the outgoing video track rather than adding a second
   * one: a second video m-line per peer would double the already-expensive
   * mesh encode cost, and every conferencing UI shows one video per participant
   * anyway (the shared screen takes the main stage). Passing `null` restores
   * the camera track, if there is one.
   */
  async setScreenTrack(track: MediaStreamTrack | null): Promise<void> {
    this.screenTrack = track;
    await this.publishTracks();
  }

  /** Push the current outbound tracks onto every peer's existing senders. */
  private async publishTracks(): Promise<void> {
    const video = this.outboundVideoTrack();
    const audio = this.outboundAudioTrack();

    await Promise.all(
      Array.from(this.peers.values()).map(async (peer) => {
        await Promise.all([
          peer.audioSender.replaceTrack(audio).catch((error) => {
            console.warn("[greenroom/mesh] audio replaceTrack failed:", error);
          }),
          peer.videoSender.replaceTrack(video).catch((error) => {
            console.warn("[greenroom/mesh] video replaceTrack failed:", error);
          }),
        ]);
      })
    );
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

    // Transceivers are created up front, by KIND, so the m-line layout is
    // fixed for the life of the connection and both sides agree on it. Their
    // senders start empty and are filled by `replaceTrack` — which is why
    // enabling a camera later never needs a new m-line.
    const audioTransceiver = pc.addTransceiver("audio", { direction: "sendrecv" });
    const videoTransceiver = pc.addTransceiver("video", { direction: "sendrecv" });

    const peer: Peer = {
      userId: peerUid,
      pc,
      stream,
      unsubscribe: () => {},
      audioSender: audioTransceiver.sender,
      videoSender: videoTransceiver.sender,
      polite: isPolite(this.selfUid, peerUid),
      makingOffer: false,
      ignoreOffer: false,
      isSettingRemoteAnswerPending: false,
      rev: 0,
      pendingCandidates: [],
    };
    this.peers.set(peerUid, peer);

    // Publish whatever we are already sending to this new peer. Failures are
    // logged rather than thrown: a peer that cannot take our camera should
    // still receive our audio.
    const video = this.outboundVideoTrack();
    const audio = this.outboundAudioTrack();
    if (audio) {
      peer.audioSender.replaceTrack(audio).catch(() => {});
    }
    if (video) {
      peer.videoSender.replaceTrack(video).catch(() => {});
    }

    pc.ontrack = (event) => {
      // `event.track`, NOT `event.streams[0]` — transceivers created without an
      // associated stream produce no msid, so `streams` is empty here and the
      // old code silently added nothing.
      const track = event.track;

      // A renegotiated connection can deliver a replacement track of a kind we
      // already hold; drop the stale one so the tile does not keep rendering it.
      for (const existing of stream.getTracks()) {
        if (existing.kind === track.kind && existing.id !== track.id) {
          stream.removeTrack(existing);
        }
      }
      if (!stream.getTracks().some((t) => t.id === track.id)) {
        stream.addTrack(track);
      }

      // A track that ends (peer stopped their camera, or the screen share was
      // stopped from the browser's own bar) must leave the stream, or the last
      // frame stays frozen on the tile.
      track.onended = () => {
        stream.removeTrack(track);
        this.events.onPeerStream(peerUid, stream);
      };

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
      // Either side may attempt it now — perfect negotiation resolves the
      // collision if both do.
      if (pc.connectionState === "failed") {
        pc.restartIce?.();
        this.negotiate(peerUid).catch(() => {});
      }
    };

    // Perfect negotiation: EITHER side may offer, at any time. This is what
    // makes "turn my camera on after joining" work for the peer that used to
    // be the permanent answerer.
    pc.onnegotiationneeded = () => {
      this.negotiate(peerUid).catch((error) => {
        console.warn("[greenroom/mesh] negotiation failed:", error);
      });
    };

    // Clear our own slot before listening, so a reconnect does not apply the
    // description we left behind in a previous session to this fresh
    // connection. Subscribing only after the reset avoids reading it back.
    resetOwnSlot(this.meetingId, this.selfUid, peerUid).finally(() => {
      if (!this.peers.has(peerUid)) return; // closed while we were resetting
      peer.unsubscribe = subscribeToPair(this.meetingId, this.selfUid, peerUid, {
        onRemoteSdp: (sdp) => this.handleRemoteSdp(peerUid, sdp).catch(() => {}),
        onRemoteCandidate: (candidate) => this.handleRemoteCandidate(peerUid, candidate),
      });

      // The initiator opens the conversation. The other side stays quiet until
      // it has something to say — which, thanks to perfect negotiation, it may
      // now say whenever it likes.
      if (isInitiator(this.selfUid, peerUid)) {
        this.negotiate(peerUid).catch(() => {});
      }
    });

    this.events.onPeerState(peerUid, "connecting");
  }

  /**
   * Create and publish an offer.
   *
   * `setLocalDescription()` with no argument lets the browser produce the right
   * description for the current signalling state, which is the documented
   * perfect-negotiation form and avoids the "created an offer while not stable"
   * race the old code guarded against by bailing out.
   */
  private async negotiate(peerUid: string): Promise<void> {
    const peer = this.peers.get(peerUid);
    if (!peer || this.closed) return;

    try {
      peer.makingOffer = true;
      await peer.pc.setLocalDescription();
      const description = peer.pc.localDescription;
      if (!description) return;
      peer.rev += 1;
      await publishSdp(this.meetingId, this.selfUid, peerUid, description, peer.rev);
    } catch (error) {
      console.warn("[greenroom/mesh] failed to create offer:", error);
    } finally {
      peer.makingOffer = false;
    }
  }

  /**
   * Apply a remote description, resolving offer collisions by politeness.
   *
   * This is the heart of perfect negotiation. When an offer arrives while we
   * have one outstanding, exactly one side backs down: the polite peer rolls
   * its own offer back and accepts theirs; the impolite peer ignores theirs and
   * lets its own stand. Both sides reach the same conclusion with no extra
   * messages.
   */
  private async handleRemoteSdp(peerUid: string, sdp: RTCSessionDescriptionInit): Promise<void> {
    const peer = this.peers.get(peerUid);
    if (!peer || this.closed) return;

    const pc = peer.pc;
    const readyForOffer =
      !peer.makingOffer && (pc.signalingState === "stable" || peer.isSettingRemoteAnswerPending);
    const offerCollision = sdp.type === "offer" && !readyForOffer;

    peer.ignoreOffer = !peer.polite && offerCollision;
    if (peer.ignoreOffer) return;

    try {
      peer.isSettingRemoteAnswerPending = sdp.type === "answer";
      await pc.setRemoteDescription(new RTCSessionDescription(sdp));
      peer.isSettingRemoteAnswerPending = false;

      this.flushCandidates(peer);

      if (sdp.type === "offer") {
        await pc.setLocalDescription();
        const description = pc.localDescription;
        if (description) {
          peer.rev += 1;
          await publishSdp(this.meetingId, this.selfUid, peerUid, description, peer.rev);
        }
      }
    } catch (error) {
      peer.isSettingRemoteAnswerPending = false;
      // A description we cannot apply is not fatal; the connection either
      // recovers on the next negotiation or the state handler restarts ICE.
      console.warn("[greenroom/mesh] setRemoteDescription failed:", error);
    }
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
      // Expected while an offer we chose to ignore is in flight.
      if (!peer.ignoreOffer) {
        console.warn("[greenroom/mesh] addIceCandidate failed:", error);
      }
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

    // Detach handlers before closing so a late event cannot resurrect state for
    // a peer we have already reported as gone.
    peer.pc.ontrack = null;
    peer.pc.onicecandidate = null;
    peer.pc.onnegotiationneeded = null;
    peer.pc.onconnectionstatechange = null;

    // Remote tracks belong to the connection; stopping them releases the
    // decoder rather than leaving it running behind a removed tile.
    for (const track of peer.stream.getTracks()) {
      track.onended = null;
      try {
        track.stop();
      } catch {
        /* already stopped */
      }
      peer.stream.removeTrack(track);
    }

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
