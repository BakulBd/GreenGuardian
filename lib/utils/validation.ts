/**
 * Comprehensive Validation Utilities for GreenGuardian
 * Ensures strict validation across all form inputs, APIs, and test cases.
 */

/**
 * Validates a person's full name.
 * - Must be at least 2 characters and at most 100 characters.
 * - Cannot be purely numeric or contain numbers/special symbols except space, dot, apostrophe, hyphen.
 */
export function validateName(name: string): { isValid: boolean; error?: string } {
  const trimmed = (name || "").trim();
  if (!trimmed) {
    return { isValid: false, error: "Full name is required." };
  }
  if (trimmed.length < 2) {
    return { isValid: false, error: "Full name must be at least 2 characters long." };
  }
  if (trimmed.length > 100) {
    return { isValid: false, error: "Full name must not exceed 100 characters." };
  }
  if (/^\d+$/.test(trimmed)) {
    return { isValid: false, error: "Full name cannot contain only numbers." };
  }
  if (/\d/.test(trimmed)) {
    return { isValid: false, error: "Full name cannot contain numbers." };
  }
  const nameRegex = /^[A-Za-z\u0980-\u09FF\s.'-]+$/;
  if (!nameRegex.test(trimmed)) {
    return { isValid: false, error: "Full name can only contain letters, spaces, dots, hyphens, and apostrophes." };
  }
  return { isValid: true };
}

/**
 * Validates an email address.
 */
export function validateEmail(email: string): { isValid: boolean; error?: string } {
  const trimmed = (email || "").trim().toLowerCase();
  if (!trimmed) {
    return { isValid: false, error: "Email address is required." };
  }
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(trimmed)) {
    return { isValid: false, error: "Please enter a valid email address (e.g. student@gmail.com)." };
  }
  return { isValid: true };
}

/**
 * Validates a password.
 * - Must be at least 6 characters.
 */
export function validatePassword(password: string): { isValid: boolean; error?: string } {
  if (!password || password.length < 6) {
    return { isValid: false, error: "Password must be at least 6 characters long." };
  }
  return { isValid: true };
}

/**
 * Validates a Student Code / ID.
 * - Must be alphanumeric/numeric (e.g. 0182220005101001 or STU-1001).
 */
export function validateStudentCode(studentCode: string): { isValid: boolean; error?: string } {
  const trimmed = (studentCode || "").trim();
  if (!trimmed) return { isValid: true }; // optional
  const codeRegex = /^[A-Za-z0-9-]+$/;
  if (!codeRegex.test(trimmed)) {
    return { isValid: false, error: "Student ID can only contain letters, numbers, and hyphens." };
  }
  return { isValid: true };
}
