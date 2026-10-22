"use client";

import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";

export default function QrModal({
  url,
  sessionId,
  viewers,
  onStart,
  onClose,
  starting,
}: {
  url: string;
  sessionId: string;
  viewers: number;
  onStart: () => void;
  onClose: () => void;
  starting: boolean; // true before the first card: the main button says "Start game"
}) {
  const [svg, setSvg] = useState("");
  const [copied, setCopied] = useState(false);
  const startRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    QRCode.toString(url, { type: "svg", margin: 1, errorCorrectionLevel: "M", color: { dark: "#1d2422", light: "#ffffff" } })
      .then(setSvg)
      .catch(() => setSvg(""));
  }, [url]);

  useEffect(() => {
    startRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {}
  };

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-black/55 p-4 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="qr-title"
        className="relative w-full max-w-[440px] rounded-[22px] bg-card p-6 text-ink shadow-[0_24px_60px_rgba(0,0,0,.45)] sm:p-8"
      >
        <button
          onClick={onClose}
          aria-label="Close"
          className="absolute top-3 right-3 grid size-9 place-items-center rounded-full text-xl text-muted hover:bg-ink/5"
        >
          ×
        </button>
        <p className="text-xs font-semibold tracking-[.08em] text-red uppercase">Host monitor</p>
        <h2 id="qr-title" className="mt-1 text-2xl font-extrabold tracking-tight text-balance">
          Scan to follow the puzzles and answers
        </h2>
        <p className="mt-1 text-sm text-muted">
          The phone shows each puzzle and its answer live. Keep it away from the players.
        </p>

        <div className="mx-auto mt-5 aspect-square w-full max-w-[280px] rounded-2xl border border-ink/10 bg-white p-3">
          {svg ? (
            <div className="size-full [&>svg]:size-full" dangerouslySetInnerHTML={{ __html: svg }} />
          ) : (
            <div className="grid size-full place-items-center text-sm text-muted">Making QR code…</div>
          )}
        </div>

        <div className="mt-4 flex items-center gap-2 rounded-xl bg-ink/5 p-2 pl-3">
          <code className="min-w-0 flex-1 truncate font-mono text-sm select-all">{url}</code>
          <button onClick={copy} className="shrink-0 rounded-full border border-ink/20 px-3 py-1 text-sm font-semibold hover:bg-white">
            {copied ? "Copied" : "Copy"}
          </button>
        </div>

        <div className="mt-3 flex items-center justify-between text-sm">
          <span className="font-mono text-muted">Code {sessionId}</span>
          <span className="flex items-center gap-2" aria-live="polite">
            <span className={`size-2.5 rounded-full ${viewers ? "bg-[#2f9e6a]" : "bg-ink/25"}`} />
            {viewers ? `${viewers} monitor${viewers > 1 ? "s" : ""} connected` : "Waiting for a monitor…"}
          </span>
        </div>

        <button
          ref={startRef}
          onClick={onStart}
          className="mt-6 w-full rounded-full border-2 border-gold bg-gold px-6 py-3.5 text-lg font-semibold text-[#2a2205] transition hover:bg-gold-hi active:translate-y-px"
        >
          {starting ? "Start game" : "Back to game"}
        </button>
        {starting && !viewers && (
          <p className="mt-2 text-center text-xs text-muted">You can start now and scan later with “Show QR”.</p>
        )}
      </div>
    </div>
  );
}
