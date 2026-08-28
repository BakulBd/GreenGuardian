/**
 * Tests for server-side validation of uploaded exam answer files.
 *
 * The browser's uploader already refuses the wrong type and an oversized file,
 * but `/api/exams/grade` takes a JSON body — a crafted request can name any
 * file it likes. These cases are the control; the uploader's are a courtesy.
 */
import { describe, it, expect } from "vitest";
import {
  ANSWER_FILE_MIME_TYPES,
  MAX_ANSWER_FILE_BYTES,
  sanitizeAnswerFiles,
  validateAnswerFiles,
} from "@/lib/server/grading";
import { ANSWER_ALLOWED_TYPES, MAX_FILE_SIZE } from "@/lib/storage/constants";

const goodPdf = {
  url: "/api/storage/download?key=answers/a.pdf&exp=1&sig=x",
  path: "answers/a.pdf",
  name: "answer.pdf",
  type: "application/pdf",
  size: 1024,
};

const goodImage = { ...goodPdf, name: "page1.jpg", type: "image/jpeg" };

describe("the client and server allow-lists agree", () => {
  it("lists the same MIME types the uploader enforces", () => {
    // The two lists are deliberately duplicated (one is client-bundled, the
    // other server-pure). This test is what keeps them from drifting.
    expect([...ANSWER_FILE_MIME_TYPES].sort()).toEqual([...ANSWER_ALLOWED_TYPES].sort());
  });

  it("uses the same size ceiling", () => {
    expect(MAX_ANSWER_FILE_BYTES).toBe(MAX_FILE_SIZE);
  });
});

describe("validateAnswerFiles", () => {
  it("accepts a submission with no files", () => {
    expect(validateAnswerFiles(undefined)).toEqual({ ok: true, files: [] });
    expect(validateAnswerFiles([])).toEqual({ ok: true, files: [] });
  });

  it("accepts PDFs and images", () => {
    const result = validateAnswerFiles([goodPdf, goodImage]);
    expect(result.ok).toBe(true);
    expect(result.files).toHaveLength(2);
  });

  it("rejects a disallowed MIME type", () => {
    const result = validateAnswerFiles([
      { ...goodPdf, name: "answer.exe", type: "application/x-msdownload" },
    ]);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/not a supported answer format/);
  });

  it("rejects a mismatched extension even when the MIME type looks fine", () => {
    // Both halves are client-supplied, so neither alone can be trusted.
    const result = validateAnswerFiles([
      { ...goodPdf, name: "payload.exe", type: "application/pdf" },
    ]);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/supported file extension/);
  });

  it("rejects an oversized file", () => {
    const result = validateAnswerFiles([{ ...goodPdf, size: MAX_ANSWER_FILE_BYTES + 1 }]);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/larger than/);
  });

  it("checks a data: URL against its own declared type, not the descriptor", () => {
    const bad = validateAnswerFiles([
      { url: "data:text/html;base64,PGh0bWw+", name: "a.pdf", type: "application/pdf", size: 10 },
    ]);
    expect(bad.ok).toBe(false);

    const good = validateAnswerFiles([
      { url: "data:application/pdf;base64,JVBERi0=", name: "a.pdf", type: "application/pdf", size: 10 },
    ]);
    expect(good.ok).toBe(true);
  });

  it("rejects the whole submission rather than silently dropping one file", () => {
    // Dropping the file the student's entire answer was in would show as an
    // empty submission they believed they had made.
    const result = validateAnswerFiles([goodPdf, { ...goodPdf, name: "x.exe", type: "text/plain" }]);
    expect(result.ok).toBe(false);
    expect(result.files).toEqual([]);
  });

  it("tolerates a missing filename from older clients", () => {
    const result = validateAnswerFiles([{ url: goodPdf.url, type: "application/pdf", size: 5 }]);
    expect(result.ok).toBe(true);
  });

  it("still drops entries the sanitizer rejects outright", () => {
    // No url, wrong shape — never reach the type checks at all.
    expect(sanitizeAnswerFiles([{ name: "x.pdf" }, null, 42])).toEqual([]);
    expect(validateAnswerFiles([{ name: "x.pdf" }])).toEqual({ ok: true, files: [] });
  });
});
