import { NextResponse } from "next/server";
import { eventFor, getSession, updateSession } from "@/lib/session";
import type { SessionState } from "@/lib/sessionTypes";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const notFound = () => NextResponse.json({ error: "This session has ended or doesn't exist." }, { status: 404 });

export async function GET(_req: Request, { params }: Ctx) {
  const s = getSession((await params).id);
  return s ? NextResponse.json(eventFor(s)) : notFound();
}

export async function POST(req: Request, { params }: Ctx) {
  const s = getSession((await params).id);
  if (!s) return notFound();
  const body = await req.text();
  if (body.length > 64_000) return NextResponse.json({ error: "Session update is too large." }, { status: 413 });
  let state: SessionState | null = null;
  try { state = JSON.parse(body); } catch {}
  if (!state || typeof state !== "object" || Array.isArray(state)) {
    return NextResponse.json({ error: "Send the session state as JSON." }, { status: 400 });
  }
  updateSession(s, state);
  return NextResponse.json({ ok: true, viewers: s.listeners.size });
}
