import { NextResponse } from "next/server";
import { readProblems } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET() {
  const problems = await readProblems();
  return NextResponse.json({ ok: true, problems: problems.length });
}
