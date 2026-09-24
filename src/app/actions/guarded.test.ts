import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Every server action passes through the guard, checked by reading the source.
 *
 * #13 puts the guard in the server action rather than in the navigation, and
 * the reason is that a server action is a POST endpoint: the screens are the
 * part an attacker skips. The rule holds for the actions that exist today
 * because their own tests exercise it — this file is what makes it hold for
 * #17, #18, #20, #22, #23, #24, #25, #26 and #27, none of which are written
 * yet.
 *
 * An unguarded action is not a thing anybody adds on purpose. It is a thing
 * somebody adds while thinking about something else, at 11pm, in a file where
 * the three actions above it happen to be guarded.
 *
 * The check is textual and therefore coarse: it proves a guard is *called*, not
 * that the right `targetUserId` reached it. `AccessRequest` covers the second
 * half — it has no optional field, so an action that operates on a user cannot
 * compile without naming the id the rule is about.
 */

/**
 * The whole of `src/`, and not `src/app/actions/`.
 *
 * A `"use server"` file is an endpoint wherever it is parked. Scanning only
 * this folder meant an action written next to the screen that calls it — say
 * `src/app/(app)/menino/timer/actions.ts` — was never looked at, which was
 * demonstrated by putting one there and watching lint, typecheck and the whole
 * suite stay green over a function that returned the entire ledger.
 */
const SRC_DIR = join(import.meta.dirname, "..", "..");

/**
 * The functions any of these makes safe. `requireAccess` is the general one;
 * `requireAdmin` is for an action about nobody in particular; `requireSession`
 * only establishes who is asking and is enough on its own for an action whose
 * whole subject is the caller.
 */
const GUARDS = ["requireAccess", "requireAdmin", "requireSession"];

/**
 * The two actions that are allowed to be unguarded, each with the reason.
 *
 * The list is short, it is here rather than in a comment somewhere, and adding
 * to it is a diff a reviewer sees.
 */
const UNGUARDED_BY_DESIGN: Record<string, string> = {
  loginAction:
    "the way a session begins — there is nothing to check before it runs",
  logoutAction:
    "deletes the caller's own cookie and reads nothing; a forged call logs its own sender out",
};

type Action = {
  file: string;
  name: string;
  body: string;
};

/** Strips comments so a `requireAdmin` written in prose does not count. */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|\s)\/\/.*$/gm, "$1");
}

function serverActionFiles(): string[] {
  return readdirSync(SRC_DIR, { recursive: true, withFileTypes: true })
    .filter(
      (entry) =>
        entry.isFile() &&
        /\.tsx?$/.test(entry.name) &&
        !/\.test\.tsx?$/.test(entry.name),
    )
    .map((entry) => join(entry.parentPath, entry.name));
}

/**
 * Every way a `"use server"` file can export an endpoint.
 *
 * `export async function fooAction` was the only form matched, and the arrow
 * form is the same endpoint written differently: `export const fooAction =
 * async () => {}` was invisible to this file, and invisible in the worst way —
 * the "finds them" case below compares against the four names it *did* find, so
 * an unguarded arrow action neither failed the guard check nor changed the
 * list. Both rounds found it independently by writing the file and watching the
 * suite stay green.
 *
 * `const`, `let` and `var` are all matched because Next only refuses a
 * `"use server"` export that is not an async function at build time; the point
 * here is to catch it before that.
 */
const EXPORTED =
  /export\s+(?:default\s+)?(?:async\s+function|const|let|var)\s+(\w+)/g;

/**
 * Every exported action of a `"use server"` source, with its body.
 *
 * The body runs to the next top-level `export`, or to the end of the file. That
 * is enough for the only question being asked — does the word appear inside
 * this function — and it is deliberately not a parser: a parser here would be
 * a second thing to keep working.
 *
 * Split from the file walk so the cases at the bottom can hold it against
 * sources written out by hand. A scanner whose only input is the tree
 * it is scanning is a scanner that says "no offenders" for both reasons.
 */
function exportedActionsIn(source: string, file: string): Action[] {
  const stripped = stripComments(source);
  if (!/^\s*["']use server["'];/m.test(stripped)) {
    return [];
  }

  const found: Action[] = [];
  const starts: { name: string; at: number }[] = [];

  for (const match of stripped.matchAll(EXPORTED)) {
    starts.push({ name: match[1] ?? "", at: match.index });
  }

  for (const [index, start] of starts.entries()) {
    const end = starts[index + 1]?.at ?? stripped.length;
    found.push({ file, name: start.name, body: stripped.slice(start.at, end) });
  }

  return found;
}

function exportedActions(file: string): Action[] {
  return exportedActionsIn(readFileSync(file, "utf8"), file);
}

const actions = serverActionFiles().flatMap(exportedActions);

/**
 * What the scanner finds in a source written out here rather than read off
 * disk.
 *
 * Both blind spots this file used to have were invisible for the same reason:
 * every case ran against the tree, and the tree agreed with the scanner about
 * what an action looks like. These do not.
 */
describe("what counts as an exported action", () => {
  const DIRECTIVE = '"use server";\n\n';

  it("finds the function form", () => {
    const found = exportedActionsIn(
      `${DIRECTIVE}export async function fooAction() {\n  return 1;\n}\n`,
      "probe.ts",
    );

    expect(found.map((action) => action.name)).toEqual(["fooAction"]);
  });

  it("finds the arrow form, which used to be invisible", () => {
    // `export const fooAction = async () => {}` is the same POST endpoint. It
    // was matched by nothing here, so an unguarded one passed the guard check
    // *and* left the expected-names list below unchanged.
    const found = exportedActionsIn(
      `${DIRECTIVE}export const fooAction = async () => {\n  return 1;\n};\n`,
      "probe.ts",
    );

    expect(found.map((action) => action.name)).toEqual(["fooAction"]);
  });

  it("finds a default export", () => {
    const found = exportedActionsIn(
      `${DIRECTIVE}export default async function fooAction() {\n  return 1;\n}\n`,
      "probe.ts",
    );

    expect(found.map((action) => action.name)).toEqual(["fooAction"]);
  });

  it("ignores a file that does not declare itself an endpoint", () => {
    expect(
      exportedActionsIn(
        "export const fooAction = async () => 1;\n",
        "probe.ts",
      ),
    ).toEqual([]);
  });

  it("gives each action its own body and not its neighbour's", () => {
    const [first, second] = exportedActionsIn(
      `${DIRECTIVE}export const aAction = async () => {\n  await requireAdmin();\n};\n\n` +
        "export const bAction = async () => {\n  return 2;\n};\n",
      "probe.ts",
    );

    expect(first?.body).toContain("requireAdmin(");
    expect(second?.body).not.toContain("requireAdmin(");
  });
});

describe("where the scan looks", () => {
  it("walks the whole of src/, not only this directory", () => {
    // An action parked next to the screen that calls it is still an endpoint.
    const scanned = serverActionFiles().map((file) =>
      file.slice(SRC_DIR.length + 1),
    );

    expect(scanned).toContain(join("ui", "style.ts"));
    expect(scanned).toContain(join("app", "(app)", "menino", "page.tsx"));
  });
});

describe("the server actions this app has", () => {
  it("finds them, so the check below is checking something", () => {
    // A glob that matches nothing passes every assertion in this file.
    expect(actions.map((action) => action.name).sort()).toEqual([
      "approveLogAction",
      "countPendingLogsAction",
      "createActivityAction",
      "createCategoryAction",
      "fetchActivitiesAction",
      "fetchBalanceAction",
      "fetchCalculatorDataAction",
      "fetchCategoriesAction",
      "fetchHistoryAction",
      "fetchHowItWorksAction",
      "fetchLaunchDataAction",
      "fetchLedgerEntriesAction",
      "fetchLocksAction",
      "fetchQueueAction",
      "fetchTimerScreenAction",
      "launchEntryAction",
      "listKidsAction",
      "loginAction",
      "logoutAction",
      "pauseTimerAction",
      "previewEntryAction",
      "refundHoursAction",
      "rejectLogAction",
      "releaseHoursAction",
      "resumeTimerAction",
      "setActivityActiveAction",
      "setCategoryActiveAction",
      "startTimerAction",
      "stopTimerAction",
      "updateActivityAction",
      "updateCategoryAction",
    ]);
  });

  it("only marks a file as actions when it says so", () => {
    // Every action found has to come from a file carrying the directive; a file
    // without it is not an endpoint and is not this test's business.
    for (const action of actions) {
      const source = readFileSync(action.file, "utf8");

      expect(source).toMatch(/^["']use server["'];/m);
    }
  });
});

describe("every server action calls a guard", () => {
  it.each(actions)("$name", ({ name, body }) => {
    if (name in UNGUARDED_BY_DESIGN) {
      expect(GUARDS.some((guard) => body.includes(guard))).toBe(false);

      return;
    }

    expect(
      GUARDS.some((guard) => body.includes(`${guard}(`)),
      `${name} is a POST endpoint and calls none of ${GUARDS.join(", ")}. ` +
        "Guard it, or add it to UNGUARDED_BY_DESIGN with the reason.",
    ).toBe(true);
  });

  it("keeps the list of exceptions to the two that were argued for", () => {
    // Growing this list is how the rule dies quietly. Growing it in a diff a
    // reviewer reads is the point.
    expect(Object.keys(UNGUARDED_BY_DESIGN).sort()).toEqual([
      "loginAction",
      "logoutAction",
    ]);
  });
});

describe("there is no middleware", () => {
  it("does not exist, at either of the places Next looks", () => {
    // The review note on #13: `middleware.ts` is not an App Router segment, so
    // it does not inherit `runtime = "nodejs"` from the root layout and starts
    // on edge — where `better-sqlite3` cannot load (D22). Every guard in this
    // app reads the database, so none of them can live there.
    //
    // `scripts/check-node-runtime.sh` already fails the build if a middleware
    // appears without declaring the Node runtime; this says the guard does not
    // depend on one existing at all.
    const root = join(import.meta.dirname, "..", "..", "..");
    const candidates = [
      "middleware.ts",
      "middleware.js",
      "src/middleware.ts",
      "src/middleware.js",
      "instrumentation.ts",
      "src/instrumentation.ts",
    ].filter((candidate) => existsSync(join(root, candidate)));

    expect(candidates).toEqual([]);
  });
});
