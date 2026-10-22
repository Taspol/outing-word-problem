"use client";

import { useState } from "react";
import type { Problem } from "@/lib/types";
import FlipGame from "./FlipGame";
import ProblemTable from "./ProblemTable";

type Tab = "play" | "edit";

export default function App({ initialProblems }: { initialProblems: Problem[] }) {
  const [problems, setProblems] = useState(initialProblems);
  const [tab, setTab] = useState<Tab>("play");

  const tabClass = (t: Tab) =>
    `rounded-full px-[18px] py-2 font-semibold transition-colors ${
      tab === t ? "bg-card text-ink" : "text-on-felt hover:bg-white/10"
    }`;

  return (
    <div className="mx-auto flex min-h-full max-w-6xl flex-col items-center gap-[22px] px-4 pt-6 pb-8">
      <header className="flex w-full flex-wrap items-center justify-between gap-3">
        <h1 className="text-[1.6rem] font-extrabold tracking-tight">Outing Word Flip</h1>
        <div role="tablist" className="flex gap-1 rounded-full bg-row p-1">
          <button role="tab" aria-selected={tab === "play"} className={tabClass("play")} onClick={() => setTab("play")}>
            Play
          </button>
          <button role="tab" aria-selected={tab === "edit"} className={tabClass("edit")} onClick={() => setTab("edit")}>
            Puzzles
          </button>
        </div>
      </header>

      {!problems.length && (
        <p className="w-full text-center text-on-felt-soft">No puzzles yet. Add some in the Puzzles tab.</p>
      )}

      <div hidden={tab !== "play"} className="w-full">
        <FlipGame problems={problems} active={tab === "play"} />
      </div>
      <div hidden={tab !== "edit"} className="w-full max-w-[1000px]">
        <ProblemTable problems={problems} onChange={setProblems} />
      </div>
    </div>
  );
}
