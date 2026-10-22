import { broadcast, eventFor, getSession } from "@/lib/session";
import type { SessionEvent } from "@/lib/sessionTypes";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

// Server-Sent Events stream: one message per state change, plus a heartbeat to keep proxies from closing it.
export async function GET(req: Request, { params }: Ctx) {
  const s = getSession((await params).id);
  if (!s) return new Response("This session has ended or doesn't exist.", { status: 404 });

  const encoder = new TextEncoder();
  let cleanup = () => {};

  const stream = new ReadableStream({
    start(controller) {
      const send = (e: SessionEvent) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(e)}\n\n`));
      const heartbeat = setInterval(() => controller.enqueue(encoder.encode(": ping\n\n")), 15000);

      s.listeners.add(send);
      send(eventFor(s));
      broadcast(s); // viewer count changed

      cleanup = () => {
        clearInterval(heartbeat);
        if (s.listeners.delete(send)) broadcast(s);
        try { controller.close(); } catch {}
      };
      req.signal.addEventListener("abort", cleanup);
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
