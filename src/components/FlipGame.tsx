"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { hintSlots, visualLength } from "@/lib/text";
import HintText from "./HintText";
import type { Problem } from "@/lib/types";
import type { RoundCard, SessionState } from "@/lib/sessionTypes";
import QrModal from "./QrModal";

// A round: "ตอบให้ได้ 5 ข้อ ใน 30 วิ". One clock runs for the whole round. No score is kept: the operator clicks the
// card once to show its answer and again for the next card, and clicks Complete when the team is done. The round
// also ends when time runs out; either way the last card stays up with its answer.
type Settings = { seconds: number; target: number; sound: boolean };
type Phase = SessionState["phase"];

const RADIUS = 52;
const CIRC = 2 * Math.PI * RADIUS;
const SETTINGS_KEY = "owf-round-settings";
const DEFAULT_SETTINGS: Settings = { seconds: 30, target: 5, sound: true };

function clampSeconds(n: number) {
  return Math.max(5, Math.min(600, Math.round(n) || 30));
}
function clampTarget(n: number) {
  return Math.max(1, Math.min(50, Math.round(n) || 5));
}

export default function FlipGame({ problems, active }: { problems: Problem[]; active: boolean }) {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [seen, setSeen] = useState<Set<number>>(new Set());
  const [phase, setPhase] = useState<Phase>("ready");
  const [round, setRound] = useState(0);
  const [current, setCurrent] = useState<Problem | null>(null);
  const [cards, setCards] = useState<RoundCard[]>([]);
  const [outcome, setOutcome] = useState<SessionState["outcome"]>(null);
  const [revealed, setRevealed] = useState(false);
  const [status, setStatus] = useState({ title: "Ready", sub: "Press Start round when the team is set" });

  // round clock
  const [running, setRunning] = useState(false);
  const [elapsedBefore, setElapsedBefore] = useState(0);
  const [startedAt, setStartedAt] = useState(0);
  const [now, setNow] = useState(0);
  const audioRef = useRef<AudioContext | null>(null);

  // session + monitor
  const [session, setSession] = useState<{ id: string; url: string } | null>(null);
  const [begun, setBegun] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);
  const [viewers, setViewers] = useState(0);
  const [beginError, setBeginError] = useState("");
  const [beginning, setBeginning] = useState(false);

  // full screen ("presenting"): the card fills the screen. Uses the browser's Fullscreen API where it
  // exists; on phones without it (iPhone Safari) it still fills the page.
  const [presenting, setPresenting] = useState(false);
  const usedFsApi = useRef(false);

  const duration = clampSeconds(settings.seconds);
  const target = clampTarget(settings.target);
  const elapsed = elapsedBefore + (running ? (now - startedAt) / 1000 : 0);
  const playing = phase === "playing";

  // load / save settings
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}");
      setSettings({
        ...DEFAULT_SETTINGS,
        ...saved,
        seconds: clampSeconds(Number(saved.seconds ?? 30)),
        target: clampTarget(Number(saved.target ?? 5)),
      });
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

  const tones = useCallback((notes: [number, number, number][]) => {
    try {
      const ctx = (audioRef.current ??= new AudioContext());
      for (const [t, freq, len] of notes) {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.frequency.value = freq;
        o.type = "square";
        g.gain.setValueAtTime(0.12, ctx.currentTime + t);
        g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + t + len);
        o.connect(g).connect(ctx.destination);
        o.start(ctx.currentTime + t);
        o.stop(ctx.currentTime + t + len + 0.05);
      }
    } catch {}
  }, []);
  const timeUpSound = useCallback(() => tones([[0, 880, 0.18], [0.25, 880, 0.18], [0.5, 660, 0.5]]), [tones]);
  const goalSound = useCallback(() => tones([[0, 523, 0.15], [0.15, 659, 0.15], [0.3, 784, 0.15], [0.45, 1047, 0.45]]), [tones]);

  const positionOf = useCallback((p: Problem) => problems.findIndex((q) => q.no === p.no) + 1 || p.no, [problems]);
  const toCard = useCallback(
    (p: Problem): RoundCard => ({ position: positionOf(p), hint: p.hint, answer: p.answer }),
    [positionOf],
  );

  /** Picks a card nobody has seen yet; when the deck runs out it reshuffles, leaving out this round's cards. */
  const pickNext = useCallback(
    (seenNow: Set<number>, roundPositions: number[]) => {
      let base = seenNow;
      let pool = problems.filter((p) => !seenNow.has(p.no));
      if (!pool.length) {
        base = new Set();
        pool = problems.filter((_, i) => !roundPositions.includes(i + 1));
        if (!pool.length) pool = problems;
      }
      const pick = pool[Math.floor(Math.random() * pool.length)];
      return { pick, seen: new Set(base).add(pick.no) };
    },
    [problems],
  );

  const finish = useCallback(
    (why: "complete" | "time", finalCards: RoundCard[], at: number) => {
      setRunning(false);
      setElapsedBefore(at);
      setCards(finalCards);
      setRevealed(true); // the last card stays on screen, now with its answer
      setOutcome(why);
      setPhase("over");
      if (why === "complete") {
        setStatus({ title: "Complete!", sub: `Finished in ${at.toFixed(1)} s` });
        if (settings.sound) goalSound();
      } else {
        setStatus({ title: "Time's up!", sub: "The round is over" });
        if (settings.sound) timeUpSound();
      }
    },
    [settings.sound, goalSound, timeUpSound],
  );

  // time up
  useEffect(() => {
    if (running && playing && elapsed >= duration) {
      finish("time", current ? [...cards, toCard(current)] : cards, duration);
    }
  }, [running, playing, elapsed, duration, current, cards, toCard, finish]);

  const startRound = useCallback(() => {
    if (!problems.length || playing) return;
    if (settings.sound && !audioRef.current) {
      try { audioRef.current = new AudioContext(); } catch {}
    }
    const { pick, seen: nextSeen } = pickNext(seen, []);
    const t = performance.now();
    setSeen(nextSeen);
    setCurrent(pick);
    setRevealed(false);
    setCards([]);
    setOutcome(null);
    setRound((r) => r + 1);
    setPhase("playing");
    setElapsedBefore(0);
    setStartedAt(t);
    setNow(t);
    setRunning(true);
    setStatus({ title: "Go!", sub: "Click the card to show the answer" });
  }, [problems.length, playing, settings.sound, pickNext, seen]);

  /** One click shows the answer of the card on screen; the next click moves on to a new card. */
  const next = useCallback(() => {
    if (!playing || !running || !current) return;
    if (!revealed) {
      setRevealed(true);
      setStatus({ title: "Answer", sub: "Click the card for the next one" });
      return;
    }
    const nextCards = [...cards, toCard(current)];
    const { pick, seen: nextSeen } = pickNext(seen, nextCards.map((c) => c.position));
    setCards(nextCards);
    setSeen(nextSeen);
    setCurrent(pick);
    setRevealed(false);
    setStatus({ title: "Go!", sub: "Click the card to show the answer" });
  }, [playing, running, current, revealed, cards, toCard, pickNext, seen]);

  /** The operator ends the round when the team is done. */
  const complete = useCallback(() => {
    if (!playing || !current) return;
    finish("complete", [...cards, toCard(current)], elapsed);
  }, [playing, current, cards, toCard, finish, elapsed]);

  const togglePause = useCallback(() => {
    if (!playing) return;
    if (running) {
      setElapsedBefore(elapsed);
      setRunning(false);
      setStatus({ title: "Paused", sub: "Press resume to continue" });
    } else {
      const t = performance.now();
      setStartedAt(t);
      setNow(t);
      setRunning(true);
      setStatus(revealed
        ? { title: "Answer", sub: "Click the card for the next one" }
        : { title: "Go!", sub: "Click the card to show the answer" });
    }
  }, [playing, running, elapsed, revealed]);

  const reset = () => {
    setSeen(new Set());
    setStatus({ title: "Shuffled", sub: `All ${problems.length} cards are back in the deck` });
  };

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
      const k = e.key.toLowerCase();
      if (e.code === "Space" || e.key === "Enter") {
        e.preventDefault(); // also stops Space/Enter "pressing" whichever button has focus, e.g. Pass
        if (!playing) startRound();
        else if (!running) togglePause();
        else next();
      } else if (e.key === "ArrowRight") next();
      else if (k === "c") complete();
      else if (k === "p") togglePause();
      else if (k === "f") toggleFullscreen();
      else if (e.key === "Escape" && presenting && !document.fullscreenElement) setPresenting(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [active, begun, qrOpen, playing, running, startRound, next, complete, togglePause, toggleFullscreen, presenting]);

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

  const position = current ? positionOf(current) : 0;
  const left = problems.filter((p) => !seen.has(p.no)).length;

  const pushState = useCallback(
    async (extra?: Partial<SessionState>) => {
      if (!session) return;
      const state: SessionState = {
        phase,
        round,
        problem: current,
        position,
        running,
        elapsed: elapsedBefore + (running ? (performance.now() - startedAt) / 1000 : 0),
        duration,
        target,
        cards,
        revealed,
        outcome,
        left,
        total: problems.length,
        status,
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
    [session, phase, round, current, position, running, elapsedBefore, startedAt, duration, target, cards, revealed, outcome, left, problems.length, status],
  );

  // Send on every real change (new card, pause, round over…), never on the 100 ms clock tick.
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
    setSeen(new Set());
    setRunning(false);
    setElapsedBefore(0);
    setCurrent(null);
    setRevealed(false);
    setCards([]);
    setOutcome(null);
    setRound(0);
    setPhase("ready");
    setSession(null);
    setBegun(false);
    if (presenting) toggleFullscreen();
    setStatus({ title: "Ready", sub: "Press Start round when the team is set" });
  };

  // round clock display
  const remainingTime = Math.max(0, duration - (phase === "ready" ? 0 : elapsed));
  const shown = Math.ceil(remainingTime);
  const frac = remainingTime / duration;
  const warn = playing && remainingTime <= 5;
  const timeUp = phase === "over" && outcome === "time";

  const btn =
    "rounded-full border-2 border-line px-[22px] py-3 font-semibold text-on-felt transition hover:bg-white/10 active:translate-y-px disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent";
  // swap the base colours rather than adding to them: two text/border colours on one element is a coin toss
  const gold = `${btn.replace("border-line", "border-gold").replace("text-on-felt", "text-[#2a2205]")} bg-gold hover:bg-gold-hi`;
  const corner = "absolute text-center font-mono text-[clamp(1rem,3.2cqw,2rem)] leading-tight text-red";

  // each slot of the pattern is a letter or blank (~0.65em) plus a 0.2em gap
  const answerSize = current
    ? `${Math.max(5, Math.min(12, 84 / (Math.max(visualLength(current.answer || "ไม่มีคำตอบ"), 1) * 0.62))).toFixed(2)}cqw`
    : "";
  const hintSize = current ? `${Math.max(6, Math.min(18, 84 / (Math.max(hintSlots(current.hint).length, 1) * 0.85))).toFixed(2)}cqw` : "";

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
        {problems.length ? `${left} of ${problems.length} cards left in the deck` : "No puzzles yet"}
      </span>

      {!begun ? (
        <div className="flex aspect-[4/3] w-full max-w-[min(1000px,calc((100dvh-320px)*5/3.4))] min-w-[min(100%,320px)] flex-col items-center justify-center gap-5 rounded-[clamp(14px,2.4cqw,28px)] border-2 border-dashed border-line px-6 text-center sm:aspect-[5/3.4]">
          <p className="text-xs font-semibold tracking-[.08em] text-on-felt-soft uppercase">
            {problems.length} cards · {duration} s per round
          </p>
          <h2 className="max-w-[18ch] text-[clamp(1.8rem,5vw,3.2rem)] leading-[1.05] font-extrabold tracking-tight text-balance">
            ตอบให้ได้ {target} ข้อ ใน {duration} วิ
          </h2>
          <p className="max-w-[44ch] text-on-felt-soft">
            Begin a session to get a QR code. Scan it on the host&apos;s phone to see each clue and answer live.
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
      {/* card: the back shows before the first round, the front shows the puzzle and, after a round, the results */}
      <div
        role="button"
        tabIndex={0}
        aria-label={playing ? (revealed ? "Next card" : "Show the answer") : "Start the round"}
        onClick={playing ? next : startRound}
        className={`@container aspect-[4/3] w-full ${cardSize} min-w-[min(100%,320px)] perspective-[1400px] sm:aspect-[5/3.4] ${playing && !running ? "" : "cursor-pointer"}`}
      >
        <div
          className={`relative h-full w-full transition-transform duration-700 ease-[cubic-bezier(.3,1.3,.5,1)] transform-3d ${
            phase !== "ready" ? "rotate-y-180" : ""
          }`}
        >
          {/* back */}
          <div className="absolute inset-0 flex rounded-[clamp(14px,2.4cqw,28px)] bg-card p-[clamp(10px,1.8cqw,20px)] shadow-[0_18px_40px_rgba(0,0,0,.35),0_2px_0_rgba(0,0,0,.15)] backface-hidden">
            <div className="flex h-full w-full flex-col items-center justify-center gap-[2cqw] rounded-[clamp(8px,1.4cqw,16px)] bg-[repeating-linear-gradient(45deg,var(--red)_0_10px,var(--red-deep)_10px_20px)] text-card">
              <div className="grid size-[1.5em] place-items-center rounded-full bg-card text-[18cqw] leading-none font-extrabold text-red">
                ?
              </div>
              <div className="rounded-md bg-red-deep px-[1.6cqw] py-[.6cqw] font-puzzle text-[clamp(.9rem,2.8cqw,1.6rem)] font-semibold">
                ตอบให้ได้ {target} ข้อ ใน {duration} วิ
              </div>
            </div>
          </div>

          {/* front */}
          <div className="absolute inset-0 flex rotate-y-180 flex-col items-center justify-center rounded-[clamp(14px,2.4cqw,28px)] bg-card px-[8cqw] py-[6cqw] text-ink shadow-[0_18px_40px_rgba(0,0,0,.35),0_2px_0_rgba(0,0,0,.15)] backface-hidden">
            {current && (
              <>
                {[`${corner} top-[3cqw] left-[3.2cqw]`, `${corner} right-[3.2cqw] bottom-[3cqw] rotate-180`].map((cls) => (
                  <div key={cls} className={cls}>
                    #{position}
                    <small className="block text-[.55em] text-muted">puzzle</small>
                  </div>
                ))}
                {/* keyed by round and card so each new card slides in (cards don't repeat within a round) */}
                <div key={`${round}-${position}`} className="flex animate-card-in flex-col items-center gap-[2.4cqw] text-center">
                  <HintText hint={current.hint} style={{ fontSize: hintSize }} className="font-puzzle leading-[1.35] font-extrabold" />
                  {/* the answer's space is kept while hidden so the pattern doesn't move when it appears */}
                  <div
                    aria-live="polite"
                    style={{ fontSize: answerSize }}
                    className={`font-puzzle leading-[1.3] font-extrabold text-red transition duration-300 ${
                      revealed ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0"
                    }`}
                  >
                    {revealed ? current.answer || <span className="text-muted">ไม่มีคำตอบ</span> : "\u00a0"}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* the clock and the round buttons share one row right under the card, so Next and Complete are always on screen */}
      <div className="flex flex-wrap items-center justify-center gap-x-10 gap-y-3">
      <div className="flex flex-wrap items-center justify-center gap-x-8 gap-y-3">
        {/* round clock */}
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
                className={`transition-[stroke-dashoffset,stroke] duration-300 ease-linear ${warn || timeUp ? "stroke-red" : "stroke-gold"}`}
              />
            </svg>
            <div
              key={timeUp ? "done" : "live"}
              className={`absolute inset-0 grid place-items-center font-mono tabular-nums ${
                presenting ? "text-[1.8rem] md:text-[2.2rem]" : "text-[2.2rem] md:text-[2.8rem]"
              } ${timeUp ? "animate-pulse-num text-red" : ""}`}
            >
              {shown}
            </div>
          </div>
          <div className="max-w-[16ch] text-on-felt-soft">
            <strong className="block text-xl text-on-felt">{status.title}</strong>
            {status.sub}
          </div>
        </div>

      </div>

      {/* round controls */}
      <div className="flex flex-wrap justify-center gap-2.5">
        {playing ? (
          <>
            <button className={btn} onClick={next} disabled={!running}>
              {revealed ? "Next →" : "Show answer"}
            </button>
            <button className={`${gold} px-8`} onClick={complete}>
              ✓ Complete
            </button>
            <button className={btn} onClick={togglePause}>
              {running ? "Pause" : "Resume"}
            </button>
          </>
        ) : (
          <button className={gold} onClick={startRound} disabled={!problems.length}>
            {round ? "Next round" : "Start round"}
          </button>
        )}
        {presenting && (
          <button className={btn} onClick={toggleFullscreen}>
            Exit full screen
          </button>
        )}
      </div>
      </div>

      {/* session controls */}
      {!presenting && (
        <div className="flex flex-wrap justify-center gap-2.5">
          <button className={btn} onClick={toggleFullscreen}>
            Full screen
          </button>
          <button className={btn} onClick={reset} disabled={playing}>
            Shuffle deck
          </button>
          <button className={btn} onClick={() => setQrOpen(true)}>
            Show QR{viewers ? ` · ${viewers}` : ""}
          </button>
          <button className={`${btn} hover:border-red hover:bg-red/20`} onClick={endSession}>
            End session
          </button>
        </div>
      )}

        </>
      )}

      {/* settings */}
      <div hidden={presenting} className="flex w-full flex-wrap items-center justify-center gap-x-[22px] gap-y-3.5 border-t border-line pt-[18px] text-[.95rem] text-on-felt-soft">
        <label htmlFor="seconds" className="flex items-center gap-2">
          Round time (sec)
          <input
            id="seconds"
            type="number"
            min={5}
            max={600}
            value={settings.seconds}
            disabled={playing}
            onChange={(e) => updateSettings({ seconds: Number(e.target.value) })}
            onBlur={() => updateSettings({ seconds: clampSeconds(settings.seconds) })}
            className="w-[5.5em] rounded-lg border border-line bg-black/20 px-2 py-1.5 font-mono text-on-felt disabled:opacity-50"
          />
        </label>
        <label htmlFor="target" className="flex items-center gap-2">
          ข้อ (in the title)
          <input
            id="target"
            type="number"
            min={1}
            max={50}
            value={settings.target}
            disabled={playing}
            onChange={(e) => updateSettings({ target: Number(e.target.value) })}
            onBlur={() => updateSettings({ target: clampTarget(settings.target) })}
            className="w-[4.5em] rounded-lg border border-line bg-black/20 px-2 py-1.5 font-mono text-on-felt disabled:opacity-50"
          />
        </label>
        <label htmlFor="sound" className="flex items-center gap-2">
          <input id="sound" type="checkbox" checked={settings.sound} onChange={(e) => updateSettings({ sound: e.target.checked })} />
          Sound at round end
        </label>
      </div>
      <p hidden={presenting} className="text-center text-xs text-on-felt-soft">
        <Kbd>Space</Kbd> start round / show answer, then next card · <Kbd>C</Kbd> complete · <Kbd>P</Kbd> pause · <Kbd>F</Kbd> full screen
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
