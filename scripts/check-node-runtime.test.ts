import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

// Biome does not read shell scripts, so nothing else in the pipeline notices
// if this guard stops guarding: swap `exit "$status"` for `exit 0` and an edge
// route walks through lint, typecheck, test and build untouched. The guard the
// issue asked for needs a guard of its own, and this is it.

const guardPath = join(
  dirname(fileURLToPath(import.meta.url)),
  "check-node-runtime.sh",
);

// The guard scans the whole repository, this file included. Assembling the
// forbidden declarations instead of spelling them out keeps these fixtures from
// tripping the very check they exercise, without narrowing the scan.
const EDGE = JSON.stringify("edge");

const edgeRoute = `export const runtime = ${EDGE};\n`;
const edgeRouteSplitAcrossLines = `export const runtime =\n  ${EDGE};\n`;
const edgeConfig = `const nextConfig = { runtime: ${EDGE} };\nexport default nextConfig;\n`;
const commentMentioningEdge = `const a = 1; // do not set runtime = ${EDGE} here\n`;
const nodeLayout = 'export const runtime = "nodejs";\n';

const fixtures: string[] = [];

/**
 * Builds a throwaway repository around a copy of the real script. The script
 * derives its scan root from its own location, so a copy under `scripts/`
 * scans the fixture and nothing else.
 *
 * `bare` skips the default `next.config.ts` + `src/app/layout.tsx` scaffold,
 * for the cases that need a different repository shape — or none at all.
 */
function makeFixture(
  files: Record<string, string> = {},
  options: { bare?: boolean } = {},
): string {
  const root = mkdtempSync(join(tmpdir(), "runtime-guard-"));
  fixtures.push(root);

  const scaffold: Record<string, string> = options.bare
    ? {}
    : {
        "next.config.ts": "export default {};\n",
        "src/app/layout.tsx": nodeLayout,
      };

  for (const [relative, contents] of Object.entries({
    ...scaffold,
    ...files,
  })) {
    const target = join(root, relative);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, contents);
  }

  const guardCopy = join(root, "scripts", "check-node-runtime.sh");
  mkdirSync(dirname(guardCopy), { recursive: true });
  copyFileSync(guardPath, guardCopy);
  chmodSync(guardCopy, 0o755);

  return root;
}

function runGuard(root: string) {
  return spawnSync("bash", [join(root, "scripts", "check-node-runtime.sh")], {
    encoding: "utf8",
  });
}

afterEach(() => {
  for (const root of fixtures.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("check-node-runtime.sh (D22)", () => {
  it("rejects a route that opts into the edge runtime", () => {
    const root = makeFixture({ "src/app/probe/route.ts": edgeRoute });

    const result = runGuard(root);

    expect(result.stdout).toContain("the edge runtime is forbidden");
    expect(result.status).toBe(1);
  });

  it("rejects an edge route under app/ at the repository root", () => {
    // Next also reads `app/` at the root and *prefers* it over `src/app/`, so
    // a route parked there inherits nothing from the root layout. A guard
    // aimed only at `src` would let it reach production with CI green.
    const root = makeFixture(
      {
        "next.config.ts": "export default {};\n",
        "app/layout.tsx": nodeLayout,
        "app/probe/route.ts": edgeRoute,
      },
      { bare: true },
    );

    const result = runGuard(root);

    expect(result.stdout).toContain("app/probe/route.ts");
    expect(result.status).toBe(1);
  });

  it("rejects an edge declaration in a next.config with another extension", () => {
    const root = makeFixture(
      {
        "next.config.mjs": edgeConfig,
        "src/app/layout.tsx": nodeLayout,
      },
      { bare: true },
    );

    const result = runGuard(root);

    expect(result.stdout).toContain("next.config.mjs");
    expect(result.status).toBe(1);
  });

  it("rejects a declaration split across two lines", () => {
    // Line-anchored matching missed this one; the formatter caught it by
    // accident, and only while lint runs before the guard.
    const root = makeFixture({
      "src/app/probe/route.ts": edgeRouteSplitAcrossLines,
    });

    const result = runGuard(root);

    expect(result.stdout).toContain("the edge runtime is forbidden");
    expect(result.status).toBe(1);
  });

  it("does not trip on a trailing comment mentioning the edge runtime", () => {
    const root = makeFixture({ "src/lib/probe.ts": commentMentioningEdge });

    const result = runGuard(root);

    expect(result.stdout).toContain("OK: the root layout declares");
    expect(result.status).toBe(0);
  });

  it("rejects a root layout that does not declare the Node runtime", () => {
    // The guard only ever looked for the word it forbids. Deleting the
    // declaration from the root layout put every route back on the framework
    // default with lint, typecheck, the whole suite and this script green.
    const root = makeFixture(
      {
        "next.config.ts": "export default {};\n",
        "src/app/layout.tsx": "export default function Layout() {}\n",
      },
      { bare: true },
    );

    const result = runGuard(root);

    expect(result.stdout).toContain("does not declare the Node runtime");
    expect(result.status).toBe(1);
  });

  it("rejects a repository with no root layout at all", () => {
    const root = makeFixture(
      { "next.config.ts": "export default {};\n", "src/app/page.tsx": "" },
      { bare: true },
    );

    const result = runGuard(root);

    expect(result.stdout).toContain("no root layout found");
    expect(result.status).toBe(1);
  });

  it("fails when there is nothing to scan", () => {
    // A missing scan target and a clean tree used to print the same "OK",
    // because the grep swallowed its own "no such file".
    const root = makeFixture({}, { bare: true });

    const result = runGuard(root);

    expect(result.stdout).toContain("nothing to scan");
    expect(result.status).toBe(1);
  });

  it("accepts a tree that declares no edge runtime", () => {
    const root = makeFixture();

    const result = runGuard(root);

    expect(result.stdout).toContain("OK: the root layout declares");
    expect(result.status).toBe(0);
  });
});
