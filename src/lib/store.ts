import "server-only";
import { promises as fs } from "fs";
import path from "path";
import { parseCsv } from "./csv";
import { checkProblem, tidy } from "./text";
import type { Problem, ProblemInput } from "./types";

// Problems live in a CSV on disk (no.,Hint,Clue,Answer). PROBLEMS_CSV points at a persistent location in
// production (e.g. a Docker volume). On first run it is filled from the bundled starter list in data/problems.csv.
const SEED = path.join(process.cwd(), "data", "problems.csv");
const FILE = process.env.PROBLEMS_CSV ?? SEED;
const HEADER = "no.,Hint,Clue,Answer";
const MAX_PROBLEMS = 1000;

export async function readProblems(): Promise<Problem[]> {
  let text: string;
  try {
    text = await fs.readFile(FILE, "utf8");
  } catch {
    if (FILE === SEED) return [];
    try {
      text = await fs.readFile(SEED, "utf8");
      await fs.mkdir(path.dirname(FILE), { recursive: true });
      await fs.writeFile(FILE, text, "utf8");
    } catch {
      return [];
    }
  }
  return parseCsv(text.replace(/^﻿/, ""))
    .slice(1)
    .map(([, hint = "", clue = "", answer = ""]) => ({ hint: tidy(hint), clue: tidy(clue), answer: tidy(answer) }))
    .filter((p) => p.hint)
    .map((p, idx) => ({ no: idx + 1, ...p }));
}

const cell = (s: string) => (/[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

export function toCsv(problems: Problem[]): string {
  const rows = problems.map((p, i) => [String(i + 1), p.hint, p.clue, p.answer].map(cell).join(","));
  return [HEADER, ...rows].join("\n") + "\n";
}

async function writeProblems(problems: Problem[]): Promise<Problem[]> {
  const renumbered = problems.map((p, i) => ({ ...p, no: i + 1 }));
  await fs.mkdir(path.dirname(FILE), { recursive: true });
  const tmp = FILE + ".tmp";
  await fs.writeFile(tmp, toCsv(renumbered), "utf8");
  await fs.rename(tmp, FILE);
  return renumbered;
}

// Serialize writes so two quick edits can't clobber each other.
let queue: Promise<unknown> = Promise.resolve();
function locked<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn);
  queue = run.catch(() => {});
  return run;
}

export function addProblem(input: Partial<ProblemInput>) {
  return locked(async () => {
    const clean = checkProblem(input);
    const list = await readProblems();
    if (list.length >= MAX_PROBLEMS) throw new Error(`The list is full (${MAX_PROBLEMS} problems). Delete some first.`);
    return writeProblems([...list, { no: list.length + 1, ...clean }]);
  });
}

export function updateProblem(no: number, input: Partial<ProblemInput>) {
  return locked(async () => {
    const clean = checkProblem(input);
    const list = await readProblems();
    if (!list.some((p) => p.no === no)) throw new NotFound();
    return writeProblems(list.map((p) => (p.no === no ? { ...p, ...clean } : p)));
  });
}

/** Replaces the whole list, e.g. from an uploaded CSV. Every puzzle is checked first; nothing changes on an error. */
export function replaceProblems(inputs: Partial<ProblemInput>[]) {
  return locked(async () => {
    if (!inputs.length) throw new Error("The new list has no puzzles in it.");
    if (inputs.length > MAX_PROBLEMS) throw new Error(`Keep the list under ${MAX_PROBLEMS} puzzles.`);
    const clean = inputs.map((p, i) => {
      try { return checkProblem(p); } catch (e) { throw new Error(`Puzzle ${i + 1}: ${(e as Error).message}`); }
    });
    return writeProblems(clean.map((p, i) => ({ no: i + 1, ...p })));
  });
}

export function deleteProblem(no: number) {
  return locked(async () => {
    const list = await readProblems();
    if (!list.some((p) => p.no === no)) throw new NotFound();
    return writeProblems(list.filter((p) => p.no !== no));
  });
}

export class NotFound extends Error {
  constructor() { super("That problem no longer exists. Reload the list."); }
}
