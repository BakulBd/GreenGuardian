"use client";

/**
 * Green Room — WebRTC signalling over Firestore.
 *
 * Every unordered pair of participants gets one signalling document:
 *
 *   greenRoomSignals/{meetingId}/peers/{lowUid}__{highUid}
 *
 * The id is built from the two uids **sorted**, so both sides compute the same
 * path without negotiating one.
 *
 * Each side owns two fields, named by its POSITION in the sorted pair (A = the
 * smaller uid, B = the larger): its session description and its ICE candidate
 * list. Ownership is by position rather than by negotiation role because under
 * perfect negotiation either side may send an offer at any time — see
 * `./pairing`. Because the two sides write disjoint fields, neither can clobber
 * the other's description, and one listener per pair carries both directions.
 *
 * Kept separate from the peer-connection code in `mesh.ts` so the ordering
 * rules can be unit-tested without a browser or a WebRTC stack.
 */
import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  onSnapshot,
  serverTimestamp,
  setDoc,
  updateDoc,
  arrayUnion,
} from "firebase/firestore";
import { db } from "@/lib/firebase/config";
import { SIGNALS } from "./constants";

// The pairing rules live in ./pairing (no Firebase imports) so they can be
// unit-tested directly. Re-exported here so callers have one import site.
export { pairId, isInitiator, isPolite, signalFields } from "./pairing";
import { pairId, signalFields } from "./pairing";

function pairRef(meetingId: string, selfUid: string, peerUid: string) {
  return doc(collection(doc(db, SIGNALS, meetingId), "peers"), pairId(selfUid, peerUid));
}

/**
 * Publish this side's session description.
 *
 * `rev` is a per-connection counter supplied by the caller. Renegotiation can
 * legitimately produce two descriptions whose SDP text is byte-identical (a
 * repeated `replaceTrack` cycle, say), and comparing SDP strings would silently
 * swallow the second one. A counter makes "this is new" explicit.
 */
export async function publishSdp(
  meetingId: string,
  selfUid: string,
  peerUid: string,
  sdp: RTCSessionDescriptionInit,
  rev: number
): Promise<void> {
  const { mySdp } = signalFields(selfUid, peerUid);
  await setDoc(
    pairRef(meetingId, selfUid, peerUid),
    {
      meetingId,
      participants: [selfUid, peerUid].sort(),
      [mySdp]: { type: sdp.type, sdp: sdp.sdp, rev, from: selfUid },
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
}

/**
 * Append a local ICE candidate.
 *
 * `arrayUnion` rather than a subcollection: candidates arrive in a burst of a
 * handful per connection, and keeping them on the pair document means one
 * listener per peer instead of two, which matters when the listener count is
 * already O(N) per participant.
 */
export async function publishCandidate(
  meetingId: string,
  selfUid: string,
  peerUid: string,
  candidate: RTCIceCandidate
): Promise<void> {
  const { myCandidates } = signalFields(selfUid, peerUid);
  await updateDoc(pairRef(meetingId, selfUid, peerUid), {
    [myCandidates]: arrayUnion(candidate.toJSON()),
    updatedAt: serverTimestamp(),
  }).catch(async () => {
    // The pair document may not exist yet when a candidate races ahead of the
    // SDP write; create it rather than dropping the candidate.
    await setDoc(
      pairRef(meetingId, selfUid, peerUid),
      {
        meetingId,
        participants: [selfUid, peerUid].sort(),
        [myCandidates]: [candidate.toJSON()],
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
  });
}

/**
 * Clear this side's own slot.
 *
 * Called when a connection is (re)opened, so a peer that reconnects does not
 * immediately read the description and candidates from our previous session and
 * try to apply them to a brand-new `RTCPeerConnection`. Only our own fields are
 * touched — the peer's slot is theirs to manage.
 */
export async function resetOwnSlot(
  meetingId: string,
  selfUid: string,
  peerUid: string
): Promise<void> {
  const { mySdp, myCandidates } = signalFields(selfUid, peerUid);
  await setDoc(
    pairRef(meetingId, selfUid, peerUid),
    {
      meetingId,
      participants: [selfUid, peerUid].sort(),
      [mySdp]: null,
      [myCandidates]: [],
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  ).catch(() => {
    /* best-effort: a stale slot costs one ignored description, not the call */
  });
}

export interface PairSignalHandlers {
  /** The remote side's session description appeared (or changed). */
  onRemoteSdp: (sdp: RTCSessionDescriptionInit) => void;
  /** A remote ICE candidate we have not seen before. */
  onRemoteCandidate: (candidate: RTCIceCandidateInit) => void;
}

/**
 * Watch the pair document for the other side's description and ICE.
 *
 * Candidates are de-duplicated locally: `arrayUnion` re-delivers the whole
 * array on every change, and re-adding a candidate that is already applied
 * makes some browsers noisy.
 */
export function subscribeToPair(
  meetingId: string,
  selfUid: string,
  peerUid: string,
  handlers: PairSignalHandlers
): () => void {
  const { theirSdp, theirCandidates } = signalFields(selfUid, peerUid);
  const seenCandidates = new Set<string>();
  let lastRev = -1;

  return onSnapshot(
    pairRef(meetingId, selfUid, peerUid),
    (snap) => {
      const data = snap.data();
      if (!data) return;

      const remoteSdp = data[theirSdp];
      if (remoteSdp?.sdp && remoteSdp?.type) {
        const rev = Number.isFinite(Number(remoteSdp.rev)) ? Number(remoteSdp.rev) : lastRev + 1;
        if (rev > lastRev) {
          lastRev = rev;
          handlers.onRemoteSdp({ type: remoteSdp.type, sdp: remoteSdp.sdp });
        }
      }

      const candidates: any[] = Array.isArray(data[theirCandidates]) ? data[theirCandidates] : [];
      for (const candidate of candidates) {
        const key = `${candidate.candidate}|${candidate.sdpMid}|${candidate.sdpMLineIndex}`;
        if (seenCandidates.has(key)) continue;
        seenCandidates.add(key);
        handlers.onRemoteCandidate(candidate);
      }
    },
    (error) => {
      console.warn("[greenroom/signaling] pair listener error:", error);
    }
  );
}

/** Remove this pair's signalling document (called when a peer disconnects). */
export async function clearPair(
  meetingId: string,
  selfUid: string,
  peerUid: string
): Promise<void> {
  await deleteDoc(pairRef(meetingId, selfUid, peerUid)).catch(() => {
    /* best-effort: a stale pair doc is harmless, it is re-set on reconnect */
  });
}

/**
 * Delete every signalling document for a meeting.
 *
 * Called by the host when ending the meeting. Signalling blobs are useless
 * after the fact, and leaving them costs Firestore storage for nothing.
 */
export async function clearAllSignals(meetingId: string): Promise<void> {
  try {
    const snap = await getDocs(collection(doc(db, SIGNALS, meetingId), "peers"));
    await Promise.all(snap.docs.map((d) => deleteDoc(d.ref).catch(() => {})));
  } catch {
    /* best-effort cleanup */
  }
}
