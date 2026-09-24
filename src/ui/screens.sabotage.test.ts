import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { signedHours } from "./entries";
import { parseTypedHours } from "./hours";
import type { ScreenRules } from "./screens.rules";
import { failingScreenCases, SCREEN_CASES } from "./screens.rules";

/**
 * The two screens of Phase 4 import their own server actions, and a
 * `"use server"` module reaches `varlock/env` and the database file the moment
 * it is imported. Replacing the two of them is what lets a mutant of a screen
 * be loaded at all; nothing in this file calls one.
 */
vi.mock("../app/actions/timer", () => ({
  fetchTimerScreenAction: async () => null,
  startTimerAction: async () => null,
  pauseTimerAction: async () => null,
  resumeTimerAction: async () => null,
  stopTimerAction: async () => null,
}));

vi.mock("../app/actions/queue", () => ({
  fetchQueueAction: async () => null,
  approveLogAction: async () => null,
  rejectLogAction: async () => null,
}));

vi.mock("../app/actions/admin", () => ({
  fetchLaunchDataAction: async () => null,
  previewEntryAction: async () => null,
  launchEntryAction: async () => null,
}));

vi.mock("../app/actions/ledger", () => ({
  releaseHoursAction: async () => null,
  refundHoursAction: async () => null,
}));

const { displayedSeconds, settlementText } = await import(
  "../app/(app)/menino/cronometro/timer-screen"
);
const { canApprove } = await import("../app/(app)/admin/fila/queue-list");
const { canConfirm, entryOf } = await import(
  "../app/(app)/admin/lancar/launch-form"
);
const { canRefund } = await import("../app/(app)/admin/estornar/refund-form");

/**
 * The sabotage matrix for the Phase 3 rules, in the shape
 * `access.sabotage.test.ts` established.
 *
 * The suite going green is evidence about the code as written, not evidence
 * that any of it is load-bearing: an assertion that passes with the rule
 * deleted protects nothing, and this project has shipped four pull requests
 * with tests of exactly that kind. So each mutation below takes the real
 * source, replaces one clause with a broken one, compiles the result and runs
 * the whole `SCREEN_CASES` table against it. Every mutant has to fail at least
 * one case, and the last case computes which rules the matrix actually
 * protects rather than claiming a number.
 *
 * The needles are asserted present before they are replaced, so a rewrite that
 * renames a clause fails here instead of quietly mutating nothing.
 */

const UI_DIR = import.meta.dirname;

/**
 * Where the mutants are written: one directory above `src/`, for the reasons
 * `access.sabotage.test.ts` gives — `design.test.ts` and `guarded.test.ts` both
 * walk `src/`, and a mutant sitting there while one of them ran would be read
 * as application source.
 */
const MUTANT_DIR = join(UI_DIR, "..", "..", ".sabotage-screens");

/**
 * The two screens of Phase 4, as paths relative to `src/ui/`.
 *
 * The matrix used to live entirely inside `src/ui/`; the rules of the timer and
 * of the queue's one-tap approval live in the screens themselves, and a matrix
 * that stops at a directory boundary protects whatever happens to be on its
 * side of it.
 */
const TIMER_SCREEN = "../app/(app)/menino/cronometro/timer-screen.tsx";
const QUEUE_LIST = "../app/(app)/admin/fila/queue-list.tsx";

/** The two screens of Phase 5 that carry a rule of their own, and `hours.ts`. */
const LAUNCH_FORM = "../app/(app)/admin/lancar/launch-form.tsx";
const REFUND_FORM = "../app/(app)/admin/estornar/refund-form.tsx";

type Mutation = {
  name: string;
  /** The file under `src/ui/` the mutation edits. */
  file: string;
  /** The exact text to find in it. */
  find: string;
  /** What to put in its place. */
  replace: string;
};

const MUTATIONS: readonly Mutation[] = [
  // --- the sign of a ledger entry (#16) -------------------------------------
  {
    name: "a spend reads as a credit",
    file: "entries.tsx",
    find: 'return entry.kind === "spend" ? -entry.hours : entry.hours;',
    replace: "return entry.hours;",
  },
  {
    name: "the kind that subtracts is the wrong one",
    file: "entries.tsx",
    find: 'return entry.kind === "spend" ? -entry.hours : entry.hours;',
    replace: 'return entry.kind === "earn" ? -entry.hours : entry.hours;',
  },
  {
    name: "a refund subtracts too",
    file: "entries.tsx",
    find: 'return entry.kind === "spend" ? -entry.hours : entry.hours;',
    replace: 'return entry.kind === "earn" ? entry.hours : -entry.hours;',
  },

  // --- the digits of the boy's timer (#18) ----------------------------------
  {
    name: "the digits keep counting while the session is paused",
    file: TIMER_SCREEN,
    find: 'if (open.status !== "running") return open.activeSeconds;',
    replace: "if (false) return open.activeSeconds;",
  },
  {
    name: "the digits ignore what the browser watched go by",
    file: TIMER_SCREEN,
    find: "  const counted = open.activeSeconds + Math.max(0, watchedMs) / 1000;",
    replace: "  const counted = open.activeSeconds;",
  },
  {
    name: "a browser clock that ran backwards takes seconds away",
    file: TIMER_SCREEN,
    find: "  const counted = open.activeSeconds + Math.max(0, watchedMs) / 1000;",
    replace: "  const counted = open.activeSeconds + watchedMs / 1000;",
  },
  {
    name: "the digits run past the limit",
    file: TIMER_SCREEN,
    find: "  return limit === null ? counted : Math.min(counted, limit);",
    replace: "  return counted;",
  },
  {
    name: "an activity with no limit is capped anyway",
    file: TIMER_SCREEN,
    find: "  return limit === null ? counted : Math.min(counted, limit);",
    replace: "  return Math.min(counted, limit ?? 0);",
  },

  // --- what the boy is told about a session that ended without him (#19) ----
  {
    name: "the turn of the day is announced as the limit",
    file: TIMER_SCREEN,
    find: '    case "dayEnded":',
    replace: '    case "never":',
  },
  {
    name: "the limit is announced as an abandonment",
    file: TIMER_SCREEN,
    find: '    case "autoStopped":',
    replace: '    case "never":',
  },

  // --- when approving is a tap that can be taken (#20) ----------------------
  {
    name: "an entry with an undecided one before it can be approved anyway",
    file: QUEUE_LIST,
    find: "  if (entry.blockedBy !== null) return false;",
    replace: "  if (false) return false;",
  },
  {
    name: "nothing can be approved at all",
    file: QUEUE_LIST,
    find: "  if (entry.blockedBy !== null) return false;",
    replace: "  return false;",
  },
  {
    name: "a correction with no usable duration is offered anyway",
    file: QUEUE_LIST,
    find: "    !graded && Number.isInteger(typed) && typed >= 1 && typed <= MAX_MINUTES",
    replace: "    true",
  },
  {
    name: "a correction of zero minutes is offered",
    file: QUEUE_LIST,
    find: "    !graded && Number.isInteger(typed) && typed >= 1 && typed <= MAX_MINUTES",
    replace: "    !graded && Number.isInteger(typed) && typed >= 0",
  },
  {
    name: "a fraction of a minute is offered",
    file: QUEUE_LIST,
    find: "    !graded && Number.isInteger(typed) && typed >= 1 && typed <= MAX_MINUTES",
    replace: "    !graded && typed >= 1",
  },
  {
    name: "a correction of any length at all is offered",
    file: QUEUE_LIST,
    find: "    !graded && Number.isInteger(typed) && typed >= 1 && typed <= MAX_MINUTES",
    replace: "    !graded && Number.isInteger(typed) && typed >= 1",
  },
  {
    name: "an entry that needs a grade is offered without one",
    file: QUEUE_LIST,
    find: "    !graded && Number.isInteger(typed) && typed >= 1 && typed <= MAX_MINUTES",
    replace:
      "    Number.isInteger(typed) && typed >= 1 && typed <= MAX_MINUTES",
  },

  // --- um número de horas como um adulto digita (#22, #23, #24) ------------
  {
    name: "a blank field is read as zero hours",
    file: "hours.ts",
    find: "  if (!/^\\d+(\\.\\d+)?$/.test(typed)) return null;",
    replace: "  if (false) return null;",
  },
  {
    name: "the comma is not a decimal separator",
    file: "hours.ts",
    find: '  const typed = text.trim().replace(",", ".");',
    replace: "  const typed = text.trim();",
  },
  {
    name: "anything with a digit in it is a number",
    file: "hours.ts",
    find: "  if (!/^\\d+(\\.\\d+)?$/.test(typed)) return null;",
    replace: "  if (!/\\d/.test(typed)) return null;",
  },

  // --- o formulário do lançamento (#22) ------------------------------------
  {
    name: "a duration is sent whatever the activity is",
    file: LAUNCH_FORM,
    find: '    durationMinutes:\n      activity.calcMode === "duration" ? form.durationMinutes : null,',
    replace: "    durationMinutes: form.durationMinutes,",
  },
  {
    name: "a grade is sent whatever the activity is",
    file: LAUNCH_FORM,
    find: "    quality: activity.qualityGraded ? form.quality : null,",
    replace: "    quality: form.quality,",
  },
  {
    name: "a free activity is sent with no value typed",
    file: LAUNCH_FORM,
    find: '  if (activity.calcMode === "free" && freeValue === null) return null;',
    replace: "  if (false) return null;",
  },
  {
    name: "a note of nothing but spaces is sent as a note",
    file: LAUNCH_FORM,
    find: '    note: form.note.trim() === "" ? null : form.note.trim(),',
    replace: "    note: form.note,",
  },
  {
    name: "the confirm button is offered before anything was asked",
    file: LAUNCH_FORM,
    find: "  if (preview === null) return false;",
    replace: "  if (preview === null) return true;",
  },
  {
    name: "an entry waiting to be decided does not stop the launch",
    file: LAUNCH_FORM,
    find: "  return preview.blockedBy === null;",
    replace: "  return true;",
  },

  // --- o estorno (#24) ------------------------------------------------------
  {
    name: "a refund with no reason is offered",
    file: REFUND_FORM,
    find: '  return parseTypedHours(hours) !== null && reason.trim() !== "";',
    replace: "  return parseTypedHours(hours) !== null;",
  },
  {
    name: "a refund with no amount is offered",
    file: REFUND_FORM,
    find: '  return parseTypedHours(hours) !== null && reason.trim() !== "";',
    replace: '  return reason.trim() !== "";',
  },
];

const sources = new Map<string, string>();

beforeAll(() => {
  for (const file of new Set(MUTATIONS.map((mutation) => mutation.file))) {
    sources.set(file, readFileSync(join(UI_DIR, file), "utf8"));
  }
  mkdirSync(MUTANT_DIR, { recursive: true });
});

afterAll(() => {
  rmSync(MUTANT_DIR, { recursive: true, force: true });
});

/**
 * Rewrites every relative import so the mutant, sitting outside `src/`, still
 * reaches what the original reached.
 *
 * Resolving each specifier against the *original* file's directory and then
 * making it relative to `MUTANT_DIR` is what keeps this working for `./hours`
 * and `../engine/calculate` alike — a `replaceAll('from "./', …)` handles the
 * first and silently breaks the second.
 */
function rehome(source: string, file: string): string {
  const fromDir = dirname(join(UI_DIR, file));

  return source.replace(
    /from "(\.[^"]*)"/g,
    (_whole, specifier: string) =>
      `from "${relative(MUTANT_DIR, resolve(fromDir, specifier))}"`,
  );
}

/**
 * Writes one mutant of `file` and loads the rules from it.
 *
 * Only the mutated module is replaced: the other rules come from the real
 * source, so a mutation of `entries.tsx` cannot accidentally be caught by a
 * case belonging to another screen, and the coverage computation at the bottom
 * stays honest.
 */
async function loadMutant(
  index: number,
  file: string,
  mutated: string,
): Promise<ScreenRules> {
  const name = `mutant-${index}.tsx`;
  writeFileSync(join(MUTANT_DIR, name), rehome(mutated, file));

  const loaded = (await import(
    /* @vite-ignore */ `../../.sabotage-screens/${name}?v=${Date.now()}-${index}`
  )) as Partial<ScreenRules>;

  return { ...REAL, ...loaded };
}

const REAL: ScreenRules = {
  signedHours,
  displayedSeconds,
  settlementText,
  canApprove,
  parseTypedHours,
  entryOf,
  canConfirm,
  canRefund,
};

describe("the rules as written", () => {
  it("answer every case of the table correctly", () => {
    expect(failingScreenCases(REAL)).toEqual([]);
  });

  it("have a table with something in it", () => {
    // A matrix run against an empty table proves nothing, loudly.
    expect(SCREEN_CASES.length).toBeGreaterThan(10);
  });
});

describe("a rule broken on purpose", () => {
  it.each(MUTATIONS.map((mutation, index) => ({ ...mutation, index })))(
    "is caught when $name",
    async ({ file, find, index, replace }) => {
      const source = sources.get(file);
      // If this fails the mutation no longer applies: the file was rewritten
      // and this matrix is testing nothing. Fix the needle.
      expect(
        source?.includes(find),
        `the mutation target is no longer in ${file}:\n${find}`,
      ).toBe(true);

      const mutated = (source ?? "").replace(find, replace);
      expect(mutated).not.toBe(source);

      const failures = failingScreenCases(
        await loadMutant(index, file, mutated),
      );

      expect(
        failures.length,
        "this mutation broke a rule and no case noticed",
      ).toBeGreaterThan(0);
    },
  );

  it("covers every rule of the screens with at least one mutation", async () => {
    // Which rules the matrix actually protects, computed rather than claimed.
    const caught = new Set<string>();

    for (const [index, mutation] of MUTATIONS.entries()) {
      const source = sources.get(mutation.file) ?? "";
      const mutated = source.replace(mutation.find, mutation.replace);

      for (const failure of failingScreenCases(
        await loadMutant(MUTATIONS.length + index, mutation.file, mutated),
      )) {
        caught.add(failure.rule);
      }
    }

    expect([...caught].sort()).toEqual(
      [...new Set(SCREEN_CASES.map((screenCase) => screenCase.rule))].sort(),
    );
  });
});
