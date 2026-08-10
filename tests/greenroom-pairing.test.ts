import { describe, it, expect } from "vitest";
import { pairId, isInitiator, signalFields } from "@/lib/greenroom/pairing";

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

  it("has the initiator writing the offer", () => {
    const initiator = signalFields("alice", "bob");
    expect(initiator.mySdp).toBe("offer");
    expect(initiator.myCandidates).toBe("offerCandidates");

    const answerer = signalFields("bob", "alice");
    expect(answerer.mySdp).toBe("answer");
    expect(answerer.myCandidates).toBe("answerCandidates");
  });
});
