import { describe, expect, it } from "vitest";

import {
  createLoginThrottle,
  delayAfter,
  FIRST_DELAY_MS,
  FORGET_AFTER_MS,
  FREE_FAILURES,
  MAX_DELAY_MS,
  MAX_ENTRIES,
  throttleKey,
} from "./login-throttle";

const T0 = 1_000_000;
const KEY = throttleKey("kid1", false);

function failTimes(
  throttle: ReturnType<typeof createLoginThrottle>,
  key: string,
  times: number,
  nowMs = T0,
): void {
  for (let i = 0; i < times; i += 1) {
    expect(throttle.begin(key, nowMs)).toBe(true);
  }
}

/** Past the free failures, walking the clock so each attempt is let through. */
function failPastFree(
  throttle: ReturnType<typeof createLoginThrottle>,
  key: string,
  extra: number,
): number {
  let now = T0;
  failTimes(throttle, key, FREE_FAILURES, now);
  for (let i = 0; i < extra; i += 1) {
    now += MAX_DELAY_MS;
    expect(throttle.begin(key, now)).toBe(true);
  }

  return now;
}

describe("the schedule (D48)", () => {
  it("waits nothing for the free failures", () => {
    for (let failures = 0; failures < FREE_FAILURES; failures += 1) {
      expect(delayAfter(failures)).toBe(0);
    }
  });

  it("doubles from one second after them", () => {
    expect(delayAfter(FREE_FAILURES)).toBe(FIRST_DELAY_MS);
    expect(delayAfter(FREE_FAILURES + 1)).toBe(2 * FIRST_DELAY_MS);
    expect(delayAfter(FREE_FAILURES + 4)).toBe(16 * FIRST_DELAY_MS);
  });

  it("never waits more than fifteen minutes", () => {
    expect(MAX_DELAY_MS).toBe(15 * 60 * 1000);
    expect(delayAfter(FREE_FAILURES + 1000)).toBe(MAX_DELAY_MS);
  });
});

describe("a throttle", () => {
  it("lets the free attempts through and refuses the next one", () => {
    const throttle = createLoginThrottle();
    failTimes(throttle, KEY, FREE_FAILURES);

    expect(throttle.begin(KEY, T0)).toBe(false);
  });

  it("opens again when the wait is over", () => {
    const throttle = createLoginThrottle();
    failTimes(throttle, KEY, FREE_FAILURES);

    expect(throttle.begin(KEY, T0 + FIRST_DELAY_MS - 1)).toBe(false);
    expect(throttle.begin(KEY, T0 + FIRST_DELAY_MS)).toBe(true);
  });

  it("does not lengthen the wait for attempts refused during it", () => {
    const throttle = createLoginThrottle();
    failTimes(throttle, KEY, FREE_FAILURES);
    for (let i = 0; i < 100; i += 1) {
      throttle.begin(KEY, T0 + 1);
    }

    expect(throttle.begin(KEY, T0 + FIRST_DELAY_MS)).toBe(true);
  });

  it("keeps a sibling's keys apart: other name, or the same name on a trusted device", () => {
    const throttle = createLoginThrottle();
    const now = failPastFree(throttle, throttleKey("admin1", false), 5);

    expect(throttle.begin(throttleKey("admin1", false), now)).toBe(false);
    expect(throttle.begin(throttleKey("admin1", true), now)).toBe(true);
    expect(throttle.begin(throttleKey("admin2", false), now)).toBe(true);
  });

  it("forgets on success", () => {
    const throttle = createLoginThrottle();
    failTimes(throttle, KEY, FREE_FAILURES);
    throttle.succeed(KEY);

    failTimes(throttle, KEY, FREE_FAILURES);
  });

  it("forgets a key left quiet for a day", () => {
    const throttle = createLoginThrottle();
    const now = failPastFree(throttle, KEY, 20);

    failTimes(throttle, KEY, FREE_FAILURES, now + FORGET_AFTER_MS);
  });

  it("holds at most MAX_ENTRIES keys", () => {
    const throttle = createLoginThrottle();
    for (let i = 0; i < MAX_ENTRIES + 10; i += 1) {
      throttle.begin(throttleKey(`name${i}`, false), T0);
    }

    expect(throttle.size()).toBe(MAX_ENTRIES);
  });

  it("evicts a stale key first, then the oldest one", () => {
    const throttle = createLoginThrottle();
    const stale = throttleKey("stale", false);
    const oldest = throttleKey("oldest", false);
    const blocked = throttleKey("blocked", false);
    throttle.begin(stale, T0 - FORGET_AFTER_MS);
    throttle.begin(oldest, T0);
    failTimes(throttle, blocked, FREE_FAILURES);
    for (let i = throttle.size(); i < MAX_ENTRIES; i += 1) {
      throttle.begin(throttleKey(`name${i}`, false), T0);
    }

    throttle.begin(throttleKey("new1", false), T0);
    expect(throttle.begin(blocked, T0)).toBe(false);
    throttle.begin(throttleKey("new2", false), T0);
    expect(throttle.begin(blocked, T0)).toBe(false);
    throttle.begin(throttleKey("new3", false), T0);

    expect(throttle.begin(blocked, T0)).toBe(true);
    expect(throttle.size()).toBe(MAX_ENTRIES);
  });

  it("hashes the username to a fixed-size key", () => {
    expect(throttleKey("x".repeat(100_000), false)).toHaveLength(43);
  });
});
