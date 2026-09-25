import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { isAllowed } from "./access";
import type { IsAllowed } from "./access.rules";
import { ACCESS_CASES, failingCases } from "./access.rules";

/**
 * Sabotage matrix for the guard (#13): each mutant, built from the real
 * `access.ts` rather than a copy, must fail at least one case. A needle that no
 * longer matches fails here instead of mutating nothing.
 */

const SOURCE_PATH = join(import.meta.dirname, "access.ts");

/**
 * Outside `src/`, which the source scans walk and a container may mount
 * read-only; not `os.tmpdir()`, which the module loader will not resolve.
 */
const MUTANT_DIR = join(import.meta.dirname, "..", "..", ".sabotage");

/** How a mutant reaches the modules `access.ts` imports from where it now sits. */
const TO_SOURCE_DIR = relative(MUTANT_DIR, import.meta.dirname);

type Mutation = {
  name: string;
  /** The exact text to find in `access.ts`. */
  find: string;
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
    find: '  "requestLog",\n];',
    replace: '  "requestLog",\n  "write",\n];',
  },
  {
    name: "a kid may no longer request an untimed log (D49)",
    find: '  "requestLog",\n];',
    replace: "];",
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
 * `./` imports are re-pointed at `src/auth/`; the query string keeps the loader
 * from serving a cached earlier mutant.
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
