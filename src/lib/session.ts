import "server-only";
import { randomBytes } from "crypto";
import os from "os";
import { EMPTY_STATE, type SessionEvent, type SessionState } from "./sessionTypes";

type Listener = (e: SessionEvent) => void;
type Session = {
  id: string;
  state: SessionState;
  receivedAt: number;
  touchedAt: number;
  listeners: Set<Listener>;
};

// Sessions live in memory; keep them on globalThis so dev hot-reloads don't drop them.
const g = globalThis as unknown as { __owfSessions?: Map<string, Session> };
const sessions = (g.__owfSessions ??= new Map());
const MAX_IDLE_MS = 12 * 60 * 60 * 1000;

function prune() {
  const now = Date.now();
  for (const [id, s] of sessions) if (now - s.touchedAt > MAX_IDLE_MS && !s.listeners.size) sessions.delete(id);
}

const MAX_SESSIONS = 500;

export function createSession(): Session {
  prune();
  if (sessions.size >= MAX_SESSIONS) throw new Error("Too many sessions are running. Try again later.");
  // No look-alike characters, so the code is easy to read off a screen.
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let id: string;
  do id = [...randomBytes(6)].map((b) => alphabet[b % alphabet.length]).join("");
  while (sessions.has(id));
  const now = Date.now();
  const s: Session = { id, state: EMPTY_STATE, receivedAt: now, touchedAt: now, listeners: new Set() };
  sessions.set(id, s);
  return s;
}

export function getSession(id: string) {
  return sessions.get(id.toUpperCase());
}

export function eventFor(s: Session): SessionEvent {
  return { state: s.state, receivedAt: s.receivedAt, serverNow: Date.now(), viewers: s.listeners.size };
}

export function updateSession(s: Session, state: SessionState) {
  s.state = state;
  s.receivedAt = s.touchedAt = Date.now();
  broadcast(s);
}

export function broadcast(s: Session) {
  const e = eventFor(s);
  for (const l of s.listeners) l(e);
}

/** Addresses other devices on the same Wi-Fi can use to reach this server. */
export function lanAddresses(): string[] {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((i): i is os.NetworkInterfaceInfo => !!i && i.family === "IPv4" && !i.internal)
    .map((i) => i.address)
    // Prefer ordinary Wi-Fi/office ranges over VPN ones (e.g. Tailscale's 100.x).
    .sort((a, b) => Number(!isPrivateLan(a)) - Number(!isPrivateLan(b)));
}

function isPrivateLan(ip: string) {
  return /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip);
}
