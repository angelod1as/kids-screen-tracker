import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { isAllowed } from "./access";
import type { IsAllowed } from "./access.rules";
import { ACCESS_CASES, failingCases } from "./access.rules";

/**
 * The sabotage matrix: break the guard on purpose, one clause at a time, and
 * check that something goes red.
 *
 * A test suite that passes is evidence about the code as written. It is not
 * evidence that the code is *doing* anything — a rule with no case sharp
 * enough to tell it apart from its own absence passes just as well when it is
 * deleted, and #13's whole point is that a guard nobody can make fail is
 * decoration.
 *
 * So each mutation below takes the real source of `access.ts`, replaces one
 * clause with a broken version, compiles the result and runs the entire
 * `ACCESS_CASES` table against it. Every mutant must fail at least one case,
 * and the test names which case caught it, so a future change that quietly
 * removes the last case covering a rule shows up here as "no case caught this"
 * rather than as silence.
 *
 * Two things keep the matrix honest as the code moves:
 *
 * - each mutation asserts its needle is present in the source before replacing
 *   it, so a rewrite of `access.ts` that renames a clause fails the matrix
 *   instead of quietly mutating nothing and calling the result covered;
 * - the mutants are compiled from the real file, not from a copy of it pasted
 *   into this test, so they cannot drift away from what ships.
 */

const SOURCE_PATH = join(import.meta.dirname, "access.ts");

/**
 * Where the mutants are written, and deliberately not inside `src/`.
 *
 * `pnpm test` writing generated TypeScript into the source tree is a choice
 * with consequences nobody had weighed: the files land in the directory
 * `design.test.ts`, `guarded.test.ts` and the console scan all walk, so a
 * mutant that happened to exist while one of those ran would be scanned as
 * application source; and a container with a read-only `src/` could not run the
 * suite at all. Round 2 asked for it, and the answer is one directory up.
 *
 * Not `os.tmpdir()`, which is outside the project root and therefore outside
 * what the module loader will resolve.
 */
const MUTANT_DIR = join(import.meta.dirname, "..", "..", ".sabotage");

/** How a mutant reaches the modules `access.ts` imports from where it now sits. */
const TO_SOURCE_DIR = relative(MUTANT_DIR, import.meta.dirname);

type Mutation = {
  name: string;
  /** The exact text to find in `access.ts`. */
  find: string;
  /** What to put in its place. */
  replace: string;
};

const MUTATIONS: readonly Mutation[] = [
  {
    name: "everyone is treated as an admin",
    find: 'if (session.role === "admin") {',
    replace: "if (true) {",
  },
  {
    name: "the admin check is inverted",
    find: 'if (session.role === "admin") {',
    replace: 'if (session.role !== "admin") {',
  },
  {
    name: "the target id is never compared",
    find: "if (request.targetUserId !== session.userId) {",
    replace: "if (false) {",
  },
  {
    name: "the id comparison is inverted",
    find: "if (request.targetUserId !== session.userId) {",
    replace: "if (request.targetUserId === session.userId) {",
  },
  {
    name: "a kid whose id does not match is allowed through",
    find: "    return false;\n  }\n\n  return KID_ALLOWED_KINDS.includes(request.kind);",
    replace:
      "    return true;\n  }\n\n  return KID_ALLOWED_KINDS.includes(request.kind);",
  },
  {
    name: "a kid may perform any kind of request on his own data",
    find: "return KID_ALLOWED_KINDS.includes(request.kind);",
    replace: "return true;",
  },
  {
    name: "plain writes are added to what a kid may do",
    find: '  "proposeTimerLog",\n];',
    replace: '  "proposeTimerLog",\n  "write",\n];',
  },
  {
    name: "the guard always says yes",
    find: "export function isAllowed(session: Session, request: AccessRequest): boolean {",
    replace:
      "export function isAllowed(session: Session, request: AccessRequest): boolean {\n  return true;",
  },
];

let source: string;

beforeAll(() => {
  source = readFileSync(SOURCE_PATH, "utf8");
  mkdirSync(MUTANT_DIR, { recursive: true });
});

afterAll(() => {
  rmSync(MUTANT_DIR, { recursive: true, force: true });
});

/**
 * Writes a mutant module and loads it.
 *
 * `./` imports are rewritten to point back at `src/auth/` from wherever
 * `MUTANT_DIR` is, and the query string keeps the loader from serving a cached
 * earlier mutant.
 */
async function loadMutant(index: number, mutated: string): Promise<IsAllowed> {
  const file = join(MUTANT_DIR, `mutant-${index}.ts`);
  writeFileSync(
    file,
    mutated.replaceAll('from "./', `from "${TO_SOURCE_DIR}/`),
  );

  const loaded = (await import(
    /* @vite-ignore */ `../../.sabotage/mutant-${index}.ts?v=${Date.now()}-${index}`
  )) as { isAllowed: IsAllowed };

  return loaded.isAllowed;
}

describe("the guard as written", () => {
  it("answers every case of the table correctly", () => {
    expect(failingCases(isAllowed)).toEqual([]);
  });

  it("has a table with something in it", () => {
    // A matrix run against an empty table proves nothing, loudly.
    expect(ACCESS_CASES.length).toBeGreaterThan(10);
  });
});

describe("a guard broken on purpose", () => {
  it.each(MUTATIONS.map((mutation, index) => ({ ...mutation, index })))(
    "is caught when $name",
    async ({ find, replace, index }) => {
      // If this fails, the mutation no longer applies: `access.ts` was
      // rewritten and this matrix is testing nothing. Fix the needle.
      expect(
        source.includes(find),
        `the mutation target is no longer in access.ts:\n${find}`,
      ).toBe(true);

      const mutated = source.replace(find, replace);
      expect(mutated).not.toBe(source);

      const failures = failingCases(await loadMutant(index, mutated));

      expect(
        failures.length,
        "this mutation broke the guard and no case noticed",
      ).toBeGreaterThan(0);
    },
  );

  it("covers every rule of #13 with at least one mutation", async () => {
    // Which rules the matrix actually protects, computed rather than claimed.
    const caught = new Set<string>();

    for (const [index, mutation] of MUTATIONS.entries()) {
      const mutated = source.replace(mutation.find, mutation.replace);
      for (const failure of failingCases(
        await loadMutant(MUTATIONS.length + index, mutated),
      )) {
        caught.add(failure.rule);
      }
    }

    expect([...caught].sort()).toEqual(
      [...new Set(ACCESS_CASES.map((accessCase) => accessCase.rule))].sort(),
    );
  });
});
