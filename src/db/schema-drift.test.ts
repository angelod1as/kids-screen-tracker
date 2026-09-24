import { execFileSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

/**
 * `src/db/schema.ts` and `drizzle/*.sql` are two statements of the same thing,
 * and only the second one runs. Nothing made them agree: deleting every single
 * `check(...)` from `schema.ts` left the whole suite green, because the tests
 * apply the committed SQL and the TypeScript only ever names columns. Editing
 * the schema and forgetting `pnpm db:generate` crossed CI in silence.
 *
 * So this runs the generator the way a developer would — with the committed
 * migrations folder as its starting point — and asserts it had nothing to say.
 */

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const migrationsFolder = join(repoRoot, "drizzle");

function readSql(folder: string) {
  return Object.fromEntries(
    readdirSync(folder)
      .filter((name) => name.endsWith(".sql"))
      .sort()
      .map((name) => [name, readFileSync(join(folder, name), "utf8")]),
  );
}

let out: string;

beforeEach(() => {
  // Under `node_modules`, not the system temp directory: drizzle-kit resolves
  // `--out` against the working directory even when the path it is given is
  // absolute, so the path has to be relative and inside the repository.
  const cache = join(repoRoot, "node_modules", ".cache");
  mkdirSync(cache, { recursive: true });
  out = mkdtempSync(join(cache, "kids-screen-tracker-drift-"));
  cpSync(migrationsFolder, out, { recursive: true });
});

afterEach(() => {
  rmSync(out, { recursive: true, force: true });
});

describe("schema.ts and the committed migrations", () => {
  it("generate has nothing to add — the SQL is what the schema says", {
    timeout: 120_000,
  }, () => {
    const stdout = execFileSync(
      join(repoRoot, "node_modules", ".bin", "drizzle-kit"),
      [
        "generate",
        "--dialect",
        "sqlite",
        "--schema",
        "./src/db/schema.ts",
        "--out",
        relative(repoRoot, out),
      ],
      { cwd: repoRoot, encoding: "utf8", stdio: "pipe" },
    );

    // drizzle-kit exits 0 even when it fails, so its output is the only
    // signal that it ran at all.
    expect(stdout).toContain("No schema changes, nothing to migrate");
    expect(readSql(out)).toEqual(readSql(migrationsFolder));
  });
});
