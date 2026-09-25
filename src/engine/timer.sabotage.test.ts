import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { TimerCase, TimerRules } from "./timer.rules";
import { failingTimerCases, TIMER_CASES } from "./timer.rules";

/*
 * Breaks one clause of `timer.ts` at a time and runs the whole table against it:
 * "cut from the stamps" and "cut from the read" agree on every hand-written test.
 */

const SOURCE_PATH = join(import.meta.dirname, "timer.ts");

/** Outside `src/`: `design.test.ts` and `guarded.test.ts` would scan a mutant as source. */
const MUTANT_DIR = join(import.meta.dirname, "..", "..", ".sabotage-timer");

type Mutation = {
  name: string;
  find: string;
  replace: string;
};

const MUTATIONS: readonly Mutation[] = [
  {
    name: "a paused clock keeps counting",
    find: '  if (timer.status !== "running") {\n    return timer.accumulatedSeconds;\n  }',
    replace: "  if (false) {\n    return timer.accumulatedSeconds;\n  }",
  },
  {
    name: "a running clock is frozen",
    find: '  if (timer.status !== "running") {\n    return timer.accumulatedSeconds;\n  }',
    replace: "  if (true) {\n    return timer.accumulatedSeconds;\n  }",
  },
  {
    name: "the banked stretches are dropped when the clock is read",
    find: "  return timer.accumulatedSeconds + Math.max(0, elapsed);",
    replace: "  return Math.max(0, elapsed);",
  },
  {
    name: "a resumed session counts from the original start again",
    find: "  return timer.pausedAt ?? timer.startedAt;",
    replace: "  return timer.startedAt;",
  },
  {
    name: "a clock that ran backwards un-counts seconds",
    find: "  return timer.accumulatedSeconds + Math.max(0, elapsed);",
    replace: "  return timer.accumulatedSeconds + elapsed;",
  },

  {
    name: "the allowance is not reduced by what was already spent",
    find: "  const remaining = limitSeconds - timer.accumulatedSeconds;",
    replace: "  const remaining = limitSeconds;",
  },
  {
    name: "a paused session is still on its way to a limit",
    find: '  if (timer.status !== "running" || maxSessionMinutes === null) {\n    return null;\n  }',
    replace: "  if (maxSessionMinutes === null) {\n    return null;\n  }",
  },
  {
    name: "an activity with no limit stops anyway",
    find: '  if (timer.status !== "running" || maxSessionMinutes === null) {\n    return null;\n  }',
    replace: '  if (timer.status !== "running") {\n    return null;\n  }',
  },
  {
    name: "the session freezes at what the clock said instead of at the limit",
    find: '      accumulatedSeconds: settled.activeSeconds,\n      status: "stopped",',
    replace:
      '      accumulatedSeconds: Math.round(activeSeconds(timer, now)),\n      status: "stopped",',
  },
  {
    name: "the record says it ended when it was read",
    find: "    settledAt: settled.at,\n    reason: settled.reason,\n    autoStopped: true,",
    replace:
      "    settledAt: now,\n    reason: settled.reason,\n    autoStopped: true,",
  },
  {
    name: "the active seconds reported are the ones the clock had at the read",
    find: "    autoStopped: true,\n    activeSeconds: settled.activeSeconds,",
    replace:
      "    autoStopped: true,\n    activeSeconds: activeSeconds(timer, now),",
  },
  {
    name: "the automatic stop is not marked as one",
    find: "    reason: settled.reason,\n    autoStopped: true,",
    replace: "    reason: settled.reason,\n    autoStopped: false,",
  },
  {
    name: "a rule fires a second early",
    find: "    if (candidate.at > now) continue;",
    replace: "    if (candidate.at.getTime() - 1000 > now.getTime()) continue;",
  },
  {
    name: "no rule ever fires",
    find: "    if (candidate.at > now) continue;",
    replace: "    continue;",
  },
  {
    name: "every rule fires the moment the session starts",
    find: "    if (candidate.at > now) continue;",
    replace: "    if (false) continue;",
  },
  {
    name: "the limit is dropped from the rules that can fire",
    find: "  if (cut !== null) {",
    replace: "  if (false) {",
  },
  {
    name: "the last rule to fire wins instead of the first",
    find: "    if (earliest === null || candidate.at < earliest.at) {",
    replace: "    if (earliest === null || candidate.at > earliest.at) {",
  },

  {
    name: "the pause has to last a day",
    find: "export const ABANDON_AFTER_HOURS = 12;",
    replace: "export const ABANDON_AFTER_HOURS = 24;",
  },
  {
    name: "the pause is abandoned after an hour",
    find: "export const ABANDON_AFTER_HOURS = 12;",
    replace: "export const ABANDON_AFTER_HOURS = 1;",
  },
  {
    name: "a running session can be abandoned too",
    find: '  return timer.status === "paused" && timer.pausedAt !== null',
    replace: "  return timer.pausedAt !== null",
  },
  {
    name: "nothing is ever abandoned",
    find: "  if (abandoned !== null) {",
    replace: "  if (false) {",
  },
  {
    name: "the abandonment is dated from the read",
    find: "      settledAt: settled.at,\n      reason: settled.reason,\n      autoStopped: false,",
    replace:
      "      settledAt: now,\n      reason: settled.reason,\n      autoStopped: false,",
  },
  {
    name: "an abandoned session is stopped instead, and would leave a record",
    find: '      state: { ...timer, status: "abandoned" },',
    replace: '      state: { ...timer, status: "stopped" },',
  },
  {
    name: "an abandoned session is marked as an automatic stop",
    find: "      reason: settled.reason,\n      autoStopped: false,",
    replace: "      reason: settled.reason,\n      autoStopped: true,",
  },
  {
    name: "an abandoned pause is treated as the end of the day, and leaves a record",
    find: '  if (settled.reason === "abandoned") {',
    replace: "  if (false) {",
  },

  {
    name: "the day never ends a session",
    find: '  found.push({\n    reason: "dayEnd",',
    replace: '  if (false) found.push({\n    reason: "dayEnd",',
  },
  {
    name: "the day the session ends on is the day after the one it began on",
    find: "  return saoPauloDayStart(shiftDate(saoPauloDay(timer.startedAt), 1));",
    replace:
      "  return saoPauloDayStart(shiftDate(saoPauloDay(timer.startedAt), 2));",
  },
  {
    name: "the day ends where the calendar day the boy is in ends, not his session's",
    find: "  return saoPauloDayStart(shiftDate(saoPauloDay(timer.startedAt), 1));",
    replace: "  return saoPauloDayStart(saoPauloDay(timer.startedAt));",
  },
  {
    name: "the day's end freezes what the clock says at the read",
    find: '    reason: "dayEnd",\n    at: dayEnd,\n    activeSeconds: activeSeconds(timer, dayEnd),',
    replace: '    reason: "dayEnd",\n    at: dayEnd,\n    activeSeconds: 0,',
  },
  {
    name: "the day's end is reported as the limit, so the boy is told the wrong thing",
    find: '    reason: "dayEnd",\n    at: dayEnd,',
    replace: '    reason: "limit",\n    at: dayEnd,',
  },

  {
    name: "D17's floor of one comes back, and ten seconds are a minute again",
    find: "  return Math.floor(\n    (durationSeconds(seconds) + SECONDS_PER_MINUTE / 2) / SECONDS_PER_MINUTE,\n  );",
    replace:
      "  return Math.max(\n    1,\n    Math.floor(\n      (durationSeconds(seconds) + SECONDS_PER_MINUTE / 2) / SECONDS_PER_MINUTE,\n    ),\n  );",
  },
  {
    name: "the duration is truncated instead of rounded",
    find: "  return Math.floor(\n    (durationSeconds(seconds) + SECONDS_PER_MINUTE / 2) / SECONDS_PER_MINUTE,\n  );",
    replace:
      "  return Math.floor(durationSeconds(seconds) / SECONDS_PER_MINUTE);",
  },
  {
    name: "the duration is rounded up instead of to the nearest minute",
    find: "  return Math.floor(\n    (durationSeconds(seconds) + SECONDS_PER_MINUTE / 2) / SECONDS_PER_MINUTE,\n  );",
    replace:
      "  return Math.ceil(durationSeconds(seconds) / SECONDS_PER_MINUTE);",
  },
  {
    name: "the measured seconds are rounded up instead of floored",
    find: "  return Math.max(0, Math.floor(seconds));",
    replace: "  return Math.max(0, Math.ceil(seconds));",
  },
  {
    name: "a clock that ran backwards banks negative seconds",
    find: "  return Math.max(0, Math.floor(seconds));",
    replace: "  return Math.floor(seconds);",
  },
];

/**
 * Must come back uncaught: a runner that failed to import, or a table comparing
 * everything to `undefined`, would report every mutant caught.
 */
const CONTROL: Mutation = {
  name: "the clamp at zero is written as a comparison instead of Math.max",
  find: "  return Math.max(0, Math.floor(seconds));",
  replace: "  return seconds < 0 ? 0 : Math.floor(seconds);",
};

let source: string;

beforeAll(() => {
  source = readFileSync(SOURCE_PATH, "utf8");
  mkdirSync(MUTANT_DIR, { recursive: true });
});

afterAll(() => {
  rmSync(MUTANT_DIR, { recursive: true, force: true });
});

/** The mutant sits outside `src/`, so its relative imports are rewritten. */
function rehome(mutated: string): string {
  return mutated.replace(
    /from "(\.[^"]*)"/g,
    (_whole, specifier: string) =>
      `from "${relative(MUTANT_DIR, resolve(import.meta.dirname, specifier))}"`,
  );
}

async function loadMutant(index: number, mutated: string): Promise<TimerRules> {
  const name = `mutant-${index}.ts`;
  writeFileSync(join(MUTANT_DIR, name), rehome(mutated));

  return (await import(
    /* @vite-ignore */ `../../.sabotage-timer/${name}?v=${Date.now()}-${index}`
  )) as TimerRules;
}

function mutate(mutation: Mutation): string {
  expect(
    source.includes(mutation.find),
    `the mutation target is no longer in timer.ts:\n${mutation.find}`,
  ).toBe(true);

  const mutated = source.replace(mutation.find, mutation.replace);

  expect(mutated).not.toBe(source);

  return mutated;
}

describe("a timer broken on purpose", () => {
  it.each(MUTATIONS.map((mutation, index) => ({ ...mutation, index })))(
    "is caught when $name",
    async (mutation) => {
      const failures = failingTimerCases(
        await loadMutant(mutation.index, mutate(mutation)),
      );

      expect(
        failures.length,
        "this mutation broke a rule and no case noticed",
      ).toBeGreaterThan(0);
    },
  );

  it("covers every rule of #18 and #19 with at least one mutation", async () => {
    const caught = new Set<string>();

    for (const [index, mutation] of MUTATIONS.entries()) {
      for (const failure of failingTimerCases(
        await loadMutant(MUTATIONS.length + index, mutate(mutation)),
      )) {
        caught.add(failure.rule);
      }
    }

    expect([...caught].sort()).toEqual(rules());
  });
});

describe("the control: the matrix can still say no", () => {
  it("does not catch a rewrite that means the same thing", async () => {
    const failures = failingTimerCases(
      await loadMutant(2 * MUTATIONS.length, mutate(CONTROL)),
    );

    expect(
      failures.map((failure: TimerCase) => failure.name),
      "the control was caught, so the matrix is failing mutants for a reason " +
        "other than the one it claims — a load error, or a table comparing " +
        "everything against undefined",
    ).toEqual([]);
  });

  it("catches the same line broken for real, from the same machinery", async () => {
    // Same needle and machinery as the control; only the intent differs.
    const failures = failingTimerCases(
      await loadMutant(
        2 * MUTATIONS.length + 1,
        mutate({
          ...CONTROL,
          name: "the clamp is dropped from the same rewrite",
          replace: "  return seconds < 0 ? -1 : Math.floor(seconds);",
        }),
      ),
    );

    expect(failures.length).toBeGreaterThan(0);
  });
});

function rules(): string[] {
  return [...new Set(TIMER_CASES.map((timerCase) => timerCase.rule))].sort();
}
