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
 * `schema.ts` and `drizzle/*.sql` must agree: the tests run only the SQL.
 * Runs the generator on the committed migrations and expects nothing new.
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
  // Relative, inside the repo: drizzle-kit resolves even an absolute `--out` against cwd.
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

    // drizzle-kit exits 0 on failure, so its output is the only signal.
    expect(stdout).toContain("No schema changes, nothing to migrate");
    expect(readSql(out)).toEqual(readSql(migrationsFolder));
  });
});
