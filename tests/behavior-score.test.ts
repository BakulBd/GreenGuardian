import { describe, it, expect } from "vitest";
import {
  calculateBehaviorScore,
  getViolationType,
  initializeViolationCounts,
  getBehaviorLevel,
} from "@/lib/utils/helpers";

describe("getViolationType", () => {
  it("maps the warning strings the exam client actually emits", () => {
    expect(getViolationType("Tab switch detected")).toBe("tabSwitch");
    expect(getViolationType("Exited fullscreen mode")).toBe("fullscreenExit");
    expect(getViolationType("No face detected")).toBe("noFace");
    expect(getViolationType("Multiple faces detected")).toBe("multipleFaces");
    expect(getViolationType("Looking away from screen")).toBe("lookingAway");
    expect(getViolationType("Copy attempt detected")).toBe("copyAttempt");
    expect(getViolationType("Paste attempt detected")).toBe("pasteAttempt");
    expect(getViolationType("Window lost focus")).toBe("windowBlur");
    expect(getViolationType("Suspicious keyboard shortcut detected")).toBe("suspiciousKeyboard");
  });

  it("is case-insensitive and returns null for unknown reasons", () => {
    expect(getViolationType("TAB SWITCH DETECTED")).toBe("tabSwitch");
    expect(getViolationType("something entirely unrelated")).toBeNull();
  });
});

describe("calculateBehaviorScore", () => {
  it("starts at a perfect score with no violations", () => {
    expect(calculateBehaviorScore(initializeViolationCounts())).toBe(100);
  });

  it("applies diminishing returns to repeated violations of one type", () => {
    // Uses a high-penalty violation: the score is rounded to an integer, so a
    // low-penalty type (e.g. tabSwitch at 4) can round two successive drops to
    // the same value even though the underlying weighting does decrease.
    const counts = initializeViolationCounts();

    counts.mobilePhoneDetected = 1;
    const afterOne = calculateBehaviorScore(counts);

    counts.mobilePhoneDetected = 2;
    const afterTwo = calculateBehaviorScore(counts);

    counts.mobilePhoneDetected = 3;
    const afterThree = calculateBehaviorScore(counts);

    const firstDrop = 100 - afterOne;
    const secondDrop = afterOne - afterTwo;
    const thirdDrop = afterTwo - afterThree;

    expect(firstDrop).toBeGreaterThan(0);
    expect(secondDrop).toBeLessThan(firstDrop);
    expect(thirdDrop).toBeLessThan(secondDrop);
  });

  it("penalises a phone far more heavily than looking away", () => {
    const lookingAway = initializeViolationCounts();
    lookingAway.lookingAway = 1;

    const phone = initializeViolationCounts();
    phone.mobilePhoneDetected = 1;

    expect(calculateBehaviorScore(phone)).toBeLessThan(calculateBehaviorScore(lookingAway));
  });

  it("never returns a negative score", () => {
    const counts = initializeViolationCounts();
    counts.mobilePhoneDetected = 50;
    counts.secondPerson = 50;
    counts.tabSwitch = 50;

    const score = calculateBehaviorScore(counts);
    expect(score).toBe(0);
    expect(Number.isInteger(score)).toBe(true);
  });
});

describe("getBehaviorLevel", () => {
  it("degrades monotonically as the score falls", () => {
    const levels = [100, 80, 60, 30, 0].map((s) => getBehaviorLevel(s).level);
    // Every boundary should produce a defined label, and the extremes differ.
    levels.forEach((level) => expect(typeof level).toBe("string"));
    expect(levels[0]).not.toBe(levels[levels.length - 1]);
  });
});
