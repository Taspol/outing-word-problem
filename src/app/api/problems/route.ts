import { NextResponse } from "next/server";
import { addProblem, readProblems, replaceProblems, toCsv } from "@/lib/store";
import type { ProblemInput } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const problems = await readProblems();
  if (new URL(req.url).searchParams.get("format") === "csv") {
    // The BOM makes Excel open the Thai text as UTF-8.
    return new NextResponse("﻿" + toCsv(problems), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="outing_word_problem.csv"',
      },
    });
  }
  return NextResponse.json(problems);
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Partial<ProblemInput>;
  try {
    return NextResponse.json(await addProblem(body), { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}

/** Replaces the whole list. Body: { problems: [{ hint, clue, answer }, ...] } */
export async function PUT(req: Request) {
  const text = await req.text();
  if (text.length > 2_000_000) return NextResponse.json({ error: "That list is too large." }, { status: 413 });
  let body: { problems?: unknown } | null = null;
  try { body = JSON.parse(text); } catch {}
  if (!Array.isArray(body?.problems)) {
    return NextResponse.json({ error: "Send the new list as { problems: [...] }." }, { status: 400 });
  }
  try {
    return NextResponse.json(await replaceProblems(body!.problems as Partial<ProblemInput>[]));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
