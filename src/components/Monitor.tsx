"use client";

import { useEffect, useRef, useState } from "react";
import type { SessionEvent } from "@/lib/sessionTypes";
import HintText from "./HintText";

type Conn = "connecting" | "live" | "lost" | "missing";

export default function Monitor({ id }: { id: string }) {
  const [event, setEvent] = useState<SessionEvent | null>(null);
  const [conn, setConn] = useState<Conn>("connecting");
  const [now, setNow] = useState(() => Date.now());
  const offset = useRef(0); // server clock minus this device's clock

  useEffect(() => {
    let es: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout>;
    let stopped = false;

    const connect = async () => {
      // Check the session exists first so a bad code shows a clear message instead of retrying forever.
      const res = await fetch(`/api/session/${id}`).catch(() => null);
      if (stopped) return;
      if (res?.status === 404) { setConn("missing"); return; }
      es = new EventSource(`/api/session/${id}/events`);
      es.onmessage = (m) => {
        const e = JSON.parse(m.data) as SessionEvent;
        offset.current = e.serverNow - Date.now();
        setEvent(e);
        setConn("live");
      };
      es.onerror = () => {
        setConn("lost");
        es?.close();
        retry = setTimeout(connect, 2000);
      };
    };
    connect();
    return () => { stopped = true; es?.close(); clearTimeout(retry); };
  }, [id]);

  const st = event?.state;
  useEffect(() => {
    if (!st?.running) return;
    const t = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(t);
  }, [st?.running]);

  if (conn === "missing" || st?.ended) {
    return (
      <Shell id={id} conn={conn}>
        <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
          <p className="text-2xl font-extrabold">{st?.ended ? "Session ended" : "Session not found"}</p>
          <p className="max-w-[32ch] text-on-felt-soft">
            {st?.ended
              ? "The host closed this session. Scan the new QR code to follow the next one."
              : "Check the code, or scan the QR code on the host's screen again."}
          </p>
        </div>
      </Shell>
    );
  }

  // clock: elapsed when the state was sent + time since, measured on the server's clock
  let elapsed = st?.elapsed ?? 0;
  if (st?.running && event) elapsed += Math.max(0, now + offset.current - event.receivedAt) / 1000;
  const dur = st?.duration ?? 30;
  const left = Math.max(0, dur - elapsed);
  const shown = st?.mode === "up" ? Math.floor(elapsed) : Math.ceil(left);
  const frac = st?.mode === "up" ? Math.min(1, elapsed / dur) : left / dur;
  const timeUp = st?.done || (st?.mode !== "up" && st?.running && left <= 0);
  const warn = st?.mode === "up" ? elapsed >= dur : left <= 5 && left > 0;

  return (
    <Shell id={id} conn={conn} viewers={event?.viewers}>
      {!st?.problem ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
          <p className="text-2xl font-extrabold">Connected</p>
          <p className="text-on-felt-soft">The puzzle and answer will show here as soon as the host draws a card.</p>
        </div>
      ) : (
        <>
          <div className="w-full rounded-[18px] bg-card p-5 text-ink shadow-[0_14px_34px_rgba(0,0,0,.3)] @container sm:p-7">
            <div className="flex items-baseline justify-between font-mono text-red">
              <span className="text-lg">#{st.position}</span>
              <span className="text-sm text-muted tabular-nums">
                card {st.drawn} of {st.total}
              </span>
            </div>
            <p className="mt-1 text-xs font-semibold tracking-[.08em] text-muted uppercase">Puzzle</p>
            <HintText
              hint={st.problem.hint}
              className="font-puzzle text-[clamp(1.8rem,10cqw,3.6rem)] leading-[1.35] font-extrabold"
            />
            {st.problem.clue && (
              <>
                <p className="mt-3 text-xs font-semibold tracking-[.08em] text-muted uppercase">Clue · read it out</p>
                <p className="font-puzzle text-[clamp(1.2rem,5.6cqw,1.7rem)] leading-snug font-semibold">{st.problem.clue}</p>
              </>
            )}
            <div className="mt-4 flex flex-wrap items-end justify-between gap-3 border-t border-ink/10 pt-4">
              <div>
                <p className="text-xs font-semibold tracking-[.08em] text-muted uppercase">Answer</p>
                <p className="font-puzzle text-[clamp(2rem,12cqw,4.5rem)] leading-[1.3] font-extrabold text-red">
                  {st.problem.answer || <span className="text-[.5em] text-muted">No answer saved</span>}
                </p>
              </div>
              <span
                className={`rounded-full px-3 py-1 text-sm font-semibold ${
                  st.revealed ? "bg-ink text-card" : "bg-[#fbecc4] text-[#8a5a00]"
                }`}
              >
                {st.revealed ? "Shown to players" : "Hidden from players"}
              </span>
            </div>
          </div>

          <div className="flex w-full items-center gap-4">
            <Ring frac={frac} warn={!!warn || !!timeUp} />
            <div className="min-w-0">
              <p
                className={`font-mono text-5xl tabular-nums ${timeUp ? "text-red" : ""}`}
                aria-label={`${shown} seconds`}
              >
                {shown}s
              </p>
              <p className="text-on-felt-soft">
                <strong className="text-on-felt">{timeUp ? "Time's up!" : st.status.title}</strong> · {st.status.sub}
              </p>
            </div>
          </div>
        </>
      )}

      {!!st?.history.length && (
        <div className="w-full">
          <p className="mb-2 text-xs font-semibold tracking-[.08em] text-on-felt-soft uppercase">Drawn so far</p>
          <ol className="divide-y divide-line rounded-xl bg-felt-deep text-sm tabular-nums [--hint-bg:var(--felt-deep)]">
            {[...st.history].reverse().map((h, i) => (
              <li key={i} className="flex justify-between gap-3 px-3 py-2">
                <span className="font-mono text-on-felt-soft">#{h.position}</span>
                <HintText hint={h.hint} className="min-w-0 flex-1 overflow-hidden font-puzzle" />
                <span className="font-puzzle font-semibold text-gold">{h.answer || "—"}</span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </Shell>
  );
}

function Shell({
  id,
  conn,
  viewers,
  children,
}: {
  id: string;
  conn: Conn;
  viewers?: number;
  children: React.ReactNode;
}) {
  const dot = { connecting: "bg-gold", live: "bg-[#5fd39a]", lost: "bg-red", missing: "bg-red" }[conn];
  const label = { connecting: "Connecting…", live: "Live", lost: "Reconnecting…", missing: "Not found" }[conn];
  return (
    <main className="mx-auto flex min-h-full max-w-[640px] flex-col gap-5 px-4 pt-5 pb-8">
      <header className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-extrabold tracking-tight">Outing Word Monitor</h1>
          <p className="font-mono text-sm text-on-felt-soft">Session {id}</p>
        </div>
        <span className="flex items-center gap-2 rounded-full bg-row px-3 py-1.5 text-sm" aria-live="polite">
          <span className={`size-2.5 rounded-full ${dot} ${conn === "live" ? "animate-pulse" : ""}`} />
          {label}
          {conn === "live" && viewers ? <span className="text-on-felt-soft">· {viewers} watching</span> : null}
        </span>
      </header>
      {children}
    </main>
  );
}

function Ring({ frac, warn }: { frac: number; warn: boolean }) {
  const r = 52;
  const c = 2 * Math.PI * r;
  return (
    <svg viewBox="0 0 120 120" aria-hidden="true" className="size-20 shrink-0 -rotate-90">
      <circle cx="60" cy="60" r={r} fill="none" strokeWidth="10" className="stroke-line" />
      <circle
        cx="60"
        cy="60"
        r={r}
        fill="none"
        strokeWidth="10"
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - frac)}
        className={`transition-[stroke-dashoffset] duration-200 ease-linear ${warn ? "stroke-red" : "stroke-gold"}`}
      />
    </svg>
  );
}
