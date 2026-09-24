import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const script = join(scriptsDir, "check-env-keys.mjs");
const schema = readFileSync(join(scriptsDir, "..", ".env.schema"), "utf8");

const LEFTOVER = "fixture-leftover-5d0a";

function graph(config: Record<string, string>) {
  return JSON.stringify({
    config: Object.fromEntries(
      Object.entries(config).map(([name, value]) => [
        name,
        { value, isSensitive: true },
      ]),
    ),
  });
}

const fixtures: string[] = [];

function run(schemaText: string | null, env: Record<string, string> = {}) {
  const root = mkdtempSync(join(tmpdir(), "check-env-keys-"));
  fixtures.push(root);
  if (schemaText !== null) writeFileSync(join(root, ".env.schema"), schemaText);
  const { __VARLOCK_ENV: _ignored, ...parentEnv } = process.env;
  const result = spawnSync(process.execPath, [script], {
    cwd: root,
    encoding: "utf8",
    env: { ...parentEnv, ...env },
  });
  return { ...result, text: `${result.stdout}${result.stderr}` };
}

afterEach(() => {
  for (const root of fixtures.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("check-env-keys", () => {
  it("passes when every resolved item is declared in the real schema", () => {
    const result = run(schema, {
      __VARLOCK_ENV: graph({ DATABASE_PATH: "x", SESSION_SECRET: "y" }),
    });

    expect(result.status, result.text).toBe(0);
  });

  it("fails on a key the schema no longer declares and names it, never the value", () => {
    const result = run(schema, {
      __VARLOCK_ENV: graph({
        DATABASE_PATH: "x",
        SESSION_SECRET: "y",
        AUTH_KID1: LEFTOVER,
      }),
    });

    expect(result.status).toBe(1);
    expect(result.text).toContain(
      "AUTH_KID1 is set but not declared in .env.schema",
    );
    expect(result.text).not.toContain("DATABASE_PATH is set");
    expect(result.text).not.toContain(LEFTOVER);
  });

  it("does not count a commented-out declaration", () => {
    const result = run("# AUTH_KID1=\nDATABASE_PATH=\n", {
      __VARLOCK_ENV: graph({ DATABASE_PATH: "x", AUTH_KID1: LEFTOVER }),
    });

    expect(result.status).toBe(1);
    expect(result.text).toContain("AUTH_KID1 is set");
  });

  it("fails when the schema declares nothing", () => {
    const result = run("# only comments\n", {
      __VARLOCK_ENV: graph({ DATABASE_PATH: "x" }),
    });

    expect(result.status).toBe(1);
    expect(result.text).toContain("nothing to compare against");
  });

  it("fails with its own message when there is no schema", () => {
    const result = run(null, {
      __VARLOCK_ENV: graph({ DATABASE_PATH: "x" }),
    });

    expect(result.status).toBe(1);
    expect(result.text).toContain("no .env.schema");
    expect(result.text).not.toContain("ENOENT");
  });

  it("fails outside varlock run", () => {
    const result = run(schema);

    expect(result.status).toBe(1);
    expect(result.text).toContain("__VARLOCK_ENV is not set");
  });
});
