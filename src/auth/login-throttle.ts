import { createHash } from "node:crypto";

/*
 * In-process, per submitted username, and a delay rather than a lock (D48).
 * Lost on restart; the app runs as one container.
 */

/** Failures a typo-prone human gets before any wait. */
export const FREE_FAILURES = 5;
export const FIRST_DELAY_MS = 1000;
/** The ceiling of the wait, so nobody is ever shut out for longer (D48). */
export const MAX_DELAY_MS = 15 * 60 * 1000;
/** A key quiet this long starts over. */
export const FORGET_AFTER_MS = 24 * 60 * 60 * 1000;
/** Bounds memory against a spray of invented usernames (D48). */
export const MAX_ENTRIES = 50_000;

type Entry = { failures: number; lastAt: number; blockedUntil: number };

/**
 * `trusted`: the browser carries a device cookie for this very username, so a
 * sibling's failures from another device do not delay it (D48). Hashed, so an
 * arbitrarily long username costs a fixed-size key.
 */
export function throttleKey(normalizedUsername: string, trusted: boolean) {
  return createHash("sha256")
    .update(`${trusted ? "device" : "any"}\0${normalizedUsername}`)
    .digest("base64url");
}

export function delayAfter(failures: number): number {
  if (failures < FREE_FAILURES) {
    return 0;
  }

  return Math.min(
    FIRST_DELAY_MS * 2 ** (failures - FREE_FAILURES),
    MAX_DELAY_MS,
  );
}

export function createLoginThrottle() {
  const entries = new Map<string, Entry>();

  function live(key: string, nowMs: number): Entry | undefined {
    const entry = entries.get(key);
    if (entry !== undefined && nowMs - entry.lastAt >= FORGET_AFTER_MS) {
      entries.delete(key);
      return undefined;
    }

    return entry;
  }

  function makeRoom(nowMs: number): void {
    for (const [key, entry] of entries) {
      if (entries.size < MAX_ENTRIES) {
        return;
      }
      if (nowMs - entry.lastAt >= FORGET_AFTER_MS) {
        entries.delete(key);
      }
    }
    // Insertion order is oldest first.
    for (const key of entries.keys()) {
      if (entries.size < MAX_ENTRIES) {
        return;
      }
      entries.delete(key);
    }
  }

  return {
    /**
     * Charged as a failure before the password is checked, and synchronously,
     * so parallel requests cannot all slip through one open window. `false`:
     * refuse without checking.
     */
    begin(key: string, nowMs: number): boolean {
      const entry = live(key, nowMs);
      if (entry !== undefined && nowMs < entry.blockedUntil) {
        return false;
      }

      const failures = (entry?.failures ?? 0) + 1;
      if (entry === undefined) {
        makeRoom(nowMs);
      }
      entries.delete(key);
      entries.set(key, {
        failures,
        lastAt: nowMs,
        blockedUntil: nowMs + delayAfter(failures),
      });

      return true;
    },

    succeed(key: string): void {
      entries.delete(key);
    },

    size(): number {
      return entries.size;
    },

    clear(): void {
      entries.clear();
    },
  };
}

export const loginThrottle = createLoginThrottle();
