export type Problem = {
  no: number;
  hint: string; // the letter pattern with blanks, e.g. "ย _ _ ย _ _"
  clue: string;
  answer: string; // may be empty when the deck has no answer for it
};

export type ProblemInput = Pick<Problem, "hint" | "clue" | "answer">;
