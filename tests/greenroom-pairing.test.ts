import { describe, it, expect } from "vitest";
import { pairId, isInitiator, isPolite, signalFields } from "@/lib/greenroom/pairing";

/**
 * These tests pin down the invariant the whole mesh depends on: for any pair
 * of participants, both sides independently agree on ONE document name and on
 * exactly ONE offerer. If either property breaks, connections either collide
 * (glare, no media) or address different documents (no signalling at all).
 */

const uids = ["alice", "bob", "carol", "dave", "Zed", "007", "user_9", "aaa", "zzz"];

describe("pairId", () => {
  it("is order-independent", () => {
    for (const a of uids) {
      for (const b of uids) {
        if (a === b) continue;
        expect(pairId(a, b)).toBe(pairId(b, a));
      }
    }
  });

  it("puts the lexicographically smaller uid first", () => {
    expect(pairId("bob", "alice")).toBe("alice__bob");
    expect(pairId("alice", "bob")).toBe("alice__bob");
  });

  it("gives different pairs different ids", () => {
    const seen = new Set<string>();
    for (let i = 0; i < uids.length; i++) {
      for (let j = i + 1; j < uids.length; j++) {
        seen.add(pairId(uids[i], uids[j]));
      }
    }
    // n(n-1)/2 distinct pairs for n distinct uids.
    const n = uids.length;
    expect(seen.size).toBe((n * (n - 1)) / 2);
  });
});

describe("isInitiator", () => {
  it("elects exactly one initiator per pair", () => {
    for (const a of uids) {
      for (const b of uids) {
        if (a === b) continue;
        // Precisely one of the two sides offers — this is what prevents glare.
        expect(isInitiator(a, b) !== isInitiator(b, a)).toBe(true);
      }
    }
  });

  it("makes the smaller uid the offerer", () => {
    expect(isInitiator("alice", "bob")).toBe(true);
    expect(isInitiator("bob", "alice")).toBe(false);
  });

  it("is consistent with pairId's ordering", () => {
    for (const a of uids) {
      for (const b of uids) {
        if (a === b) continue;
        const first = pairId(a, b).split("__")[0];
        expect(isInitiator(a, b)).toBe(first === a);
      }
    }
  });
});

describe("signalFields", () => {
  it("gives the two sides mirrored, disjoint fields", () => {
    for (const a of uids) {
      for (const b of uids) {
        if (a === b) continue;
        const mine = signalFields(a, b);
        const theirs = signalFields(b, a);

        // What I write is what they read, and vice versa.
        expect(mine.mySdp).toBe(theirs.theirSdp);
        expect(mine.theirSdp).toBe(theirs.mySdp);
        expect(mine.myCandidates).toBe(theirs.theirCandidates);
        expect(mine.theirCandidates).toBe(theirs.myCandidates);

        // Neither side ever writes the field the other side owns.
        expect(mine.mySdp).not.toBe(mine.theirSdp);
        expect(mine.myCandidates).not.toBe(mine.theirCandidates);
      }
    }
  });

  it("names slots by position in the sorted pair, not by negotiation role", () => {
    // Position, not role: under perfect negotiation either side may send an
    // offer, so a slot called "offer" would be written by both of them.
    const smaller = signalFields("alice", "bob");
    expect(smaller.mySdp).toBe("sdpA");
    expect(smaller.myCandidates).toBe("candidatesA");

    const larger = signalFields("bob", "alice");
    expect(larger.mySdp).toBe("sdpB");
    expect(larger.myCandidates).toBe("candidatesB");
  });

  it("assigns the A slot to whichever uid sorts first", () => {
    for (const a of uids) {
      for (const b of uids) {
        if (a === b) continue;
        const expected = a < b ? "sdpA" : "sdpB";
        expect(signalFields(a, b).mySdp).toBe(expected);
      }
    }
  });
});

describe("isPolite", () => {
  it("makes exactly one side of each pair polite", () => {
    // This is what resolves an offer collision without a round-trip: one side
    // rolls back and accepts, the other holds its ground. If both were polite
    // (or both impolite) a simultaneous offer would deadlock or drop.
    for (const a of uids) {
      for (const b of uids) {
        if (a === b) continue;
        expect(isPolite(a, b) !== isPolite(b, a)).toBe(true);
      }
    }
  });

  it("makes the initiator the impolite peer", () => {
    // The initiator sent the opening offer, so letting its description survive
    // a collision converges faster.
    for (const a of uids) {
      for (const b of uids) {
        if (a === b) continue;
        expect(isPolite(a, b)).toBe(!isInitiator(a, b));
      }
    }
  });
});
