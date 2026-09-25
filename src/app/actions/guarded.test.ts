import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Every server action calls a guard, checked by reading the source (#13). Coarse:
 * it proves a guard is called, not that the right `targetUserId` reached it;
 * `AccessRequest` having no optional field covers that half.
 */

/** All of `src/`: a `"use server"` file is an endpoint wherever it is parked. */
const SRC_DIR = join(import.meta.dirname, "..", "..");

/** `requireSession` alone suffices only for an action whose whole subject is the caller. */
const GUARDS = ["requireAccess", "requireAdmin", "requireSession"];

/** Adding to this list is a diff a reviewer sees. */
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
 * The arrow form too, and `let`/`var`: Next only refuses a non-async export at
 * build time, and this should catch it first.
 */
const EXPORTED =
  /export\s+(?:default\s+)?(?:async\s+function|const|let|var)\s+(\w+)/g;

/**
 * The body runs to the next top-level `export`; deliberately not a parser.
 * Split from the file walk so cases can feed it hand-written sources.
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

/** Sources written here, not read off disk: the tree always agrees with the scanner. */
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
      "requestLogAction",
      "resumeTimerAction",
      "savePushSubscriptionAction",
      "setActivityActiveAction",
      "setCategoryActiveAction",
      "startTimerAction",
      "stopTimerAction",
      "updateActivityAction",
      "updateCategoryAction",
      "voidEntryAction",
    ]);
  });

  it("only marks a file as actions when it says so", () => {
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
    // Growing this list is how the rule dies quietly.
    expect(Object.keys(UNGUARDED_BY_DESIGN).sort()).toEqual([
      "loginAction",
      "logoutAction",
    ]);
  });
});

describe("there is no middleware", () => {
  it("does not exist, at either of the places Next looks", () => {
    // `middleware.ts` does not inherit `runtime = "nodejs"` and starts on edge,
    // where `better-sqlite3` cannot load (D22).
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
