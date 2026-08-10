/**
 * Green Room — deterministic peer pairing rules for the WebRTC mesh.
 *
 * Deliberately free of Firebase and browser imports so it can be unit-tested
 * directly: these three functions encode the invariant that keeps the mesh
 * from deadlocking, and that invariant is worth pinning down in tests.
 *
 * THE GLARE PROBLEM
 * -----------------
 * In a mesh, both peers notice each other at the same moment. If both create
 * an offer, each receives an offer while it already has a local offer pending,
 * and the negotiation stalls ("glare"). The usual fixes are a rollback dance
 * or a coordination round-trip.
 *
 * Instead, order is decided from data both sides already have: the two user
 * ids, compared lexicographically. The smaller id always offers, the larger
 * always answers, and both compute the same answer independently with no
 * messages exchanged. `pairId` is likewise order-independent, so both sides
 * read and write the same signalling document without negotiating a name.
 */

/**
 * Deterministic signalling-document id for the unordered pair {a, b}.
 *
 * Order-independent by construction: `pairId(a, b) === pairId(b, a)`.
 */
export function pairId(a: string, b: string): string {
  return a < b ? `${a}__${b}` : `${b}__${a}`;
}

/**
 * Does `selfUid` create the offer when connecting to `peerUid`?
 *
 * Exactly one side of any pair gets `true`, which is what guarantees exactly
 * one offer per connection.
 */
export function isInitiator(selfUid: string, peerUid: string): boolean {
  return selfUid < peerUid;
}

export interface SignalFieldNames {
  /** Field this side writes its SDP into. */
  mySdp: "offer" | "answer";
  /** Field this side reads the remote SDP from. */
  theirSdp: "offer" | "answer";
  myCandidates: "offerCandidates" | "answerCandidates";
  theirCandidates: "offerCandidates" | "answerCandidates";
}

/**
 * Which fields of the shared pair document each side owns.
 *
 * Both peers write to disjoint fields, so neither can overwrite the other's
 * SDP or candidate list.
 */
export function signalFields(selfUid: string, peerUid: string): SignalFieldNames {
  return isInitiator(selfUid, peerUid)
    ? {
        mySdp: "offer",
        theirSdp: "answer",
        myCandidates: "offerCandidates",
        theirCandidates: "answerCandidates",
      }
    : {
        mySdp: "answer",
        theirSdp: "offer",
        myCandidates: "answerCandidates",
        theirCandidates: "offerCandidates",
      };
}
