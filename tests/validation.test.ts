import { describe, it, expect } from "vitest";
import {
  validateName,
  validateEmail,
  validatePassword,
  validateStudentCode,
} from "@/lib/utils/validation";

describe("validateName", () => {
  it("accepts ordinary names, including punctuation and Bengali script", () => {
    expect(validateName("Ayesha Rahman").isValid).toBe(true);
    expect(validateName("J. O'Neill-Smith").isValid).toBe(true);
    expect(validateName("রফিক আহমেদ").isValid).toBe(true);
  });

  it("rejects empty, too short, and over-long names", () => {
    expect(validateName("").isValid).toBe(false);
    expect(validateName("   ").isValid).toBe(false);
    expect(validateName("A").isValid).toBe(false);
    expect(validateName("a".repeat(101)).isValid).toBe(false);
    expect(validateName("a".repeat(100)).isValid).toBe(true);
  });

  it("rejects digits and symbols", () => {
    expect(validateName("12345").isValid).toBe(false);
    expect(validateName("Student 2024").isValid).toBe(false);
    expect(validateName("<script>alert(1)</script>").isValid).toBe(false);
  });
});

describe("validateEmail", () => {
  it("accepts well-formed addresses regardless of case or padding", () => {
    expect(validateEmail("student@example.com").isValid).toBe(true);
    expect(validateEmail("  Student@Example.COM  ").isValid).toBe(true);
  });

  it("rejects malformed addresses", () => {
    for (const bad of ["", "student", "student@", "@example.com", "a b@c.com", "student@example"]) {
      expect(validateEmail(bad).isValid, bad).toBe(false);
    }
  });
});

describe("validatePassword", () => {
  it("enforces the minimum length", () => {
    expect(validatePassword("12345").isValid).toBe(false);
    expect(validatePassword("123456").isValid).toBe(true);
  });

  it("treats an empty password as invalid", () => {
    expect(validatePassword("").isValid).toBe(false);
  });
});

describe("validateStudentCode", () => {
  it("is optional", () => {
    expect(validateStudentCode("").isValid).toBe(true);
  });

  it("allows alphanumeric codes with hyphens only", () => {
    expect(validateStudentCode("0182220005101001").isValid).toBe(true);
    expect(validateStudentCode("STU-1001").isValid).toBe(true);
    expect(validateStudentCode("STU 1001").isValid).toBe(false);
    expect(validateStudentCode("STU/1001").isValid).toBe(false);
  });
});
