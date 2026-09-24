import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

// #60 (D40). The two scripts that keep the resolved environment out of .next
// are the whole enforcement, and both decide by matching text written by a
// third-party tool. These run them against synthetic .next trees — no build,
// no varlock, no Docker — so a guard that stops guarding fails here.

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const stripScript = join(scriptsDir, "strip-build-env.mjs");
const checkScript = join(scriptsDir, "check-build-secrets.mjs");

const SECRET = "fixture-session-secret-3b9d";
const PASSWORD = "fixture-password-8c1e";

// The graph `varlock run` hands the child in __VARLOCK_ENV, trimmed to the
// fields the check reads.
const graph = {
  config: {
    DATABASE_PATH: { value: "./data/fixture.db", isSensitive: true },
    SESSION_SECRET: { value: SECRET, isSensitive: true },
    AUTH_KID2: { value: PASSWORD, isSensitive: true },
    PUBLIC_THING: { value: "not-sensitive-7a2f", isSensitive: false },
  },
};
const rawGraph = JSON.stringify(graph);

const injectedLine = `process.env.__VARLOCK_ENV = process.env.__VARLOCK_ENV || ${JSON.stringify(rawGraph)};`;
const varlockInit =
  "(function(exports,module){if(process.env.__VARLOCK_ENV){process.env.__VARLOCK_ENV = decrypt(process.env.__VARLOCK_ENV)}})({},{exports:{}});";
const runtimeBody = "module.exports = function turbopackRuntime() {};\n";

const runtimePath = ".next/server/chunks/ssr/[turbopack]_runtime.js";
const standaloneRuntimePath =
  ".next/standalone/.next/server/chunks/ssr/[turbopack]_runtime.js";

const fixtures: string[] = [];

function makeFixture(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "build-secrets-"));
  fixtures.push(root);
  for (const [relative, contents] of Object.entries(files)) {
    const target = join(root, relative);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, contents);
  }
  return root;
}

function run(script: string, root: string, env: Record<string, string> = {}) {
  const { __VARLOCK_ENV: _ignored, ...parentEnv } = process.env;
  return spawnSync(process.execPath, [script], {
    cwd: root,
    encoding: "utf8",
    env: { ...parentEnv, ...env },
  });
}

function output(result: ReturnType<typeof run>): string {
  return `${result.stdout}${result.stderr}`;
}

afterEach(() => {
  for (const root of fixtures.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("strip-build-env", () => {
  it("removes the injected line and the copied env file, and keeps the rest", () => {
    const root = makeFixture({
      [runtimePath]: `${injectedLine}\n${varlockInit}\n${runtimeBody}`,
      [standaloneRuntimePath]: `${injectedLine}\n${varlockInit}\n${runtimeBody}`,
      ".next/standalone/.env": `SESSION_SECRET=${SECRET}\n`,
    });

    const result = run(stripScript, root);

    expect(result.status, output(result)).toBe(0);
    for (const file of [runtimePath, standaloneRuntimePath]) {
      const contents = readFileSync(join(root, file), "utf8");
      expect(contents).not.toContain(SECRET);
      expect(contents).toBe(`${varlockInit}\n${runtimeBody}`);
    }
    expect(existsSync(join(root, ".next/standalone/.env"))).toBe(false);
  });

  it("removes every copy of the line in a file, not only the first", () => {
    const root = makeFixture({
      [runtimePath]: `${injectedLine}\n${varlockInit}\n${injectedLine}\n${runtimeBody}`,
    });

    const result = run(stripScript, root);

    expect(result.status, output(result)).toBe(0);
    expect(output(result)).toContain("removed 2 inlined environment line(s)");
    const contents = readFileSync(join(root, runtimePath), "utf8");
    expect(contents).not.toContain(SECRET);
    expect(contents).not.toContain("__VARLOCK_ENV ||");
  });

  it("fails loudly when the injected format drifts away from what it removes", () => {
    const drifted = `process.env.__VARLOCK_ENV ??= ${JSON.stringify(rawGraph)};`;
    const root = makeFixture({
      [runtimePath]: `${drifted}\n${varlockInit}\n${runtimeBody}`,
    });

    const result = run(stripScript, root);

    expect(result.status).toBe(1);
    expect(output(result)).toContain(
      "still assigns a literal to __VARLOCK_ENV",
    );
    expect(output(result)).not.toContain(SECRET);
  });

  it("fails when there is no runtime file to vouch for", () => {
    const root = makeFixture({ ".next/server/app/page.js": runtimeBody });

    const result = run(stripScript, root);

    expect(result.status).toBe(1);
    expect(output(result)).toContain("no [turbopack]_runtime.js");
  });

  it("is idempotent on an already stripped build", () => {
    const root = makeFixture({
      [runtimePath]: `${varlockInit}\n${runtimeBody}`,
    });

    const result = run(stripScript, root);

    expect(result.status, output(result)).toBe(0);
    expect(output(result)).toContain("removed 0 inlined environment line(s)");
  });
});

describe("check-build-secrets", () => {
  it("fails on a leak and names the file and the item, never the value", () => {
    const root = makeFixture({
      [runtimePath]: `${injectedLine}\n${runtimeBody}`,
      ".next/static/chunks/app.js": `var x = ${JSON.stringify(PASSWORD)};\n`,
    });

    const result = run(checkScript, root, { __VARLOCK_ENV: rawGraph });

    expect(result.status).toBe(1);
    const text = output(result);
    expect(text).toContain(
      `LEAK: ${runtimePath} contains the value of SESSION_SECRET`,
    );
    expect(text).toContain(
      "LEAK: .next/static/chunks/app.js contains the value of AUTH_KID2",
    );
    expect(text).not.toContain(SECRET);
    expect(text).not.toContain(PASSWORD);
  });

  it("does not report an item that is not sensitive", () => {
    const root = makeFixture({
      ".next/static/chunks/app.js": "var x = 'not-sensitive-7a2f';\n",
    });

    const result = run(checkScript, root, { __VARLOCK_ENV: rawGraph });

    expect(result.status, output(result)).toBe(0);
  });

  it("passes on a clean .next", () => {
    const root = makeFixture({
      [runtimePath]: `${varlockInit}\n${runtimeBody}`,
    });

    const result = run(checkScript, root, { __VARLOCK_ENV: rawGraph });

    expect(result.status, output(result)).toBe(0);
    expect(result.stdout).toContain("none of the 3 @sensitive values");
  });

  it("passes on what the strip leaves behind", () => {
    const root = makeFixture({
      [runtimePath]: `${injectedLine}\n${varlockInit}\n${runtimeBody}`,
      ".next/standalone/.env": `AUTH_KID2=${PASSWORD}\n`,
    });

    expect(run(checkScript, root, { __VARLOCK_ENV: rawGraph }).status).toBe(1);
    expect(run(stripScript, root).status).toBe(0);
    const result = run(checkScript, root, { __VARLOCK_ENV: rawGraph });
    expect(result.status, output(result)).toBe(0);
  });

  it("fails on a .next that exists but holds no files", () => {
    const root = makeFixture({});
    mkdirSync(join(root, ".next/server"), { recursive: true });

    const result = run(checkScript, root, { __VARLOCK_ENV: rawGraph });

    expect(result.status).toBe(1);
    expect(output(result)).toContain("holds no files");
  });

  it("fails when there is no .next", () => {
    const root = makeFixture({});

    const result = run(checkScript, root, { __VARLOCK_ENV: rawGraph });

    expect(result.status).toBe(1);
    expect(output(result)).toContain("no .next directory");
  });

  it("fails when no sensitive item was resolved", () => {
    const root = makeFixture({ [runtimePath]: runtimeBody });

    const result = run(checkScript, root, {
      __VARLOCK_ENV: JSON.stringify({
        config: { PUBLIC_THING: { value: "x", isSensitive: false } },
      }),
    });

    expect(result.status).toBe(1);
    expect(output(result)).toContain("nothing to check");
  });

  it("fails outside varlock run", () => {
    const root = makeFixture({ [runtimePath]: runtimeBody });

    const result = run(checkScript, root);

    expect(result.status).toBe(1);
    expect(output(result)).toContain("__VARLOCK_ENV is not set");
  });
});
