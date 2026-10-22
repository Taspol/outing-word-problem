import type { ProblemInput } from "./types";

export const MAX_HINT = 40;
export const MAX_CLUE = 200;
export const MAX_ANSWER = 80;

/** Trim and collapse runs of whitespace; Thai text keeps its combining marks untouched. */
export function tidy(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/** Throws an Error with a readable message, or returns the cleaned-up problem. */
export function checkProblem(input: Partial<ProblemInput>): ProblemInput {
  const hint = tidy(String(input.hint ?? ""));
  const clue = tidy(String(input.clue ?? ""));
  const answer = tidy(String(input.answer ?? ""));
  if (!hint) throw new Error("Type the letter pattern, using _ for each blank");
  if (!hint.includes("_")) throw new Error("Add at least one _ blank to the pattern");
  if (hint.length > MAX_HINT) throw new Error(`Keep the pattern under ${MAX_HINT} characters.`);
  if (clue.length > MAX_CLUE) throw new Error(`Keep the clue under ${MAX_CLUE} characters.`);
  if (answer.length > MAX_ANSWER) throw new Error(`Keep the answer under ${MAX_ANSWER} characters.`);
  return { hint, clue, answer };
}

// Thai vowels and tone marks that sit above or below a letter take no width of their own.
const COMBINING = /[ัิ-ฺ็-๎]/g;

/** Roughly how many character widths a line of text takes, for sizing it to the card. */
export function visualLength(s: string): number {
  return s.replace(COMBINING, "").length;
}

// Marks that belong to the letter (or blank) before them. Sara am (ำ) is included so its circle sits over a blank.
const ATTACHED = /[ัำ-ฺ็-๎]/;

export type Slot = { base: string; marks: string };

/**
 * Splits a pattern like "เ _ี ย _" into one slot per letter or blank, each carrying the vowel and tone marks
 * written after it. Spaces only separate slots, so "ร _ _ ี" and "ร__ี" give the same slots.
 */
export function hintSlots(hint: string): Slot[] {
  const slots: Slot[] = [];
  for (const ch of hint) {
    if (/\s/.test(ch)) continue;
    if (ATTACHED.test(ch) && slots.length) slots[slots.length - 1].marks += ch;
    else slots.push({ base: ch, marks: "" });
  }
  return slots;
}
