import { NextResponse } from "next/server";
import { createSession, lanAddresses } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let s;
  try {
    s = createSession();
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 503 });
  }
  const url = new URL(req.url);
  const host = req.headers.get("host") ?? url.host;
  const port = host.includes(":") ? host.split(":").pop() : "";
  const proto = req.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "");
  const lanOrigins = lanAddresses().map((ip) => `${proto}://${ip}${port ? `:${port}` : ""}`);
  return NextResponse.json({ id: s.id, lanOrigins }, { status: 201 });
}
