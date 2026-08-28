/**
 * Regression tests for the Green Room WebRTC mesh.
 *
 * These pin down the three defects behind "my camera is only visible to me",
 * "nobody can hear me", and "participants can't see the shared screen". None of
 * them needs a real browser to catch — each was observable in the shape of the
 * `RTCPeerConnection` the mesh built:
 *
 *   1. A second m-line appeared when a track was added after connecting,
 *      because the empty pre-created sender was never found.
 *   2. The non-initiator could never publish a description.
 *   3. `ontrack` dropped the track when `event.streams` was empty.
 *
 * A fake `RTCPeerConnection` models just enough of the state machine to make
 * those observable: transceivers and their senders, `setLocalDescription()`
 * with no argument, signalling state, and the event handlers. It is not a
 * WebRTC implementation and deliberately does not try to be — it is a probe for
 * how `mesh.ts` drives the API. Real media still has to be confirmed in real
 * browsers; see the report accompanying this change.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

/* ------------------------------------------------------------------ *
 * Fakes
 * ------------------------------------------------------------------ */

class FakeTrack {
  static nextId = 0;
  readonly id = `track-${FakeTrack.nextId++}`;
  enabled = true;
  stopped = false;
  onended: (() => void) | null = null;
  constructor(readonly kind: "audio" | "video") {}
  stop() {
    this.stopped = true;
  }
}

class FakeStream {
  private tracks: FakeTrack[] = [];
  constructor(tracks: FakeTrack[] = []) {
    this.tracks = [...tracks];
  }
  getTracks() {
    return [...this.tracks];
  }
  getAudioTracks() {
    return this.tracks.filter((t) => t.kind === "audio");
  }
  getVideoTracks() {
    return this.tracks.filter((t) => t.kind === "video");
  }
  addTrack(track: FakeTrack) {
    if (!this.tracks.some((t) => t.id === track.id)) this.tracks.push(track);
  }
  removeTrack(track: FakeTrack) {
    this.tracks = this.tracks.filter((t) => t.id !== track.id);
  }
}

class FakeSender {
  track: FakeTrack | null = null;
  replaceCalls = 0;
  async replaceTrack(track: FakeTrack | null) {
    this.replaceCalls += 1;
    this.track = track;
  }
}

class FakeTransceiver {
  readonly sender = new FakeSender();
  constructor(readonly kind: string) {}
}

/** Every fake connection, so a test can inspect what the mesh built. */
const connections: FakePeerConnection[] = [];

class FakePeerConnection {
  transceivers: FakeTransceiver[] = [];
  addedTracks: FakeTrack[] = [];
  signalingState: RTCSignalingState = "stable";
  connectionState: RTCPeerConnectionState = "new";
  localDescription: any = null;
  remoteDescription: any = null;
  closed = false;
  restartIceCalls = 0;
  appliedCandidates: any[] = [];

  ontrack: ((event: any) => void) | null = null;
  onicecandidate: ((event: any) => void) | null = null;
  onnegotiationneeded: (() => void) | null = null;
  onconnectionstatechange: (() => void) | null = null;

  constructor(_config?: any) {
    connections.push(this);
  }

  addTransceiver(kind: string, _init?: any) {
    const transceiver = new FakeTransceiver(kind);
    this.transceivers.push(transceiver);
    return transceiver;
  }

  /**
   * The old code's escape hatch. Present so a regression that reintroduces it
   * is caught by the "exactly two m-lines" assertions rather than crashing.
   */
  addTrack(track: FakeTrack, _stream?: any) {
    this.addedTracks.push(track);
    const transceiver = new FakeTransceiver(track.kind);
    transceiver.sender.track = track;
    this.transceivers.push(transceiver);
    return transceiver.sender;
  }

  getSenders() {
    return this.transceivers.map((t) => t.sender);
  }

  /** Argument-less form, as perfect negotiation uses it. */
  async setLocalDescription(description?: any) {
    if (description) {
      this.localDescription = description;
    } else {
      const type = this.signalingState === "have-remote-offer" ? "answer" : "offer";
      this.localDescription = { type, sdp: `${type}-sdp-${connections.indexOf(this)}` };
    }
    this.signalingState =
      this.localDescription.type === "offer" ? "have-local-offer" : "stable";
  }

  async setRemoteDescription(description: any) {
    this.remoteDescription = description;
    this.signalingState = description.type === "offer" ? "have-remote-offer" : "stable";
  }

  async addIceCandidate(candidate: any) {
    if (!this.remoteDescription) throw new Error("no remote description");
    this.appliedCandidates.push(candidate);
  }

  restartIce() {
    this.restartIceCalls += 1;
  }

  close() {
    this.closed = true;
    this.signalingState = "closed";
  }

  /** Test helper: simulate the remote delivering a track. */
  emitTrack(track: FakeTrack, streams: any[] = []) {
    this.ontrack?.({ track, streams });
  }
}

/* ------------------------------------------------------------------ *
 * Module mocks
 * ------------------------------------------------------------------ */

const published: Array<{ from: string; to: string; sdp: any; rev: number }> = [];

vi.mock("@/lib/services/liveVideo", () => ({
  getIceServers: () => [{ urls: "stun:example.test" }],
}));

vi.mock("@/lib/greenroom/signaling", () => ({
  publishSdp: vi.fn(async (_meetingId, from, to, sdp, rev) => {
    published.push({ from, to, sdp, rev });
  }),
  publishCandidate: vi.fn(async () => {}),
  subscribeToPair: vi.fn(() => () => {}),
  clearPair: vi.fn(async () => {}),
  resetOwnSlot: vi.fn(async () => {}),
}));

// Imported after the mocks are registered.
const { MeshConnection } = await import("@/lib/greenroom/mesh");

/* ------------------------------------------------------------------ *
 * Harness
 * ------------------------------------------------------------------ */

function install() {
  (globalThis as any).RTCPeerConnection = FakePeerConnection;
  (globalThis as any).MediaStream = FakeStream;
  (globalThis as any).RTCSessionDescription = class {
    constructor(public init: any) {
      Object.assign(this, init);
    }
  };
  (globalThis as any).RTCIceCandidate = class {
    constructor(public init: any) {
      Object.assign(this, init);
    }
  };
}

interface Harness {
  mesh: InstanceType<typeof MeshConnection>;
  streams: Map<string, any>;
  states: Map<string, string>;
  gone: string[];
}

function makeMesh(selfUid: string): Harness {
  const streams = new Map<string, any>();
  const states = new Map<string, string>();
  const gone: string[] = [];
  const mesh = new MeshConnection("meeting-1", selfUid, {
    onPeerStream: (uid, stream) => streams.set(uid, stream),
    onPeerState: (uid, state) => states.set(uid, state),
    onPeerGone: (uid) => gone.push(uid),
  });
  return { mesh, streams, states, gone };
}

/** The fake connection the mesh opened for `peerUid`. */
function pcFor(harness: Harness, peerUid: string): FakePeerConnection {
  return (harness.mesh as any).peers.get(peerUid).pc as FakePeerConnection;
}

function peerRecord(harness: Harness, peerUid: string): any {
  return (harness.mesh as any).peers.get(peerUid);
}

/** `resetOwnSlot().finally(...)` defers subscription; let microtasks drain. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  connections.length = 0;
  published.length = 0;
  FakeTrack.nextId = 0;
  install();
});

/* ------------------------------------------------------------------ *
 * Tests
 * ------------------------------------------------------------------ */

describe("mesh connection setup", () => {
  it("opens exactly one connection per peer, with one audio and one video m-line", async () => {
    const alice = makeMesh("alice");
    alice.mesh.syncPeers(["bob", "carol"]);
    await settle();

    expect(connections).toHaveLength(2);
    for (const pc of connections) {
      expect(pc.transceivers.map((t) => t.kind)).toEqual(["audio", "video"]);
    }
  });

  it("is idempotent — re-syncing the same roster does not churn connections", async () => {
    const alice = makeMesh("alice");
    alice.mesh.syncPeers(["bob"]);
    await settle();
    const first = pcFor(alice, "bob");

    alice.mesh.syncPeers(["bob"]);
    alice.mesh.syncPeers(["bob"]);
    await settle();

    expect(connections).toHaveLength(1);
    expect(pcFor(alice, "bob")).toBe(first);
  });

  it("never opens a connection to itself", async () => {
    const alice = makeMesh("alice");
    alice.mesh.syncPeers(["alice", "bob"]);
    await settle();
    expect(alice.mesh.peerCount).toBe(1);
  });
});

describe("publishing media after joining (the reported camera/mic bug)", () => {
  it("fills the pre-created sender instead of adding a second m-line", async () => {
    // The exact reported scenario: join with everything off, then turn the
    // camera and microphone on.
    const alice = makeMesh("alice");
    alice.mesh.syncPeers(["bob"]);
    await settle();

    const pc = pcFor(alice, "bob");
    expect(pc.transceivers).toHaveLength(2);

    const camera = new FakeTrack("video");
    const mic = new FakeTrack("audio");
    await alice.mesh.setLocalStream(new FakeStream([camera, mic]) as any);

    // The tracks went onto the senders that already existed...
    expect(peerRecord(alice, "bob").videoSender.track).toBe(camera);
    expect(peerRecord(alice, "bob").audioSender.track).toBe(mic);
    // ...and NO extra m-line was created. This is the regression: the old code
    // called addTrack() here, producing a third and fourth transceiver whose
    // negotiation never happened.
    expect(pc.transceivers).toHaveLength(2);
    expect(pc.addedTracks).toHaveLength(0);
  });

  it("works identically for the NON-initiator, which is the side that was broken", async () => {
    // "zoe" sorts after "alice", so under the old fixed-offerer scheme zoe was
    // the permanent answerer and could never publish a new track.
    const zoe = makeMesh("zoe");
    zoe.mesh.syncPeers(["alice"]);
    await settle();

    const camera = new FakeTrack("video");
    await zoe.mesh.setLocalStream(new FakeStream([camera]) as any);

    expect(peerRecord(zoe, "alice").videoSender.track).toBe(camera);
    expect(pcFor(zoe, "alice").transceivers).toHaveLength(2);
    expect(pcFor(zoe, "alice").addedTracks).toHaveLength(0);
  });

  it("publishes to a peer that joins after the camera is already on", async () => {
    const alice = makeMesh("alice");
    const camera = new FakeTrack("video");
    const mic = new FakeTrack("audio");
    await alice.mesh.setLocalStream(new FakeStream([camera, mic]) as any);

    alice.mesh.syncPeers(["bob"]);
    await settle();

    expect(peerRecord(alice, "bob").videoSender.track).toBe(camera);
    expect(peerRecord(alice, "bob").audioSender.track).toBe(mic);
  });

  it("survives repeated camera off/on cycles without growing the connection", async () => {
    const alice = makeMesh("alice");
    alice.mesh.syncPeers(["bob"]);
    await settle();

    for (let i = 0; i < 5; i++) {
      const camera = new FakeTrack("video");
      await alice.mesh.setLocalStream(new FakeStream([camera]) as any);
      expect(peerRecord(alice, "bob").videoSender.track).toBe(camera);
      await alice.mesh.setLocalStream(null);
      expect(peerRecord(alice, "bob").videoSender.track).toBeNull();
    }
    expect(pcFor(alice, "bob").transceivers).toHaveLength(2);
  });
});

describe("screen sharing", () => {
  it("replaces the camera track on the existing video sender", async () => {
    const alice = makeMesh("alice");
    alice.mesh.syncPeers(["bob"]);
    await settle();

    const camera = new FakeTrack("video");
    await alice.mesh.setLocalStream(new FakeStream([camera]) as any);

    const screen = new FakeTrack("video");
    await alice.mesh.setScreenTrack(screen as any);

    expect(peerRecord(alice, "bob").videoSender.track).toBe(screen);
    expect(pcFor(alice, "bob").transceivers).toHaveLength(2);
  });

  it("restores the camera when sharing stops", async () => {
    const alice = makeMesh("alice");
    alice.mesh.syncPeers(["bob"]);
    await settle();

    const camera = new FakeTrack("video");
    await alice.mesh.setLocalStream(new FakeStream([camera]) as any);
    await alice.mesh.setScreenTrack(new FakeTrack("video") as any);
    await alice.mesh.setScreenTrack(null);

    expect(peerRecord(alice, "bob").videoSender.track).toBe(camera);
  });

  it("keeps the screen when the camera stream changes underneath it", async () => {
    const alice = makeMesh("alice");
    alice.mesh.syncPeers(["bob"]);
    await settle();

    const screen = new FakeTrack("video");
    await alice.mesh.setScreenTrack(screen as any);
    // Switching camera device mid-share must not knock the screen off air.
    await alice.mesh.setLocalStream(new FakeStream([new FakeTrack("video")]) as any);

    expect(peerRecord(alice, "bob").videoSender.track).toBe(screen);
  });

  it("shares with a peer who joins during an active screen share", async () => {
    const alice = makeMesh("alice");
    const screen = new FakeTrack("video");
    await alice.mesh.setScreenTrack(screen as any);

    alice.mesh.syncPeers(["bob"]);
    await settle();

    expect(peerRecord(alice, "bob").videoSender.track).toBe(screen);
  });
});

describe("receiving remote media", () => {
  it("adds the track even when event.streams is empty", async () => {
    // Transceivers created without an associated stream carry no msid, so the
    // remote track event has an empty `streams` array. The old handler read
    // `event.streams[0]` and silently added nothing — a black tile.
    const alice = makeMesh("alice");
    alice.mesh.syncPeers(["bob"]);
    await settle();

    const remote = new FakeTrack("video");
    pcFor(alice, "bob").emitTrack(remote, []);

    expect(alice.streams.get("bob").getTracks()).toContain(remote);
  });

  it("replaces a track of the same kind rather than stacking them", async () => {
    const alice = makeMesh("alice");
    alice.mesh.syncPeers(["bob"]);
    await settle();

    const first = new FakeTrack("video");
    const second = new FakeTrack("video");
    pcFor(alice, "bob").emitTrack(first, []);
    pcFor(alice, "bob").emitTrack(second, []);

    const tracks = alice.streams.get("bob").getTracks();
    expect(tracks).toHaveLength(1);
    expect(tracks[0]).toBe(second);
  });

  it("keeps audio and video side by side", async () => {
    const alice = makeMesh("alice");
    alice.mesh.syncPeers(["bob"]);
    await settle();

    pcFor(alice, "bob").emitTrack(new FakeTrack("audio"), []);
    pcFor(alice, "bob").emitTrack(new FakeTrack("video"), []);

    expect(alice.streams.get("bob").getTracks()).toHaveLength(2);
  });

  it("drops a track that ends, so the tile does not freeze on the last frame", async () => {
    const alice = makeMesh("alice");
    alice.mesh.syncPeers(["bob"]);
    await settle();

    const remote = new FakeTrack("video");
    pcFor(alice, "bob").emitTrack(remote, []);
    remote.onended?.();

    expect(alice.streams.get("bob").getTracks()).toHaveLength(0);
  });
});

describe("perfect negotiation", () => {
  it("lets the initiator open the conversation", async () => {
    const alice = makeMesh("alice");
    alice.mesh.syncPeers(["bob"]);
    await settle();

    expect(published.filter((p) => p.from === "alice" && p.to === "bob").length).toBeGreaterThan(0);
    expect(published[0].sdp.type).toBe("offer");
  });

  it("lets the NON-initiator renegotiate — the capability that was missing", async () => {
    const zoe = makeMesh("zoe");
    zoe.mesh.syncPeers(["alice"]);
    await settle();
    published.length = 0;

    // Whatever prompted it (a new track, an ICE restart), the answering side
    // must be able to send a description. The old code returned early here.
    pcFor(zoe, "alice").onnegotiationneeded?.();
    await settle();

    const fromZoe = published.filter((p) => p.from === "zoe");
    expect(fromZoe.length).toBeGreaterThan(0);
    expect(fromZoe[0].sdp.type).toBe("offer");
  });

  it("stamps an increasing revision so identical descriptions are not swallowed", async () => {
    const alice = makeMesh("alice");
    alice.mesh.syncPeers(["bob"]);
    await settle();
    pcFor(alice, "bob").onnegotiationneeded?.();
    await settle();

    const revs = published.filter((p) => p.from === "alice").map((p) => p.rev);
    expect(revs.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < revs.length; i++) expect(revs[i]).toBeGreaterThan(revs[i - 1]);
  });

  it("answers a remote offer", async () => {
    const zoe = makeMesh("zoe");
    zoe.mesh.syncPeers(["alice"]);
    await settle();
    published.length = 0;

    await (zoe.mesh as any).handleRemoteSdp("alice", { type: "offer", sdp: "remote-offer" });

    const answers = published.filter((p) => p.sdp.type === "answer");
    expect(answers).toHaveLength(1);
  });

  it("the impolite peer ignores a colliding offer", async () => {
    // alice < bob, so alice is the initiator and therefore impolite.
    const alice = makeMesh("alice");
    alice.mesh.syncPeers(["bob"]);
    await settle();

    const peer = peerRecord(alice, "bob");
    peer.makingOffer = true; // our own offer is outstanding
    published.length = 0;

    await (alice.mesh as any).handleRemoteSdp("bob", { type: "offer", sdp: "colliding" });

    expect(peer.ignoreOffer).toBe(true);
    expect(published).toHaveLength(0);
  });

  it("the polite peer yields to a colliding offer and answers it", async () => {
    // zoe > alice, so zoe is the answerer and therefore polite.
    const zoe = makeMesh("zoe");
    zoe.mesh.syncPeers(["alice"]);
    await settle();

    const peer = peerRecord(zoe, "alice");
    peer.makingOffer = true;
    published.length = 0;

    await (zoe.mesh as any).handleRemoteSdp("alice", { type: "offer", sdp: "colliding" });

    expect(peer.ignoreOffer).toBe(false);
    expect(published.filter((p) => p.sdp.type === "answer")).toHaveLength(1);
  });

  it("restarts ICE and renegotiates when a connection fails", async () => {
    const alice = makeMesh("alice");
    alice.mesh.syncPeers(["bob"]);
    await settle();

    const pc = pcFor(alice, "bob");
    published.length = 0;
    pc.connectionState = "failed";
    pc.onconnectionstatechange?.();
    await settle();

    expect(pc.restartIceCalls).toBe(1);
    expect(alice.states.get("bob")).toBe("failed");
  });
});

describe("ICE candidate handling", () => {
  it("queues candidates that arrive before the remote description", async () => {
    const alice = makeMesh("alice");
    alice.mesh.syncPeers(["bob"]);
    await settle();

    (alice.mesh as any).handleRemoteCandidate("bob", { candidate: "early" });
    expect(peerRecord(alice, "bob").pendingCandidates).toHaveLength(1);
    expect(pcFor(alice, "bob").appliedCandidates).toHaveLength(0);
  });

  it("flushes queued candidates once a description is applied", async () => {
    const alice = makeMesh("alice");
    alice.mesh.syncPeers(["bob"]);
    await settle();

    (alice.mesh as any).handleRemoteCandidate("bob", { candidate: "early-1" });
    (alice.mesh as any).handleRemoteCandidate("bob", { candidate: "early-2" });
    await (alice.mesh as any).handleRemoteSdp("bob", { type: "answer", sdp: "a" });

    expect(pcFor(alice, "bob").appliedCandidates).toHaveLength(2);
    expect(peerRecord(alice, "bob").pendingCandidates).toHaveLength(0);
  });
});

describe("teardown — no ghosts, no leaks", () => {
  it("closes the connection, stops remote tracks and reports the peer gone", async () => {
    const alice = makeMesh("alice");
    alice.mesh.syncPeers(["bob"]);
    await settle();

    const pc = pcFor(alice, "bob");
    const remote = new FakeTrack("video");
    pc.emitTrack(remote, []);

    alice.mesh.syncPeers([]);

    expect(pc.closed).toBe(true);
    expect(remote.stopped).toBe(true);
    expect(remote.onended).toBeNull();
    expect(pc.ontrack).toBeNull();
    expect(pc.onicecandidate).toBeNull();
    expect(pc.onnegotiationneeded).toBeNull();
    expect(pc.onconnectionstatechange).toBeNull();
    expect(alice.gone).toEqual(["bob"]);
    expect(alice.mesh.peerCount).toBe(0);
  });

  it("a peer leaving and rejoining produces one connection, not two", async () => {
    const alice = makeMesh("alice");
    alice.mesh.syncPeers(["bob"]);
    await settle();
    alice.mesh.syncPeers([]);
    alice.mesh.syncPeers(["bob"]);
    await settle();

    expect(alice.mesh.peerCount).toBe(1);
    const live = connections.filter((c) => !c.closed);
    expect(live).toHaveLength(1);
  });

  it("close() tears down every peer and is safe to call twice", async () => {
    const alice = makeMesh("alice");
    alice.mesh.syncPeers(["bob", "carol"]);
    await settle();

    alice.mesh.close();
    alice.mesh.close();

    expect(alice.mesh.peerCount).toBe(0);
    expect(connections.every((c) => c.closed)).toBe(true);
  });

  it("ignores syncPeers after close", async () => {
    const alice = makeMesh("alice");
    alice.mesh.close();
    alice.mesh.syncPeers(["bob"]);
    expect(alice.mesh.peerCount).toBe(0);
  });
});
