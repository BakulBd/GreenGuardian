/**
 * LIVE end-to-end verification of the AI evaluation pipeline.
 *
 *   npm run verify:ai
 *
 * This is not part of `npm test`. It calls the REAL Gemini API with the key
 * from `.env.local` and spends real quota, and it is the only way to check the
 * thing unit tests cannot: that the model, given an actual question paper PDF
 * and an actual answer script PDF, reads both, matches answers to questions,
 * and marks them sensibly.
 *
 * What it exercises is the production code path, not a re-implementation of it:
 * `runAiEvaluation` itself, including question-paper extraction, the vision
 * pass over the script, response validation, answer-key overrides, the
 * authorship estimate, final-mark resolution and the Firestore writes.
 *
 * The only substitution is Firestore: an in-memory double stands in for the
 * live database, because verifying a feature must not mean writing test
 * submissions into a real course's records. It implements exactly the surface
 * the runner uses (doc get/update, transactions, `FieldValue.delete()`), so
 * the code under test is unmodified and the assertions are made against the
 * documents it actually wrote.
 *
 * The scripts are deliberately chosen to make marking quality visible:
 *
 *   Q1 (10 marks) — answered correctly but very briefly. Must score high:
 *                   brevity is not a defect.
 *   Q2 (10 marks) — answered at length, fluently, about the wrong topic.
 *                   Must score at or near zero: length is not a mark.
 *   Q3 (5 marks)  — a maths question with the right method and an arithmetic
 *                   slip. Must earn partial credit.
 *   Q4 (5 marks)  — left blank. Must score zero.
 */
import { describe, it, expect, beforeAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { jsPDF } from "jspdf";
import { textToPngDataUrl } from "./text-png";

import { runAiEvaluation } from "@/lib/server/ai-evaluation-runner";
import { computeAnswerFinalMarks } from "@/lib/server/final-marks";
import { isEvaluationInProgress } from "@/lib/server/ai-evaluation";

/* ------------------------------------------------------------------ *
 * Environment
 * ------------------------------------------------------------------ */

/**
 * Load `.env.local` by hand — a standalone vitest run does not go through
 * Next.js, which is what normally populates `process.env` from it. Lines in
 * this project's file are indented, so keys are trimmed before use.
 */
function loadEnvLocal(): void {
  const file = path.resolve(__dirname, "..", ".env.local");
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

/* ------------------------------------------------------------------ *
 * Test documents
 * ------------------------------------------------------------------ */

function pdfDataUrl(lines: string[]): string {
  const doc = new jsPDF();
  doc.setFontSize(12);
  let y = 20;
  for (const line of lines) {
    // Wrap so nothing runs off the page and becomes unreadable to the model.
    for (const wrapped of doc.splitTextToSize(line, 175) as string[]) {
      if (y > 280) {
        doc.addPage();
        y = 20;
      }
      doc.text(wrapped, 15, y);
      y += 7;
    }
  }
  const bytes = Buffer.from(doc.output("arraybuffer"));
  return `data:application/pdf;base64,${bytes.toString("base64")}`;
}

const QUESTION_PAPER = pdfDataUrl([
  "CSE 201 - Data Structures - Mid Term Examination",
  "Total Marks: 30      Time: 1 hour",
  "Answer all four questions.",
  "",
  "1. What is the time complexity of binary search on a sorted array of n",
  "   elements, and why?  [10 marks]",
  "",
  "2. Explain what a hash collision is and describe one method of resolving",
  "   it.  [10 marks]",
  "",
  "3. A stack is initially empty. Perform push(4), push(9), pop(), push(6),",
  "   then compute the sum of all values remaining on the stack. Show your",
  "   working.  [5 marks]",
  "",
  "4. State one advantage of a linked list over an array.  [5 marks]",
]);

const ANSWER_SCRIPT = pdfDataUrl([
  "Name: Test Student        Roll: 0182220005101001",
  "CSE 201 - Mid Term - Answer Script",
  "",
  "Answer 1.",
  "O(log n), because each comparison halves the search interval.",
  "",
  "Answer 2.",
  "The quicksort algorithm is a divide and conquer sorting technique invented",
  "by Tony Hoare. It works by selecting a pivot element from the array and",
  "partitioning the remaining elements into two sub-arrays according to",
  "whether they are less than or greater than the pivot. The sub-arrays are",
  "then sorted recursively. Quicksort is generally faster in practice than",
  "other O(n log n) algorithms such as merge sort and heapsort because its",
  "inner loop can be efficiently implemented on most architectures. In the",
  "average case it performs O(n log n) comparisons, while in the worst case,",
  "when the pivot is repeatedly the smallest or largest element, it degrades",
  "to O(n^2). Choosing a random pivot or the median of three makes the worst",
  "case very unlikely in practice. Quicksort is also an in-place algorithm,",
  "requiring only O(log n) additional space for the recursion stack, which",
  "makes it attractive when memory is constrained.",
  "",
  "Answer 3.",
  "push(4) -> stack is [4]",
  "push(9) -> stack is [4, 9]",
  "pop()   -> removes 9, stack is [4]",
  "push(6) -> stack is [4, 6]",
  "Sum of remaining values = 4 + 6 = 11",
]);

/* ------------------------------------------------------------------ *
 * In-memory Firestore double
 * ------------------------------------------------------------------ */

const DELETE_SENTINEL = "__delete__";

/** Apply a dotted-path update the way Firestore's `update()` does. */
function applyUpdate(target: Record<string, any>, patch: Record<string, any>): void {
  for (const [key, value] of Object.entries(patch)) {
    if (value && typeof value === "object" && (value as any).__sentinel === DELETE_SENTINEL) {
      if (key.includes(".")) {
        const parts = key.split(".");
        let node = target;
        for (const part of parts.slice(0, -1)) node = node?.[part] ?? {};
        delete node[parts[parts.length - 1]];
      } else {
        delete target[key];
      }
      continue;
    }
    if (key.includes(".")) {
      const parts = key.split(".");
      let node = target;
      for (const part of parts.slice(0, -1)) {
        if (typeof node[part] !== "object" || node[part] === null) node[part] = {};
        node = node[part];
      }
      node[parts[parts.length - 1]] = value;
    } else {
      target[key] = value;
    }
  }
}

function createFakeFirestore(
  seed: Record<string, Record<string, any>>,
  /** Documents returned by `questions.where("examId", "==", ...)`. */
  questionDocs: Array<Record<string, any>> = []
) {
  const store: Record<string, Record<string, any>> = JSON.parse(JSON.stringify(seed));

  const docRef = (collection: string, id: string) => ({
    id,
    async get() {
      const data = store[collection]?.[id];
      return { exists: data !== undefined, id, data: () => (data ? { ...data } : undefined) };
    },
    async update(patch: Record<string, any>) {
      const existing = store[collection]?.[id];
      if (!existing) throw new Error(`No document to update: ${collection}/${id}`);
      applyUpdate(existing, patch);
    },
  });

  const db = {
    collection: (name: string) => ({
      doc: (id: string) => docRef(name, id),
      /**
       * `loadExamQuestions` queries `questions` by examId. An upload-mode exam
       * has none — the whole point there is that the questions are read off
       * the uploaded paper — so the list is empty unless the scenario seeded
       * a structured question set.
       */
      where: () => ({
        async get() {
          const docs =
            name === "questions"
              ? questionDocs.map((q) => ({ id: q.id, data: () => ({ ...q }) }))
              : [];
          return { empty: docs.length === 0, docs };
        },
      }),
    }),
    async runTransaction(fn: (tx: any) => Promise<any>) {
      const tx = {
        get: (ref: any) => ref.get(),
        update: (ref: any, patch: Record<string, any>) => {
          applyUpdate(store[refCollection(ref)][ref.id], patch);
        },
      };
      return fn(tx);
    },
    /** Test-only reader. */
    read: (collection: string, id: string) => store[collection]?.[id],
  };

  // The double only ever holds two collections, and refs carry their id; map
  // a ref back to its collection by looking for the id.
  function refCollection(ref: any): string {
    for (const [name, docs] of Object.entries(store)) {
      if (ref.id in docs) return name;
    }
    throw new Error(`Unknown ref: ${ref.id}`);
  }

  return db;
}

/* ------------------------------------------------------------------ *
 * Verification
 * ------------------------------------------------------------------ */

const EXAM_ID = "verify-exam";
const ANSWER_ID = "verify-answer";

let db: ReturnType<typeof createFakeFirestore>;
let outcome: Awaited<ReturnType<typeof runAiEvaluation>>;
let evaluated: Record<string, any>;

beforeAll(async () => {
  loadEnvLocal();
  if (!process.env.GEMINI_API_KEY) {
    throw new Error(
      "GEMINI_API_KEY is not set. This verification calls the real API and cannot run without it."
    );
  }

  db = createFakeFirestore({
    exams: {
      [EXAM_ID]: {
        title: "CSE 201 Mid Term",
        courseName: "Data Structures",
        examMode: "upload",
        totalMarks: 30,
        teacherId: "teacher-1",
        // The teacher's uploaded question paper.
        examPapers: [
          { name: "question-paper.pdf", path: "inline:qp", url: QUESTION_PAPER, type: "application/pdf" },
        ],
      },
    },
    answers: {
      [ANSWER_ID]: {
        examId: EXAM_ID,
        sessionId: "verify-session",
        studentId: "student-1",
        totalMarks: 30,
        aiEvaluation: { status: "queued", queuedAt: new Date().toISOString() },
        aiEvaluationStatus: "queued",
        // The student's uploaded answer script.
        answerFiles: [
          { name: "answer-script.pdf", path: "inline:as", url: ANSWER_SCRIPT, type: "application/pdf" },
        ],
      },
    },
    examSessions: {
      "verify-session": { examId: EXAM_ID, studentId: "student-1", submitted: true },
    },
  });

  outcome = await runAiEvaluation({ db: db as any, answerId: ANSWER_ID, triggeredBy: "verify" });
  evaluated = db.read("answers", ANSWER_ID)!;

  // Printed so a human running this can eyeball the actual marking.
  console.log("\n=== AI EVALUATION RESULT ===");
  console.log("status:", evaluated.aiEvaluation?.status, "| model:", evaluated.aiEvaluation?.model);
  console.log(
    "AI marks:",
    evaluated.aiEvaluation?.totalMarks,
    "/",
    evaluated.aiEvaluation?.maxMarks,
    "| final:",
    evaluated.finalMarks,
    `(${evaluated.finalMarksSource})`
  );
  for (const q of evaluated.aiEvaluation?.questions ?? []) {
    console.log(
      `  Q${q.questionNumber}: ${q.awardedMarks}/${q.maxMarks} [${q.verdict}] ${String(
        q.feedback
      ).slice(0, 110)}`
    );
  }
  console.log(
    "authorship:",
    `${evaluated.authorship?.humanPercent}% human / ${evaluated.authorship?.aiPercent}% AI`,
    `(${evaluated.authorship?.status}, confidence ${evaluated.authorship?.confidence})`
  );
  console.log("============================\n");
});

describe("live AI evaluation over a real question paper and answer script", () => {
  it("completes against the real Gemini API", () => {
    expect(["completed", "needs_review"]).toContain(outcome.status);
    expect(evaluated.aiEvaluation?.model).toBeTruthy();
    expect(evaluated.aiEvaluation?.error).toBeFalsy();
  });

  it("read the questions and their marks off the uploaded question paper", () => {
    expect(evaluated.aiEvaluation?.questionSource).toBe("paper_document");
    expect(evaluated.aiEvaluation?.questions?.length).toBeGreaterThanOrEqual(4);
    // The teacher's total is authoritative, whatever the model read.
    expect(evaluated.aiEvaluation?.maxMarks).toBe(30);
  });

  it("never awards more than a question is worth", () => {
    for (const q of evaluated.aiEvaluation.questions) {
      expect(q.awardedMarks).toBeGreaterThanOrEqual(0);
      expect(q.awardedMarks).toBeLessThanOrEqual(q.maxMarks);
    }
    expect(evaluated.aiEvaluation.totalMarks).toBeLessThanOrEqual(
      evaluated.aiEvaluation.maxMarks
    );
  });

  it("gives a short but correct answer most of the marks", () => {
    const q1 = evaluated.aiEvaluation.questions[0];
    expect(q1.awardedMarks / q1.maxMarks).toBeGreaterThanOrEqual(0.6);
  });

  it("gives a long, fluent, off-topic answer close to nothing", () => {
    const q2 = evaluated.aiEvaluation.questions[1];
    expect(q2.awardedMarks / q2.maxMarks).toBeLessThanOrEqual(0.25);
  });

  it("marks the unanswered question at zero", () => {
    const last = evaluated.aiEvaluation.questions[evaluated.aiEvaluation.questions.length - 1];
    expect(last.awardedMarks).toBe(0);
  });

  it("does not score the whole paper as if submitting were enough", () => {
    expect(evaluated.aiEvaluation.totalMarks).toBeLessThan(evaluated.aiEvaluation.maxMarks);
    expect(evaluated.aiEvaluation.totalMarks).toBeGreaterThan(0);
  });

  it("gives per-question reasoning, not just numbers", () => {
    for (const q of evaluated.aiEvaluation.questions) {
      expect(typeof q.feedback).toBe("string");
      expect(q.questionText.length).toBeGreaterThan(0);
    }
    expect(evaluated.aiEvaluation.summary.length).toBeGreaterThan(0);
  });

  it("produces an authorship estimate that totals 100 and does not affect marks", () => {
    const authorship = evaluated.authorship;
    expect(authorship.humanPercent + authorship.aiPercent).toBe(100);
    expect(["likely_human", "likely_ai", "mixed", "uncertain"]).toContain(authorship.status);
    expect(authorship.affectsMarks).toBe(false);
    // The mark on the document is exactly the sum of the question marks —
    // nothing about authorship moved it.
    const sum = evaluated.aiEvaluation.questions.reduce(
      (total: number, q: any) => total + q.awardedMarks,
      0
    );
    expect(evaluated.aiEvaluation.totalMarks).toBeCloseTo(sum, 2);
  });

  it("saves the evaluation and mirrors the final mark onto the session", () => {
    expect(isEvaluationInProgress(evaluated.aiEvaluationStatus)).toBe(false);
    expect(evaluated.finalMarks).toBe(evaluated.aiEvaluation.totalMarks);
    expect(evaluated.finalMarksSource).toBe("ai");
    expect(evaluated.score).toBe(evaluated.finalMarks);

    const session = db.read("examSessions", "verify-session")!;
    expect(session.score).toBe(evaluated.finalMarks);
    expect(session.totalMarks).toBe(30);
    expect(session.aiEvaluationStatus).toBe(evaluated.aiEvaluation.status);
  });

  it("does not run a second evaluation over the same submission", async () => {
    const repeat = await runAiEvaluation({ db: db as any, answerId: ANSWER_ID });
    expect(repeat.status).toBe("skipped");
  });

  it("lets a teacher override the mark without destroying the AI evaluation", () => {
    const aiMarks = evaluated.aiEvaluation.totalMarks;
    const overridden: Record<string, any> = {
      ...evaluated,
      teacherOverride: { marks: 27, totalMarks: 30 },
    };

    const final = computeAnswerFinalMarks(overridden as any, 30);
    expect(final).toEqual({ marks: 27, totalMarks: 30, percentage: 90, source: "teacher" });

    // The AI record is exactly as it was.
    expect(overridden.aiEvaluation.totalMarks).toBe(aiMarks);
    expect(overridden.aiEvaluation.questions).toHaveLength(
      evaluated.aiEvaluation.questions.length
    );

    // Removing the override hands the mark back to the AI.
    const cleared = computeAnswerFinalMarks({ ...overridden, teacherOverride: null } as any, 30);
    expect(cleared?.marks).toBe(aiMarks);
    expect(cleared?.source).toBe("ai");
  });
});

/* ------------------------------------------------------------------ *
 * Scenario 2: an ONLINE exam with a typed answer sheet
 * ------------------------------------------------------------------ */

describe("live AI evaluation of an online exam with typed answers", () => {
  const ONLINE_EXAM = "verify-online-exam";
  const ONLINE_ANSWER = "verify-online-answer";

  /**
   * Structured questions, the way the `questions` collection stores them:
   * one option question with an answer key (the key decides, not the model),
   * and two written questions the key cannot touch.
   */
  const structuredQuestions = [
    {
      id: "sq1",
      examId: ONLINE_EXAM,
      order: 1,
      type: "mcq",
      text: "Which data structure uses First-In-First-Out ordering?",
      options: ["Stack", "Queue", "Tree", "Graph"],
      correctAnswer: "Queue",
      marks: 5,
    },
    {
      id: "sq2",
      examId: ONLINE_EXAM,
      order: 2,
      type: "long",
      text: "A car accelerates uniformly from rest to 20 m/s in 8 seconds. Calculate its acceleration and the distance travelled. Show your working.",
      marks: 10,
    },
    {
      id: "sq3",
      examId: ONLINE_EXAM,
      order: 3,
      type: "long",
      text: "Explain, in your own words, why binary search requires a sorted input.",
      marks: 5,
    },
  ];

  let onlineDb: ReturnType<typeof createFakeFirestore>;
  let onlineAnswer: Record<string, any>;

  beforeAll(async () => {
    onlineDb = createFakeFirestore(
      {
        exams: {
          [ONLINE_EXAM]: {
            title: "Mixed Online Quiz",
            courseName: "Foundations",
            examMode: "online",
            totalMarks: 20,
            teacherId: "teacher-1",
          },
        },
        answers: {
          [ONLINE_ANSWER]: {
            examId: ONLINE_EXAM,
            sessionId: "verify-online-session",
            studentId: "student-2",
            totalMarks: 20,
            grading: { obtainedMarks: 5, totalMarks: 20, accuracy: 100 },
            aiEvaluation: { status: "queued" },
            answers: {
              // Correct option — the answer key must award full marks.
              sq1: "Queue",
              // Correct method, wrong arithmetic on the distance.
              sq2: "a = (v - u)/t = (20 - 0)/8 = 2.5 m/s^2. s = ut + 0.5*a*t^2 = 0 + 0.5*2.5*64 = 90 m.",
              // Correct and short.
              sq3: "Because it keeps discarding the half of the range that cannot contain the target, which only works if order tells you which half that is.",
            },
          },
        },
        examSessions: {
          "verify-online-session": { examId: ONLINE_EXAM, studentId: "student-2", submitted: true },
        },
      },
      structuredQuestions
    );

    await runAiEvaluation({ db: onlineDb as any, answerId: ONLINE_ANSWER, triggeredBy: "verify" });
    onlineAnswer = onlineDb.read("answers", ONLINE_ANSWER)!;

    console.log("\n=== ONLINE EXAM EVALUATION ===");
    console.log(
      "status:",
      onlineAnswer.aiEvaluation?.status,
      "| AI marks:",
      onlineAnswer.aiEvaluation?.totalMarks,
      "/",
      onlineAnswer.aiEvaluation?.maxMarks
    );
    for (const q of onlineAnswer.aiEvaluation?.questions ?? []) {
      console.log(
        `  ${q.questionId}: ${q.awardedMarks}/${q.maxMarks} [${q.verdict}]` +
          `${q.gradedFromAnswerKey ? " (answer key)" : ""} ${String(q.feedback).slice(0, 90)}`
      );
    }
    console.log("==============================\n");
  });

  it("uses the teacher's structured questions rather than reading a paper", () => {
    expect(onlineAnswer.aiEvaluation?.questionSource).toBe("structured");
    expect(onlineAnswer.aiEvaluation?.maxMarks).toBe(20);
    expect(onlineAnswer.aiEvaluation?.answerSource).toBe("typed");
  });

  it("scores the option question from the answer key, not the model", () => {
    const mcq = onlineAnswer.aiEvaluation.questions.find((q: any) => q.questionId === "sq1");
    expect(mcq.gradedFromAnswerKey).toBe(true);
    expect(mcq.awardedMarks).toBe(5);
    expect(mcq.verdict).toBe("correct");
  });

  it("awards partial credit for correct method with an arithmetic slip", () => {
    const physics = onlineAnswer.aiEvaluation.questions.find((q: any) => q.questionId === "sq2");
    // Right acceleration (2.5), wrong distance (80, not 90) — neither 0 nor full.
    expect(physics.awardedMarks).toBeGreaterThan(0);
    expect(physics.awardedMarks).toBeLessThan(physics.maxMarks);
    expect(physics.gradedFromAnswerKey).toBeUndefined();
  });

  it("gives a short, correct written answer high marks", () => {
    const short = onlineAnswer.aiEvaluation.questions.find((q: any) => q.questionId === "sq3");
    expect(short.awardedMarks / short.maxMarks).toBeGreaterThanOrEqual(0.6);
  });

  it("makes the AI total the final mark, above the answer-key-only auto grade", () => {
    expect(onlineAnswer.finalMarksSource).toBe("ai");
    expect(onlineAnswer.finalMarks).toBe(onlineAnswer.aiEvaluation.totalMarks);
    // The auto-grader's own record is untouched by the AI pass.
    expect(onlineAnswer.grading.obtainedMarks).toBe(5);
  });
});

/* ------------------------------------------------------------------ *
 * Scenario 3: failure states are real, not disguised zeros
 * ------------------------------------------------------------------ */

describe("failure handling", () => {
  it("records needs_review — not a mark — when there is nothing to evaluate", async () => {
    const emptyDb = createFakeFirestore({
      exams: { e: { title: "Empty", examMode: "upload", totalMarks: 10, examPapers: [] } },
      answers: {
        a: { examId: "e", sessionId: "s", studentId: "x", aiEvaluation: { status: "queued" } },
      },
      examSessions: { s: { examId: "e", studentId: "x" } },
    });

    const result = await runAiEvaluation({ db: emptyDb as any, answerId: "a" });
    const stored = emptyDb.read("answers", "a")!;

    expect(result.status).toBe("needs_review");
    expect(stored.aiEvaluation.error).toBeTruthy();
    // Critically: no marks were invented for a submission that could not be marked.
    expect(stored.finalMarks).toBeUndefined();
    expect(stored.aiEvaluation.totalMarks).toBeUndefined();
  });

  it("reports a missing API key as a failure rather than marking anything", async () => {
    const saved = process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    try {
      const db2 = createFakeFirestore({
        exams: { e: { title: "X", examMode: "upload", totalMarks: 10 } },
        answers: {
          a: {
            examId: "e",
            sessionId: "s",
            studentId: "x",
            aiEvaluation: { status: "queued" },
            answerFiles: [{ name: "a.pdf", path: "inline:x", url: ANSWER_SCRIPT }],
          },
        },
        examSessions: { s: { examId: "e", studentId: "x" } },
      });

      const result = await runAiEvaluation({ db: db2 as any, answerId: "a" });
      expect(result.status).toBe("failed");
      expect(db2.read("answers", "a")!.aiEvaluation.error).toMatch(/GEMINI_API_KEY/);
      expect(db2.read("answers", "a")!.finalMarks).toBeUndefined();
    } finally {
      process.env.GEMINI_API_KEY = saved;
    }
  });
});

/* ------------------------------------------------------------------ *
 * Scenario 4: an answer script uploaded as an IMAGE, not a PDF
 * ------------------------------------------------------------------ */

describe("live AI evaluation of an image answer script", () => {
  const IMG_EXAM = "verify-image-exam";
  const IMG_ANSWER = "verify-image-answer";

  /**
   * A photographed answer sheet is the most common upload a student makes, and
   * it takes a different branch to a PDF only in the MIME type handed to the
   * model — but that branch has to actually be exercised to be believed. The
   * PNG is generated pixel by pixel (see `scripts/text-png.ts`) so this is a
   * genuine image the model reads with vision, not a PDF renamed.
   */
  const ANSWER_IMAGE = textToPngDataUrl([
    "ANSWER SCRIPT - PHYSICS",
    "",
    "1. SPEED = DISTANCE / TIME",
    "   = 150 / 3",
    "   = 50 M/S",
    "",
    "2. NEWTONS FIRST LAW SAYS AN",
    "   OBJECT STAYS AT REST OR IN",
    "   UNIFORM MOTION UNLESS ACTED",
    "   ON BY A NET EXTERNAL FORCE.",
  ]);

  const questions = [
    {
      id: "iq1",
      examId: IMG_EXAM,
      order: 1,
      type: "long",
      text: "A car travels 150 metres in 3 seconds. Calculate its average speed, showing your working.",
      marks: 10,
    },
    {
      id: "iq2",
      examId: IMG_EXAM,
      order: 2,
      type: "long",
      text: "State Newton's first law of motion.",
      marks: 10,
    },
  ];

  let imageDb: ReturnType<typeof createFakeFirestore>;
  let imageAnswer: Record<string, any>;

  beforeAll(async () => {
    imageDb = createFakeFirestore(
      {
        exams: {
          [IMG_EXAM]: {
            title: "Physics Class Test",
            courseName: "Physics",
            examMode: "online",
            totalMarks: 20,
            teacherId: "teacher-1",
            allowAnswerUpload: true,
          },
        },
        answers: {
          [IMG_ANSWER]: {
            examId: IMG_EXAM,
            sessionId: "verify-image-session",
            studentId: "student-3",
            totalMarks: 20,
            aiEvaluation: { status: "queued" },
            answerFiles: [
              {
                name: "answer-photo.png",
                path: "inline:img",
                url: ANSWER_IMAGE,
                type: "image/png",
              },
            ],
          },
        },
        examSessions: {
          "verify-image-session": { examId: IMG_EXAM, studentId: "student-3", submitted: true },
        },
      },
      questions
    );

    await runAiEvaluation({ db: imageDb as any, answerId: IMG_ANSWER, triggeredBy: "verify" });
    imageAnswer = imageDb.read("answers", IMG_ANSWER)!;

    console.log("\n=== IMAGE ANSWER SCRIPT EVALUATION ===");
    console.log(
      "status:",
      imageAnswer.aiEvaluation?.status,
      "| AI marks:",
      imageAnswer.aiEvaluation?.totalMarks,
      "/",
      imageAnswer.aiEvaluation?.maxMarks
    );
    for (const q of imageAnswer.aiEvaluation?.questions ?? []) {
      console.log(
        `  ${q.questionId}: ${q.awardedMarks}/${q.maxMarks} [${q.verdict}] read: ` +
          `"${String(q.studentAnswer).replace(/\s+/g, " ").slice(0, 70)}"`
      );
    }
    console.log("======================================\n");
  });

  it("evaluates a PNG answer script through the same pipeline as a PDF", () => {
    expect(["completed", "needs_review"]).toContain(imageAnswer.aiEvaluation?.status);
    expect(imageAnswer.aiEvaluation?.answerSource).toBe("files");
    expect(imageAnswer.aiEvaluation?.filesAnalyzed).toContain("answer-photo.png");
  });

  it("actually read the handwriting off the image", () => {
    // The model can only produce these if the pixels were genuinely OCR'd.
    const transcribed = (imageAnswer.aiEvaluation?.questions ?? [])
      .map((q: any) => String(q.studentAnswer))
      .join(" ")
      .toUpperCase();
    expect(transcribed).toMatch(/50/);
    expect(transcribed).toMatch(/NEWTON|FORCE|REST/);
  });

  it("marks both questions from what it read, within their maxima", () => {
    const marks = imageAnswer.aiEvaluation.questions;
    expect(marks).toHaveLength(2);
    for (const q of marks) {
      expect(q.awardedMarks).toBeLessThanOrEqual(q.maxMarks);
      expect(q.awardedMarks).toBeGreaterThan(0);
    }
    expect(imageAnswer.finalMarks).toBe(imageAnswer.aiEvaluation.totalMarks);
    expect(imageAnswer.finalMarksSource).toBe("ai");
  });
});
