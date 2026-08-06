/**
 * Single source of truth for "is this question option-based (MCQ/true-false)
 * or free-text (short answer/essay/etc.)?"
 *
 * The bug this fixes: several pages used to decide this from whether
 * `question.options` happened to be a non-empty array, instead of the
 * question's actual `type`. Because the exam creator always initializes new
 * questions with a 4-blank `options` array and never clears it when a
 * teacher switches a question to "Short Answer", any short-answer question
 * rendered as if it were multiple-choice. The stored `type` field is always
 * authoritative — this is what every renderer should key off.
 */

const OPTION_BASED_TYPES = new Set(["multiple-choice", "mcq", "true-false"]);
const FREE_TEXT_TYPES = new Set(["short-answer", "short", "long", "essay", "descriptive", "code"]);

export function isOptionBasedQuestion(q: { type?: string; options?: string[] }): boolean {
  if (q.type && (OPTION_BASED_TYPES.has(q.type) || FREE_TEXT_TYPES.has(q.type))) {
    return OPTION_BASED_TYPES.has(q.type);
  }
  // Unknown/future type: fall back to whether meaningful options exist,
  // ignoring the blank placeholders a short-answer question can carry.
  return Array.isArray(q.options) && q.options.some((o) => !!o && o.trim().length > 0);
}
