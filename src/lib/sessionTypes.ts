import type { Problem } from "./types";

/** What the game broadcasts to monitors. */
export type SessionState = {
  problem: Problem | null;
  position: number; // the problem's row number in the list
  revealed: boolean;
  running: boolean;
  done: boolean;
  elapsed: number; // seconds on the clock when this state was sent
  duration: number;
  mode: "down" | "up";
  drawn: number;
  total: number;
  status: { title: string; sub: string };
  history: { position: number; hint: string; answer: string }[];
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
  problem: null,
  position: 0,
  revealed: false,
  running: false,
  done: false,
  elapsed: 0,
  duration: 30,
  mode: "down",
  drawn: 0,
  total: 0,
  status: { title: "Waiting", sub: "The host hasn't drawn a card yet" },
  history: [],
  ended: false,
};
