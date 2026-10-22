"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { hintSlots, visualLength } from "@/lib/text";
import HintText from "./HintText";
import type { Problem } from "@/lib/types";
import type { SessionState } from "@/lib/sessionTypes";
import QrModal from "./QrModal";

type Mode = "down" | "up";
type Settings = { seconds: number; mode: Mode; sound: boolean };

const RADIUS = 52;
const CIRC = 2 * Math.PI * RADIUS;
const SETTINGS_KEY = "owf-settings";
const DEFAULT_SETTINGS: Settings = { seconds: 30, mode: "down", sound: true };

function clampSeconds(n: number) {
  return Math.max(1, Math.min(600, Math.round(n) || 30));
}

export default function FlipGame({ problems, active }: { problems: Problem[]; active: boolean }) {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [seen, setSeen] = useState<Set<number>>(new Set());
  const [current, setCurrent] = useState<Problem | null>(null);
  const [flipped, setFlipped] = useState(false);
  const [showAnswer, setShowAnswer] = useState(false);
  const [status, setStatus] = useState({ title: "Ready", sub: "Draw a card to start the clock" });

  // timer
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);
  const [elapsedBefore, setElapsedBefore] = useState(0);
  const [startedAt, setStartedAt] = useState(0);
  const [now, setNow] = useState(0);
  const audioRef = useRef<AudioContext | null>(null);

  // session + monitor
  const [session, setSession] = useState<{ id: string; url: string } | null>(null);
  const [begun, setBegun] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);
  const [viewers, setViewers] = useState(0);
  const [history, setHistory] = useState<SessionState["history"]>([]);
  const [beginError, setBeginError] = useState("");
  const [beginning, setBeginning] = useState(false);

  // full screen ("presenting"): the card fills the screen. Uses the browser's Fullscreen API where it
  // exists; on phones without it (iPhone Safari) it still fills the page.
  const [presenting, setPresenting] = useState(false);
  const usedFsApi = useRef(false);

  const duration = clampSeconds(settings.seconds);
  const elapsed = elapsedBefore + (running ? (now - startedAt) / 1000 : 0);

  // load / save settings
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}");
      setSettings({ ...DEFAULT_SETTINGS, ...saved, seconds: clampSeconds(Number(saved.seconds ?? 30)) });
    } catch {}
  }, []);
  const updateSettings = (patch: Partial<Settings>) => {
    setSettings((s) => {
      const next = { ...s, ...patch };
      try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(next)); } catch {}
      return next;
    });
  };

  // drop "seen" marks for problems that no longer exist
  useEffect(() => {
    setSeen((s) => new Set([...s].filter((no) => no <= problems.length)));
  }, [problems.length]);

  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setNow(performance.now()), 100);
    return () => clearInterval(id);
  }, [running]);

  const beep = useCallback(() => {
    try {
      const ctx = (audioRef.current ??= new AudioContext());
      [0, 0.25, 0.5].forEach((t, i) => {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.frequency.value = i === 2 ? 660 : 880;
        o.type = "square";
        g.gain.setValueAtTime(0.12, ctx.currentTime + t);
        g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + t + (i === 2 ? 0.5 : 0.18));
        o.connect(g).connect(ctx.destination);
        o.start(ctx.currentTime + t);
        o.stop(ctx.currentTime + t + 0.55);
      });
    } catch {}
  }, []);

  // time up
  useEffect(() => {
    if (running && settings.mode === "down" && elapsed >= duration) {
      setRunning(false);
      setElapsedBefore(duration);
      setDone(true);
      setStatus({ title: "Time's up!", sub: "Tap to show the answer" });
      if (settings.sound) beep();
    }
  }, [running, elapsed, duration, settings.mode, settings.sound, beep]);

  const startTimer = () => {
    const t = performance.now();
    setElapsedBefore(0);
    setStartedAt(t);
    setNow(t);
    setDone(false);
    setRunning(true);
  };

  const remaining = problems.filter((p) => !seen.has(p.no));

  const draw = useCallback(() => {
    if (!problems.length) return;
    if (settings.sound && !audioRef.current) {
      try { audioRef.current = new AudioContext(); } catch {}
    }
    const pool = remaining.length ? remaining : problems;
    const baseSeen = remaining.length ? seen : new Set<number>();

    const showNext = () => {
      const pick = pool[Math.floor(Math.random() * pool.length)];
      setSeen(new Set(baseSeen).add(pick.no));
      setHistory((h) => [...h, { position: problems.indexOf(pick) + 1, hint: pick.hint, answer: pick.answer }]);
      setCurrent(pick);
      setShowAnswer(false);
      setFlipped(true);
      setStatus({
        title: "Go!",
        sub: settings.mode === "down" ? "Guess the word before time runs out" : "Clock is running",
      });
      startTimer();
    };

    if (flipped) {
      setFlipped(false);
      setRunning(false);
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      setTimeout(showNext, reduce ? 0 : 450);
    } else {
      showNext();
    }
  }, [problems, remaining, seen, flipped, settings.mode, settings.sound]);

  const togglePause = useCallback(() => {
    if (!current || done || showAnswer) return;
    if (running) {
      setElapsedBefore(elapsed);
      setRunning(false);
      setStatus({ title: "Paused", sub: "Press resume to continue" });
    } else {
      const t = performance.now();
      setStartedAt(t);
      setNow(t);
      setRunning(true);
      setStatus({ title: "Go!", sub: "Guess the word before time runs out" });
    }
  }, [current, done, showAnswer, running, elapsed]);

  const reveal = useCallback(() => {
    if (!current) return;
    setShowAnswer(true);
    setElapsedBefore(elapsed);
    setRunning(false);
    setStatus({ title: "Answer", sub: `Took ${elapsed.toFixed(1)} s · tap again for the next card` });
  }, [current, elapsed]);

  const reset = () => {
    setSeen(new Set());
    setRunning(false);
    setElapsedBefore(0);
    setDone(false);
    setCurrent(null);
    setFlipped(false);
    setShowAnswer(false);
    setHistory([]);
    setStatus({ title: "Shuffled", sub: `All ${problems.length} cards are back in the deck` });
  };

  // One button does both: first press shows the answer, the next press draws a new card.
  const needsAnswer = flipped && !!current && !showAnswer;
  const advance = useCallback(() => {
    if (needsAnswer) reveal();
    else draw();
  }, [needsAnswer, reveal, draw]);

  const toggleFullscreen = useCallback(async () => {
    if (!presenting) {
      setPresenting(true);
      try {
        await document.documentElement.requestFullscreen?.();
        usedFsApi.current = !!document.fullscreenElement;
      } catch {
        usedFsApi.current = false;
      }
    } else {
      setPresenting(false);
      if (document.fullscreenElement) await document.exitFullscreen().catch(() => {});
    }
  }, [presenting]);

  // Leaving browser full screen with Esc should also leave our layout.
  useEffect(() => {
    const onChange = () => {
      if (!document.fullscreenElement && usedFsApi.current) {
        usedFsApi.current = false;
        setPresenting(false);
      }
    };
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  // keyboard shortcuts
  useEffect(() => {
    if (!active || !begun || qrOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest("input, select, textarea")) return;
      if (e.code === "Space") { e.preventDefault(); advance(); }
      else if (e.key.toLowerCase() === "p") togglePause();
      else if (e.key.toLowerCase() === "f") toggleFullscreen();
      else if (e.key === "Escape" && presenting && !document.fullscreenElement) setPresenting(false);
      else if (e.key.toLowerCase() === "a") reveal();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [active, begun, qrOpen, advance, togglePause, reveal, toggleFullscreen, presenting]);

  // ---- session: begin, sync to monitors, end ----
  const begin = async () => {
    setBeginError("");
    setBeginning(true);
    try {
      const res = await fetch("/api/session", { method: "POST" });
      if (!res.ok) throw new Error();
      const { id, lanOrigins } = (await res.json()) as { id: string; lanOrigins: string[] };
      // "localhost" only works on this computer, so point phones at the computer's Wi-Fi address instead.
      const local = ["localhost", "127.0.0.1", "[::1]"].includes(window.location.hostname);
      const origin = local && lanOrigins.length ? lanOrigins[0] : window.location.origin;
      setSession({ id, url: `${origin}/monitor/${id}` });
      setViewers(0);
      setQrOpen(true);
    } catch {
      setBeginError("Couldn't start a session. Check that the app server is running, then try again.");
    }
    setBeginning(false);
  };

  const startGame = useCallback(() => {
    setQrOpen(false);
    setBegun(true);
  }, []);

  const position = current ? problems.findIndex((p) => p.no === current.no) + 1 || current.no : 1;

  const pushState = useCallback(
    async (extra?: Partial<SessionState>) => {
      if (!session) return;
      const state: SessionState = {
        problem: current,
        position,
        revealed: showAnswer,
        running,
        done,
        elapsed: elapsedBefore + (running ? (performance.now() - startedAt) / 1000 : 0),
        duration,
        mode: settings.mode,
        drawn: problems.length - remaining.length,
        total: problems.length,
        status,
        history,
        ended: false,
        ...extra,
      };
      try {
        const res = await fetch(`/api/session/${session.id}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(state),
        });
        if (res.ok) setViewers((await res.json()).viewers ?? 0);
      } catch {}
    },
    [session, current, position, showAnswer, running, done, elapsedBefore, startedAt, duration, settings.mode, problems.length, remaining.length, status, history],
  );

  // Send on every real change (draw, reveal, pause, time up…), never on the 100 ms clock tick.
  useEffect(() => {
    pushState();
  }, [pushState]);

  // While the QR is up, keep the "monitors connected" count fresh.
  useEffect(() => {
    if (!session || !qrOpen) return;
    const poll = async () => {
      try {
        const res = await fetch(`/api/session/${session.id}`);
        if (res.ok) setViewers((await res.json()).viewers ?? 0);
      } catch {}
    };
    poll();
    const t = setInterval(poll, 2000);
    return () => clearInterval(t);
  }, [session, qrOpen]);

  const endSession = async () => {
    await pushState({ ended: true });
    reset();
    setSession(null);
    setBegun(false);
    if (presenting) toggleFullscreen();
    setStatus({ title: "Ready", sub: "Draw a card to start the clock" });
  };

  // ring display
  let shown: number, frac: number, warn: boolean;
  if (settings.mode === "down") {
    const left = Math.max(0, duration - elapsed);
    shown = Math.ceil(left);
    frac = left / duration;
    warn = left <= 5 && left > 0 && !done;
  } else {
    shown = Math.floor(elapsed);
    frac = Math.min(1, elapsed / duration);
    warn = elapsed >= duration;
  }

  const pauseDisabled = !current || done || showAnswer;

  const btn =
    "rounded-full border-2 border-line px-[22px] py-3 font-semibold text-on-felt transition hover:bg-white/10 active:translate-y-px disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent";
  const corner = "absolute text-center font-mono text-[clamp(1rem,3.2cqw,2rem)] leading-tight text-red";

  // Size each line of text to the card. Thai letters are ~0.6em wide; the clue may wrap to two lines.
  const fit = (text: string, max: number, min: number, lines: number, em: number) =>
    `${Math.max(min, Math.min(max, (84 * lines) / (Math.max(visualLength(text), 1) * em))).toFixed(2)}cqw`;
  // each slot of the pattern is a letter or blank (~0.65em) plus a 0.2em gap
  const hintSize = current ? `${Math.max(6, Math.min(15, 84 / (Math.max(hintSlots(current.hint).length, 1) * 0.85))).toFixed(2)}cqw` : "";
  const clueSize = current ? fit(current.clue, 5.6, 3.2, 2, 0.55) : "";
  const answerSize = current ? fit(current.answer || "ไม่มีคำตอบ", 10, 5, 1, 0.62) : "";

  const cardSize = presenting
    ? "max-w-[min(97vw,calc((100dvh-150px)*5/3.4))]"
    : "max-w-[min(1000px,calc((100dvh-320px)*5/3.4))]";

  return (
    <section
      className={
        presenting
          ? "fixed inset-0 z-40 flex flex-col items-center justify-center gap-[2.5dvh] bg-[radial-gradient(ellipse_at_50%_30%,var(--felt)_0%,var(--felt-deep)_100%)] px-[max(12px,1.5vw)] py-[2dvh]"
          : "flex w-full flex-col items-center gap-[22px]"
      }
    >
      <span hidden={presenting} className="font-mono text-sm tabular-nums text-on-felt-soft">
        {problems.length ? `${remaining.length} of ${problems.length} cards left` : "No problems yet"}
      </span>

      {!begun ? (
        <div className="flex aspect-[4/3] w-full max-w-[min(1000px,calc((100dvh-320px)*5/3.4))] min-w-[min(100%,320px)] flex-col items-center justify-center gap-5 rounded-[clamp(14px,2.4cqw,28px)] border-2 border-dashed border-line px-6 text-center sm:aspect-[5/3.4]">
          <p className="text-xs font-semibold tracking-[.08em] text-on-felt-soft uppercase">
            {problems.length} cards · {duration} s per card
          </p>
          <h2 className="max-w-[18ch] text-[clamp(1.8rem,5vw,3.2rem)] leading-[1.05] font-extrabold tracking-tight text-balance">
            Ready when your team is
          </h2>
          <p className="max-w-[44ch] text-on-felt-soft">
            Begin a session to get a QR code. Scan it on the host&apos;s phone to follow each puzzle and its answer live.
          </p>
          <button
            onClick={begin}
            disabled={beginning || !problems.length}
            className="rounded-full border-2 border-gold bg-gold px-9 py-4 text-xl font-semibold text-[#2a2205] shadow-[0_10px_24px_rgba(0,0,0,.25)] transition hover:bg-gold-hi active:translate-y-px disabled:opacity-50"
          >
            {beginning ? "Starting…" : "Begin session"}
          </button>
          {beginError && <p className="max-w-[40ch] text-sm text-[#ffb4ab]">{beginError}</p>}
        </div>
      ) : (
        <>
      {/* card */}
      <div
        role="button"
        tabIndex={0}
        aria-label={needsAnswer ? "Show the answer" : "Draw the next card"}
        onClick={advance}
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); advance(); } }}
        className={`@container aspect-[4/3] w-full ${cardSize} min-w-[min(100%,320px)] cursor-pointer perspective-[1400px] sm:aspect-[5/3.4]`}
      >
        <div
          className={`relative h-full w-full transition-transform duration-700 ease-[cubic-bezier(.3,1.3,.5,1)] transform-3d ${
            flipped ? "rotate-y-180" : ""
          }`}
        >
          {/* back */}
          <div className="absolute inset-0 flex rounded-[clamp(14px,2.4cqw,28px)] bg-card p-[clamp(10px,1.8cqw,20px)] shadow-[0_18px_40px_rgba(0,0,0,.35),0_2px_0_rgba(0,0,0,.15)] backface-hidden">
            <div className="flex h-full w-full flex-col items-center justify-center gap-[2cqw] rounded-[clamp(8px,1.4cqw,16px)] bg-[repeating-linear-gradient(45deg,var(--red)_0_10px,var(--red-deep)_10px_20px)] text-card">
              <div className="grid size-[1.5em] place-items-center rounded-full bg-card text-[18cqw] leading-none font-extrabold text-red">
                ?
              </div>
              <div className="rounded-md bg-red-deep px-[1.6cqw] py-[.6cqw] text-[clamp(.8rem,2.4cqw,1.4rem)] font-medium tracking-[.08em] uppercase">
                Tap to draw
              </div>
            </div>
          </div>

          {/* front */}
          <div className="absolute inset-0 flex rotate-y-180 flex-col items-center justify-center rounded-[clamp(14px,2.4cqw,28px)] bg-card px-[8cqw] py-[6cqw] text-ink shadow-[0_18px_40px_rgba(0,0,0,.35),0_2px_0_rgba(0,0,0,.15)] backface-hidden">
            {[`${corner} top-[3cqw] left-[3.2cqw]`, `${corner} right-[3.2cqw] bottom-[3cqw] rotate-180`].map((cls) => (
              <div key={cls} className={cls}>
                #{position}
                <small className="block text-[.55em] text-muted">puzzle</small>
              </div>
            ))}
            <div className="flex w-full flex-col items-center gap-[2.4cqw] text-center">
              {current && (
                <HintText hint={current.hint} style={{ fontSize: hintSize }} className="font-puzzle leading-[1.35] font-extrabold" />
              )}
              {current?.clue && (
                <p
                  style={{ fontSize: clueSize }}
                  className="max-w-full font-puzzle leading-[1.35] font-medium text-balance text-ink/80 [overflow-wrap:anywhere]"
                >
                  {current.clue}
                </p>
              )}
              {/* the answer's space is kept while hidden so the hint and clue don't move when it appears */}
              <div
                aria-live="polite"
                style={{ fontSize: answerSize }}
                className={`font-puzzle leading-[1.3] font-extrabold text-red transition duration-300 ${
                  showAnswer ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0"
                }`}
              >
                {showAnswer && current ? current.answer || <span className="text-muted">ไม่มีคำตอบ</span> : "\u00a0"}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* in full screen, timer and buttons share one row under the card */}
      <div className={presenting ? "flex flex-wrap items-center justify-center gap-x-10 gap-y-3" : "contents"}>
      {/* timer */}
      <div className="flex items-center gap-[18px]">
        <div className={`relative ${presenting ? "size-20 md:size-24" : "size-28 md:size-36"}`}>
          <svg viewBox="0 0 120 120" aria-hidden="true" className="size-full -rotate-90">
            <circle cx="60" cy="60" r={RADIUS} fill="none" strokeWidth="9" className="stroke-line" />
            <circle
              cx="60"
              cy="60"
              r={RADIUS}
              fill="none"
              strokeWidth="9"
              strokeLinecap="round"
              strokeDasharray={CIRC}
              strokeDashoffset={CIRC * (1 - frac)}
              className={`transition-[stroke-dashoffset,stroke] duration-300 ease-linear ${warn ? "stroke-red" : "stroke-gold"}`}
            />
          </svg>
          <div
            key={done ? "done" : "live"}
            className={`absolute inset-0 grid place-items-center font-mono tabular-nums ${
              presenting ? "text-[1.8rem] md:text-[2.2rem]" : "text-[2.2rem] md:text-[2.8rem]"
            } ${
              done ? "animate-pulse-num text-red" : ""
            }`}
          >
            {shown}
          </div>
        </div>
        <div className="max-w-[16ch] text-on-felt-soft">
          <strong className="block text-xl text-on-felt">{status.title}</strong>
          {status.sub}
        </div>
      </div>

      {/* controls */}
      <div className="flex flex-wrap justify-center gap-2.5">
        <button
          className={`${btn} border-gold bg-gold text-[#2a2205] hover:bg-gold-hi`}
          onClick={advance}
          disabled={!problems.length}
        >
          {needsAnswer ? "Show answer" : current ? "Next card" : "Draw card"}
        </button>
        <button className={btn} onClick={togglePause} disabled={pauseDisabled}>
          {running || pauseDisabled ? "Pause" : "Resume"}
        </button>
        <button className={btn} onClick={toggleFullscreen}>
          {presenting ? "Exit full screen" : "Full screen"}
        </button>
        {!presenting && (
          <>
            <button className={btn} onClick={reset}>
              Shuffle deck
            </button>
            <button className={btn} onClick={() => setQrOpen(true)}>
              Show QR{viewers ? ` · ${viewers}` : ""}
            </button>
            <button className={`${btn} hover:border-red hover:bg-red/20`} onClick={endSession}>
              End session
            </button>
          </>
        )}
      </div>
      </div>

        </>
      )}

      {/* settings */}
      <div hidden={presenting} className="flex w-full flex-wrap items-center justify-center gap-x-[22px] gap-y-3.5 border-t border-line pt-[18px] text-[.95rem] text-on-felt-soft">
        <label htmlFor="seconds" className="flex items-center gap-2">
          Time (sec)
          <input
            id="seconds"
            type="number"
            min={1}
            max={600}
            value={settings.seconds}
            onChange={(e) => updateSettings({ seconds: Number(e.target.value) })}
            onBlur={() => updateSettings({ seconds: clampSeconds(settings.seconds) })}
            className="w-[5.5em] rounded-lg border border-line bg-black/20 px-2 py-1.5 font-mono text-on-felt"
          />
        </label>
        <label htmlFor="mode" className="flex items-center gap-2">
          Mode
          <select
            id="mode"
            value={settings.mode}
            onChange={(e) => updateSettings({ mode: e.target.value as Mode })}
            className="rounded-lg border border-line bg-black/20 px-2 py-1.5 font-mono text-on-felt"
          >
            <option value="down">Count down</option>
            <option value="up">Count up</option>
          </select>
        </label>
        <label htmlFor="sound" className="flex items-center gap-2">
          <input id="sound" type="checkbox" checked={settings.sound} onChange={(e) => updateSettings({ sound: e.target.checked })} />
          Beep at time up
        </label>
      </div>
      <p hidden={presenting} className="text-center text-xs text-on-felt-soft">
        <Kbd>Space</Kbd> answer, then next card · <Kbd>P</Kbd> pause · <Kbd>F</Kbd> full screen
      </p>
      {qrOpen && session && (
        <QrModal
          url={session.url}
          sessionId={session.id}
          viewers={viewers}
          starting={!begun}
          onStart={startGame}
          onClose={startGame}
        />
      )}
    </section>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className="rounded border border-line px-1.5 font-mono">{children}</kbd>;
}
