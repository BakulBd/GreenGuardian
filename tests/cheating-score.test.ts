import { describe, it, expect } from "vitest";
import {
  calculatePracticalCheatingScore,
  EVENT_SEVERITY,
  EVENT_PENALTIES,
  ProctoringEvent,
} from "@/lib/services/proctoring";

function event(eventType: ProctoringEvent["eventType"]): ProctoringEvent {
  return {
    sessionId: "s1",
    studentId: "u1",
    examId: "e1",
    eventType,
    severity: EVENT_SEVERITY[eventType],
    message: eventType,
    timestamp: new Date(),
    penalty: EVENT_PENALTIES[eventType],
  };
}

describe("calculatePracticalCheatingScore", () => {
  it("gives a clean session a perfect, low-risk score", () => {
    const result = calculatePracticalCheatingScore([], 60);
    expect(result.score).toBe(100);
    expect(result.riskLevel).toBe("low");
  });

  it("escalates the risk level as violations accumulate", () => {
    const mild = calculatePracticalCheatingScore([event("looking_away")], 60);
    const severe = calculatePracticalCheatingScore(
      [
        event("mobile_phone_detected"),
        event("second_person_detected"),
        event("multiple_faces"),
        event("book_detected"),
      ],
      60
    );

    expect(severe.score).toBeLessThan(mild.score);
    expect(["high", "critical"]).toContain(severe.riskLevel);
  });

  it("reports a per-type breakdown", () => {
    const result = calculatePracticalCheatingScore(
      [event("tab_switch"), event("tab_switch"), event("no_face")],
      60
    );

    expect(result.breakdown.tab_switch.count).toBe(2);
    expect(result.breakdown.no_face.count).toBe(1);
    expect(result.breakdown.tab_switch.penalty).toBeGreaterThan(0);
  });

  it("is more tolerant over a longer exam", () => {
    const events = [event("tab_switch"), event("no_face")];
    const shortExam = calculatePracticalCheatingScore(events, 30);
    const longExam = calculatePracticalCheatingScore(events, 180);

    expect(longExam.score).toBeGreaterThanOrEqual(shortExam.score);
  });

  it("clamps to zero rather than going negative", () => {
    const many = Array.from({ length: 40 }, () => event("mobile_phone_detected"));
    const result = calculatePracticalCheatingScore(many, 60);

    expect(result.score).toBe(0);
    expect(result.riskLevel).toBe("critical");
  });
});
