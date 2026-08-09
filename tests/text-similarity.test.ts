import { describe, it, expect } from "vitest";
import {
  calculateTextSimilarity,
  checkAIGeneratedPatterns,
  extractComparableText,
  getSimilarityLevel,
  MATCH_REPORTING_FLOOR,
} from "@/lib/utils/text-similarity";

const ESSAY =
  "Photosynthesis is the process by which green plants convert light energy into " +
  "chemical energy. Chlorophyll in the leaves absorbs sunlight, and the plant " +
  "combines carbon dioxide and water to produce glucose and oxygen.";

describe("getSimilarityLevel", () => {
  it("maps scores onto the documented bands", () => {
    expect(getSimilarityLevel(0)).toBe("unique");
    expect(getSimilarityLevel(29)).toBe("unique");
    expect(getSimilarityLevel(30)).toBe("partial");
    expect(getSimilarityLevel(69)).toBe("partial");
    expect(getSimilarityLevel(70)).toBe("plagiarized");
    expect(getSimilarityLevel(100)).toBe("plagiarized");
  });
});

describe("calculateTextSimilarity", () => {
  it("scores an identical copy as fully plagiarised", () => {
    const score = calculateTextSimilarity(ESSAY, ESSAY);
    expect(score).toBe(100);
    expect(getSimilarityLevel(score)).toBe("plagiarized");
  });

  it("still catches a copy with punctuation and casing changed", () => {
    const disguised = ESSAY.toUpperCase().replace(/[.,]/g, "");
    expect(calculateTextSimilarity(ESSAY, disguised)).toBeGreaterThanOrEqual(90);
  });

  it("scores unrelated answers in the 'unique' band", () => {
    const unrelated =
      "The French Revolution began in 1789 and reshaped European politics for " +
      "a century, ending the absolute monarchy and introducing new civic rights.";
    const score = calculateTextSimilarity(ESSAY, unrelated);
    // Not asserted below MATCH_REPORTING_FLOOR: shared English stopwords put
    // any two prose answers around 20%, so unrelated pairs do get listed as
    // low-percentage matches. What matters is that the verdict stays "unique".
    expect(getSimilarityLevel(score)).toBe("unique");
    expect(score).toBeLessThan(30);
  });

  it("scores empty or wordless text as 0, not as a match", () => {
    // Regression: `"".split(" ")` produces one empty token, which used to give
    // two blank submissions a perfect cosine score (60 overall, "partial").
    expect(calculateTextSimilarity("", "")).toBe(0);
    expect(calculateTextSimilarity(ESSAY, "")).toBe(0);
    expect(calculateTextSimilarity("!!!", "???")).toBe(0);
    expect(MATCH_REPORTING_FLOOR).toBeGreaterThan(0);
  });

  it("is symmetric", () => {
    const other = ESSAY.replace("glucose and oxygen", "sugar and oxygen");
    expect(calculateTextSimilarity(ESSAY, other)).toBe(calculateTextSimilarity(other, ESSAY));
  });
});

describe("checkAIGeneratedPatterns", () => {
  it("flags an explicit model self-reference strongly", () => {
    const result = checkAIGeneratedPatterns("As an AI language model, I cannot browse.");
    expect(result.score).toBeGreaterThan(30);
    expect(result.indicators).toContain("Direct AI reference");
  });

  it("leaves ordinary student prose unflagged", () => {
    const result = checkAIGeneratedPatterns(
      "I tested the plant under a lamp for three days. It grew about two centimetres."
    );
    expect(result.score).toBeLessThanOrEqual(30);
  });

  it("caps the score at 100", () => {
    const result = checkAIGeneratedPatterns("as an ai ".repeat(50));
    expect(result.score).toBeLessThanOrEqual(100);
  });
});

describe("extractComparableText", () => {
  it("prefers OCR analysis output over every other source", () => {
    expect(
      extractComparableText({
        ocrAnalysis: { extractedText: "from ocr analysis" },
        ocrText: "from ocr text",
        answers: { q1: "typed" },
      })
    ).toBe("from ocr analysis");
  });

  it("falls back through ocrText and extractedText", () => {
    expect(extractComparableText({ ocrText: "from ocr text" })).toBe("from ocr text");
    expect(extractComparableText({ extractedText: "legacy field" })).toBe("legacy field");
  });

  it("joins typed answers when no OCR text exists", () => {
    expect(extractComparableText({ answers: { q1: "alpha", q2: "beta" } })).toBe("alpha beta");
  });

  it("returns an empty string for a submission with nothing comparable", () => {
    expect(extractComparableText({})).toBe("");
    expect(extractComparableText({ answerFiles: ["a.pdf"] })).toBe("");
  });
});
