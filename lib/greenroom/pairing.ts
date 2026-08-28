/**
 * Green Room — deterministic peer pairing rules for the WebRTC mesh.
 *
 * Deliberately free of Firebase and browser imports so it can be unit-tested
 * directly: these functions encode the invariants that keep the mesh from
 * deadlocking, and those invariants are worth pinning down in tests.
 *
 * THE GLARE PROBLEM, AND WHY THE FIRST FIX WAS WRONG
 * --------------------------------------------------
 * In a mesh both peers notice each other at the same moment. If both create an
 * offer, each receives one while its own is outstanding, and negotiation
 * stalls ("glare").
 *
 * This module used to solve that by electing a permanent offerer: the smaller
 * uid always offered, the larger always answered, and an offer arriving at the
 * offerer was discarded. That does prevent glare — by making renegotiation
 * impossible in one direction. The consequence was the bug this system was
 * reported for: when the ANSWERING side turned on a camera or a microphone it
 * had joined without, it had a new track to publish and no way to publish it.
 * Its `negotiationneeded` was suppressed, its offer would have been dropped,
 * and the media never left the browser. Locally the tile looked fine, because
 * a local preview needs no negotiation at all — "visible only to themselves".
 *
 * The correct fix is the WebRTC spec's own **perfect negotiation** pattern:
 * either side may offer at any time, and collisions are resolved by role. One
 * peer is *polite* — on a collision it rolls its own offer back and accepts the
 * remote one. The other is *impolite* — it ignores the incoming offer and lets
 * its own stand. Exactly one of any pair is polite, decided from the uids both
 * sides already hold, so there is still no coordination round-trip.
 *
 * `pairId` remains order-independent so both sides address the same signalling
 * document without negotiating a name.
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
 * Which side opens the connection with the first offer.
 *
 * Still deterministic, but it is now only a tie-break for who speaks first on
 * a fresh connection — NOT a permanent monopoly on offering. Either side may
 * renegotiate afterwards; see `isPolite`.
 */
export function isInitiator(selfUid: string, peerUid: string): boolean {
  return selfUid < peerUid;
}

/**
 * Is this side the *polite* peer for perfect negotiation?
 *
 * The polite peer yields when both sides offer at once: it rolls back its own
 * local offer and applies the remote one. The impolite peer ignores the
 * colliding offer. Exactly one side of a pair is polite, which is what makes
 * the collision resolvable without a round-trip.
 *
 * The initiator is impolite: it made the opening offer, so on a collision the
 * connection converges faster if its description is the one that survives.
 */
export function isPolite(selfUid: string, peerUid: string): boolean {
  return !isInitiator(selfUid, peerUid);
}

export interface SignalFieldNames {
  /** Field this side writes its session description into. */
  mySdp: "sdpA" | "sdpB";
  /** Field this side reads the remote description from. */
  theirSdp: "sdpA" | "sdpB";
  myCandidates: "candidatesA" | "candidatesB";
  theirCandidates: "candidatesA" | "candidatesB";
}

/**
 * Which fields of the shared pair document each side owns.
 *
 * Slots are named by POSITION in the sorted pair (A = smaller uid, B = larger)
 * rather than by negotiation role. Under perfect negotiation either side may
 * write an offer or an answer, so the old `offer`/`answer` field names no
 * longer describe who owns what — a renegotiation from the larger uid would
 * have had to write into the field named `offer`, which the other side reads
 * as *its own* slot. Position is stable whatever either side happens to be
 * sending, and the two sides still write strictly disjoint fields, so neither
 * can clobber the other's description or candidate list.
 */
export function signalFields(selfUid: string, peerUid: string): SignalFieldNames {
  return isInitiator(selfUid, peerUid)
    ? {
        mySdp: "sdpA",
        theirSdp: "sdpB",
        myCandidates: "candidatesA",
        theirCandidates: "candidatesB",
      }
    : {
        mySdp: "sdpB",
        theirSdp: "sdpA",
        myCandidates: "candidatesB",
        theirCandidates: "candidatesA",
      };
}
