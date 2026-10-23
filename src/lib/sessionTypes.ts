import type { Problem } from "./types";

/** A card shown during a round (no score is kept: the operator just moves on). */
export type RoundCard = { position: number; hint: string; answer: string };

/** What the game broadcasts to monitors. */
export type SessionState = {
  phase: "ready" | "playing" | "over";
  round: number; // 1 for the first round, 0 before any round
  problem: Problem | null;
  position: number; // the problem's row number in the list
  running: boolean;
  elapsed: number; // seconds on the round clock when this state was sent
  duration: number;
  target: number; // how many to answer, shown in the round's title only
  cards: RoundCard[]; // this round's earlier cards, oldest first (the one on screen is `problem`; it joins at round end)
  revealed: boolean; // the answer of `problem` is showing on the main screen
  outcome: "complete" | "time" | null; // why the round ended
  left: number; // cards not yet drawn from the deck
  total: number;
  status: { title: string; sub: string };
  ended: boolean;
};

/** What a monitor receives: the state plus server timestamps to keep the clock in step. */
export type SessionEvent = {
  state: SessionState | null;
  receivedAt: number; // server ms when the state arrived
  serverNow: number; // server ms when this event was sent
  viewers: number;
};

export const EMPTY_STATE: SessionState = {
  phase: "ready",
  round: 0,
  problem: null,
  position: 0,
  running: false,
  elapsed: 0,
  duration: 30,
  target: 5,
  cards: [],
  revealed: false,
  outcome: null,
  left: 0,
  total: 0,
  status: { title: "Waiting", sub: "The host hasn't started a round yet" },
  ended: false,
};
