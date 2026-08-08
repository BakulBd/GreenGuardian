import { describe, it, expect } from "vitest";
import { studentMatchesAssignment } from "@/lib/server/roster";
import { batchIdFor, sectionIdFor, sameName } from "@/lib/academics/ids";

const student = (over: Record<string, any> = {}) => ({
  id: "s1",
  role: "student",
  name: "Student",
  batch: "241",
  section: "D3",
  ...over,
});

const assignment = (over: Record<string, any> = {}) => ({
  teacherId: "t1",
  courseId: "MAT101",
  batchName: "241",
  sectionName: "D3",
  ...over,
});

describe("studentMatchesAssignment", () => {
  it("matches on batch + section", () => {
    expect(studentMatchesAssignment(student(), assignment())).toBe(true);
  });

  it("rejects a different batch with the same section name", () => {
    // "D3" exists in more than one batch; they are not the same section.
    expect(studentMatchesAssignment(student({ batch: "232" }), assignment())).toBe(false);
  });

  it("rejects a different section in the right batch", () => {
    expect(studentMatchesAssignment(student({ section: "D1" }), assignment())).toBe(false);
  });

  it("reads sections[] when the scalar section is absent", () => {
    expect(
      studentMatchesAssignment(
        student({ section: undefined, sections: ["D3", "D5"] }),
        assignment()
      )
    ).toBe(true);
  });

  it("compares names case- and whitespace-insensitively", () => {
    expect(studentMatchesAssignment(student({ section: " d3 " }), assignment())).toBe(true);
    expect(studentMatchesAssignment(student({ batch: "241 " }), assignment())).toBe(true);
  });

  it("never matches a non-student", () => {
    expect(studentMatchesAssignment(student({ role: "teacher" }), assignment())).toBe(false);
  });

  it("rejects an assignment with no section", () => {
    expect(studentMatchesAssignment(student(), assignment({ sectionName: "" }))).toBe(false);
  });

  describe("course enrolment", () => {
    it("treats an empty course list as enrolled in everything", () => {
      expect(studentMatchesAssignment(student({ courses: [] }), assignment())).toBe(true);
      expect(studentMatchesAssignment(student({ courses: undefined }), assignment())).toBe(true);
    });

    it("respects an explicit course list", () => {
      expect(studentMatchesAssignment(student({ courses: ["MAT101"] }), assignment())).toBe(true);
      expect(studentMatchesAssignment(student({ courses: ["PHY101"] }), assignment())).toBe(false);
    });

    it("accepts object-shaped course entries", () => {
      const s = student({ courses: [{ courseId: "MAT101" }] });
      expect(studentMatchesAssignment(s, assignment())).toBe(true);
    });
  });

  describe("individual-student pins", () => {
    it("covers only the pinned students", () => {
      const pinned = assignment({ studentIds: ["s1", "s9"] });
      expect(studentMatchesAssignment(student({ id: "s1" }), pinned)).toBe(true);
      expect(studentMatchesAssignment(student({ id: "s2" }), pinned)).toBe(false);
    });

    it("an empty pin array means the whole section", () => {
      expect(studentMatchesAssignment(student(), assignment({ studentIds: [] }))).toBe(true);
    });

    it("a pin naming nobody in the section matches nobody", () => {
      // This is the shape of the production bug: an assignment moved to a new
      // batch/section kept its old pin, so it covered zero students while
      // appearing to cover the section.
      const stale = assignment({ studentIds: ["someone-from-another-section"] });
      expect(studentMatchesAssignment(student(), stale)).toBe(false);
    });
  });
});

describe("catalog identifiers", () => {
  it("derives a batch id from its name", () => {
    expect(batchIdFor("241")).toBe("241");
    expect(batchIdFor("  241 ")).toBe("241");
  });

  it("scopes a section id to its batch", () => {
    expect(sectionIdFor("241", "D1")).toBe("241_D1");
    expect(sectionIdFor("232", "D1")).toBe("232_D1");
    // The same section name in two batches must not collide.
    expect(sectionIdFor("241", "D1")).not.toBe(sectionIdFor("232", "D1"));
  });

  it("keeps ids usable as Firestore document paths", () => {
    expect(batchIdFor("2024/25")).not.toContain("/");
    expect(sectionIdFor("2024 25", "D 1")).not.toContain(" ");
  });

  it("compares names leniently but not loosely", () => {
    expect(sameName("D1", " d1 ")).toBe(true);
    expect(sameName("D1", "D2")).toBe(false);
    // Empty never equals empty — an absent value is not a match.
    expect(sameName("", "")).toBe(false);
    expect(sameName(undefined, undefined)).toBe(false);
  });
});
