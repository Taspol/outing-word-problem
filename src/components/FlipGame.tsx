"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { hintSlots } from "@/lib/text";
import HintText from "./HintText";
import type { Problem } from "@/lib/types";
import type { CardResult, RoundCard, SessionState } from "@/lib/sessionTypes";
import QrModal from "./QrModal";

// A round: "get 5 right in 30 seconds". One clock runs for the whole round; the host marks each card Correct or
// Pass and the next card appears at once. The round ends when the team reaches the target or time runs out.
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
  const correct = cards.filter((c) => c.result === "correct").length;
  const passed = cards.filter((c) => c.result === "pass").length;
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
    (p: Problem, result: CardResult): RoundCard => ({ position: positionOf(p), hint: p.hint, answer: p.answer, result }),
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
    (why: "goal" | "time", finalCards: RoundCard[], at: number) => {
      const got = finalCards.filter((c) => c.result === "correct").length;
      setRunning(false);
      setElapsedBefore(at);
      setCards(finalCards);
      setCurrent(null);
      setOutcome(why);
      setPhase("over");
      if (why === "goal") {
        setStatus({ title: "Goal reached!", sub: `${got} correct in ${at.toFixed(1)} s` });
        if (settings.sound) goalSound();
      } else {
        setStatus({ title: "Time's up!", sub: `${got} of ${target} correct` });
        if (settings.sound) timeUpSound();
      }
    },
    [settings.sound, target, goalSound, timeUpSound],
  );

  // time up
  useEffect(() => {
    if (running && playing && elapsed >= duration) {
      finish("time", current ? [...cards, toCard(current, "missed")] : cards, duration);
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
    setCards([]);
    setOutcome(null);
    setRound((r) => r + 1);
    setPhase("playing");
    setElapsedBefore(0);
    setStartedAt(t);
    setNow(t);
    setRunning(true);
    setStatus({ title: "Go!", sub: `Get ${target} right before time runs out` });
  }, [problems.length, playing, settings.sound, pickNext, seen, target]);

  /** The host marks the card on screen; the next one appears straight away. */
  const mark = useCallback(
    (result: "correct" | "pass") => {
      if (!playing || !running || !current) return;
      const nextCards = [...cards, toCard(current, result)];
      if (result === "correct" && nextCards.filter((c) => c.result === "correct").length >= target) {
        finish("goal", nextCards, elapsed);
        return;
      }
      const { pick, seen: nextSeen } = pickNext(seen, nextCards.map((c) => c.position));
      setCards(nextCards);
      setSeen(nextSeen);
      setCurrent(pick);
    },
    [playing, running, current, cards, toCard, target, finish, elapsed, pickNext, seen],
  );

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
      setStatus({ title: "Go!", sub: `Get ${target} right before time runs out` });
    }
  }, [playing, running, elapsed, target]);

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
        else mark("correct");
      } else if (k === "x") mark("pass");
      else if (k === "p") togglePause();
      else if (k === "f") toggleFullscreen();
      else if (e.key === "Escape" && presenting && !document.fullscreenElement) setPresenting(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [active, begun, qrOpen, playing, running, startRound, mark, togglePause, toggleFullscreen, presenting]);

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
        correct,
        cards,
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
    [session, phase, round, current, position, running, elapsedBefore, startedAt, duration, target, correct, cards, outcome, left, problems.length, status],
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
  const gold = `${btn} border-gold bg-gold text-[#2a2205] hover:bg-gold-hi`;
  const corner = "absolute text-center font-mono text-[clamp(1rem,3.2cqw,2rem)] leading-tight text-red";

  // each slot of the pattern is a letter or blank (~0.65em) plus a 0.2em gap
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
            {problems.length} cards · get {target} right in {duration} s
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
        role={playing ? undefined : "button"}
        tabIndex={playing ? undefined : 0}
        aria-label={playing ? undefined : "Start the round"}
        onClick={playing ? undefined : startRound}
        className={`@container aspect-[4/3] w-full ${cardSize} min-w-[min(100%,320px)] perspective-[1400px] sm:aspect-[5/3.4] ${playing ? "" : "cursor-pointer"}`}
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
                {/* keyed by the card count so each new card slides in */}
                <div key={cards.length} className="animate-card-in">
                  <HintText hint={current.hint} style={{ fontSize: hintSize }} className="font-puzzle leading-[1.35] font-extrabold" />
                </div>
              </>
            )}
            {phase === "over" && <RoundSummary cards={cards} target={target} outcome={outcome} />}
          </div>
        </div>
      </div>

      {/* in full screen, timer, score and buttons share one row under the card */}
      <div className={presenting ? "flex flex-wrap items-center justify-center gap-x-10 gap-y-3" : "contents"}>
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

        {/* score: one pip per correct answer needed */}
        {phase !== "ready" && (
          <div className="flex flex-col items-center gap-1.5" aria-label={`${correct} of ${target} correct, ${passed} passed`}>
            <div className="flex flex-wrap justify-center gap-1.5" aria-hidden="true">
              {Array.from({ length: target }, (_, i) => (
                <span
                  key={i}
                  className={`size-[clamp(14px,2.2vw,22px)] rounded-full border-2 transition ${
                    i < correct ? "border-gold bg-gold" : "border-line"
                  }`}
                />
              ))}
            </div>
            <p className="font-mono text-sm tabular-nums text-on-felt-soft">
              <span className="text-on-felt">{correct}</span>/{target} correct · {passed} passed
            </p>
          </div>
        )}
      </div>

      {/* controls */}
      <div className="flex flex-wrap justify-center gap-2.5">
        {playing ? (
          <>
            <button className={`${gold} px-8`} onClick={() => mark("correct")} disabled={!running}>
              ✓ Correct
            </button>
            <button className={btn} onClick={() => mark("pass")} disabled={!running}>
              Pass
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
        <button className={btn} onClick={toggleFullscreen}>
          {presenting ? "Exit full screen" : "Full screen"}
        </button>
        {!presenting && (
          <>
            <button className={btn} onClick={reset} disabled={playing}>
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
          Correct to win
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
        <Kbd>Space</Kbd> start round / correct · <Kbd>X</Kbd> pass · <Kbd>P</Kbd> pause · <Kbd>F</Kbd> full screen
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

const RESULT_MARK: Record<CardResult, { sign: string; label: string; cls: string }> = {
  correct: { sign: "✓", label: "correct", cls: "text-[#2f8a5c]" },
  pass: { sign: "–", label: "passed", cls: "text-muted" },
  missed: { sign: "⏱", label: "time ran out", cls: "text-red" },
};

/** The card face after a round: the score, then every card of the round with its answer. */
function RoundSummary({ cards, target, outcome }: { cards: RoundCard[]; target: number; outcome: SessionState["outcome"] }) {
  const got = cards.filter((c) => c.result === "correct").length;
  const shown = cards.slice(0, 10);
  return (
    <div className="flex h-full w-full flex-col items-center gap-[2cqw] overflow-hidden text-center">
      <p className={`font-puzzle text-[4.2cqw] leading-tight font-extrabold ${outcome === "goal" ? "text-[#2f8a5c]" : "text-red"}`}>
        {outcome === "goal" ? "ผ่าน! 🎉" : "หมดเวลา!"}
      </p>
      <p className="font-mono text-[12cqw] leading-none tabular-nums">
        {got}
        <span className="text-[.5em] text-muted">/{target}</span>
      </p>
      {shown.length > 0 && (
        <ol className="grid w-full grid-cols-2 gap-x-[3cqw] gap-y-[.8cqw] border-t border-ink/10 pt-[2cqw] text-left text-[2.6cqw]">
          {shown.map((c, i) => {
            const m = RESULT_MARK[c.result];
            return (
              <li key={i} className="flex min-w-0 items-baseline gap-[1.2cqw]">
                <span className={`w-[1.2em] shrink-0 text-center font-bold ${m.cls}`} aria-label={m.label}>
                  {m.sign}
                </span>
                <HintText hint={c.hint} className="shrink-0 font-puzzle font-extrabold" />
                <span className="min-w-0 truncate font-puzzle font-semibold text-red">{c.answer || "—"}</span>
              </li>
            );
          })}
          {cards.length > shown.length && <li className="text-muted">…and {cards.length - shown.length} more</li>}
        </ol>
      )}
    </div>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className="rounded border border-line px-1.5 font-mono">{children}</kbd>;
}
