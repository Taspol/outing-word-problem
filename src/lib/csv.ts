import { checkProblem } from "./text";
import type { ProblemInput } from "./types";

/** RFC 4180 CSV: fields may be quoted, quotes inside are doubled, and quoted fields may hold commas or newlines. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      if (row.some((f) => f.trim())) rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f.trim())) rows.push(row);
  return rows;
}

const HEADER_NAMES = {
  hint: /^(hint|pattern|คำใบ้|โจทย์)$/i,
  clue: /^(clue|คำอธิบาย|ใบ้)$/i,
  answer: /^(answer|solution|คำตอบ|เฉลย)$/i,
};

/**
 * Reads an uploaded puzzle list. Accepts the app's own export (no.,Hint,Clue,Answer), any header naming the
 * Hint/Pattern, Clue and Answer columns, or no header at all (Hint,Clue,Answer, optionally after a number column).
 * Returns the puzzles plus one message per row that can't be used, numbered as in a spreadsheet.
 */
export function puzzlesFromCsv(text: string): { problems: ProblemInput[]; errors: string[] } {
  const rows = parseCsv(text.replace(/^﻿/, ""));
  if (!rows.length) return { problems: [], errors: ["The file is empty."] };

  const head = rows[0].map((c) => c.trim().replace(/\.$/, ""));
  const named = Object.fromEntries(
    Object.entries(HEADER_NAMES).map(([k, re]) => [k, head.findIndex((h) => re.test(h))]),
  ) as Record<keyof typeof HEADER_NAMES, number>;
  const hasHeader = named.hint >= 0 || /^(no|#|ลำดับ)$/i.test(head[0]);

  // Without names to go by, a leading number column means the app's own layout.
  const numbered = (rows[hasHeader ? 1 : 0]?.[0] ?? "").trim().match(/^\d+$/) || /^(no|#|ลำดับ)$/i.test(head[0]);
  const col = named.hint >= 0 ? named : numbered ? { hint: 1, clue: 2, answer: 3 } : { hint: 0, clue: 1, answer: 2 };

  const problems: ProblemInput[] = [];
  const errors: string[] = [];
  rows.slice(hasHeader ? 1 : 0).forEach((r, i) => {
    const line = i + (hasHeader ? 2 : 1);
    try {
      problems.push(checkProblem({ hint: r[col.hint] ?? "", clue: col.clue >= 0 ? r[col.clue] ?? "" : "", answer: col.answer >= 0 ? r[col.answer] ?? "" : "" }));
    } catch (e) {
      errors.push(`Row ${line}: ${(e as Error).message}`);
    }
  });
  if (!problems.length && !errors.length) errors.push("The file has no puzzles in it.");
  return { problems, errors };
}
