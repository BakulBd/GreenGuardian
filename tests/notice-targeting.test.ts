import { describe, it, expect } from "vitest";
import { noticeTargetsStudent } from "@/lib/firebase/notices";
import type { Notice, User } from "@/lib/types";

const student = (over: Partial<User> = {}): User =>
  ({
    id: "s1",
    name: "Student",
    email: "s1@test.com",
    role: "student",
    approved: true,
    createdAt: null,
    updatedAt: null,
    batch: "241",
    section: "D1",
    ...over,
  }) as User;

const notice = (over: Partial<Notice> = {}): Notice =>
  ({
    id: "n1",
    title: "T",
    description: "D",
    teacherId: "t1",
    teacherName: "Teacher",
    status: "published",
    targetType: "all",
    createdAt: null,
    updatedAt: null,
    ...over,
  }) as Notice;

describe("noticeTargetsStudent", () => {
  describe("section notices", () => {
    // The bug: section names are only unique within a batch, so a notice for
    // 232/D1 was also delivered to every 241/D1 student.
    const sec232D1 = notice({
      targetType: "section",
      targetSection: "D1",
      targetBatch: "232",
    });

    it("reaches the addressed batch+section", () => {
      expect(noticeTargetsStudent(sec232D1, student({ batch: "232", section: "D1" }))).toBe(true);
    });

    it("does NOT reach the same section name in another batch", () => {
      expect(noticeTargetsStudent(sec232D1, student({ batch: "241", section: "D1" }))).toBe(false);
    });

    it("does not reach another section in the addressed batch", () => {
      expect(noticeTargetsStudent(sec232D1, student({ batch: "232", section: "D2" }))).toBe(false);
    });

    it("matches students who carry sections[] instead of section", () => {
      expect(
        noticeTargetsStudent(
          sec232D1,
          student({ batch: "232", section: undefined, sections: ["D1", "D3"] })
        )
      ).toBe(true);
    });

    it("stays section-only for legacy notices with no targetBatch", () => {
      const legacy = notice({ targetType: "section", targetSection: "D1" });
      expect(noticeTargetsStudent(legacy, student({ batch: "232", section: "D1" }))).toBe(true);
      expect(noticeTargetsStudent(legacy, student({ batch: "241", section: "D1" }))).toBe(true);
      expect(noticeTargetsStudent(legacy, student({ batch: "241", section: "D2" }))).toBe(false);
    });
  });

  describe("course notices", () => {
    const courseNotice = notice({ targetType: "course", targetCourseId: "MAT101" });

    it("reaches a student with the course listed", () => {
      expect(noticeTargetsStudent(courseNotice, student({ courses: ["MAT101"] }))).toBe(true);
    });

    it("does not reach a student enrolled only in other courses", () => {
      expect(noticeTargetsStudent(courseNotice, student({ courses: ["PHY101"] }))).toBe(false);
    });

    it("reaches a student with NO course list (treated as enrolled in all)", () => {
      // Previously these students matched nothing, so course notices reached
      // almost no one — most profiles have no explicit course list.
      expect(noticeTargetsStudent(courseNotice, student({ courses: undefined }))).toBe(true);
      expect(noticeTargetsStudent(courseNotice, student({ courses: [] }))).toBe(true);
    });

    it("accepts object-shaped course entries", () => {
      const s = student({ courses: [{ courseId: "MAT101" } as any] });
      expect(noticeTargetsStudent(courseNotice, s)).toBe(true);
    });
  });

  describe("batch and semester notices", () => {
    it("matches on batch", () => {
      const n = notice({ targetType: "batch", targetBatch: "241" });
      expect(noticeTargetsStudent(n, student({ batch: "241" }))).toBe(true);
      expect(noticeTargetsStudent(n, student({ batch: "232" }))).toBe(false);
    });

    it("treats semester the same as batch", () => {
      const n = notice({ targetType: "semester", targetBatch: "241" });
      expect(noticeTargetsStudent(n, student({ batch: "241" }))).toBe(true);
      expect(noticeTargetsStudent(n, student({ batch: "232" }))).toBe(false);
    });

    it("reaches nobody when the batch is missing from the notice", () => {
      expect(noticeTargetsStudent(notice({ targetType: "batch" }), student())).toBe(false);
    });
  });

  describe("all and individual notices", () => {
    it("'all' reaches every student", () => {
      expect(noticeTargetsStudent(notice({ targetType: "all" }), student())).toBe(true);
      expect(
        noticeTargetsStudent(notice({ targetType: "all" }), student({ batch: undefined }))
      ).toBe(true);
    });

    it("'individual' reaches only the listed students", () => {
      const n = notice({ targetType: "individual", targetStudentIds: ["s1", "s9"] });
      expect(noticeTargetsStudent(n, student({ id: "s1" }))).toBe(true);
      expect(noticeTargetsStudent(n, student({ id: "s2" }))).toBe(false);
    });
  });

  it("never targets a non-student", () => {
    const teacher = student({ role: "teacher" });
    expect(noticeTargetsStudent(notice({ targetType: "all" }), teacher)).toBe(false);
  });
});
