// #60, D40: independent proof, on the artifact, that `strip-build-env.mjs`
// worked. Run inside `varlock run` after `pnpm build`; items come from the
// resolved graph, so a new `@sensitive` one is covered. Never prints a value.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const nextDir = ".next";

function fail(message) {
  console.error(`ERROR: ${message}`);
  process.exit(1);
}

if (!process.env.__VARLOCK_ENV) {
  fail(
    "__VARLOCK_ENV is not set — run this through `varlock run`, which is what `pnpm check:secrets` does.",
  );
}

const graph = JSON.parse(process.env.__VARLOCK_ENV);
const sensitive = Object.entries(graph.config ?? {})
  .filter(
    ([, item]) =>
      item.isSensitive && typeof item.value === "string" && item.value !== "",
  )
  .map(([name, item]) => ({ name, value: Buffer.from(item.value) }));

// A guard with nothing to look for, or nowhere to look, must fail.
if (sensitive.length === 0) {
  fail("no @sensitive item with a value was resolved — nothing to check.");
}

let isDir = false;
try {
  isDir = statSync(nextDir).isDirectory();
} catch {}
if (!isDir) {
  fail("no .next directory — run `pnpm build` before `pnpm check:secrets`.");
}

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(path);
    else if (entry.isFile()) yield path;
  }
}

let scanned = 0;
let leaks = 0;
for (const file of walk(nextDir)) {
  scanned++;
  const contents = readFileSync(file);
  for (const { name, value } of sensitive) {
    if (contents.includes(value)) {
      leaks++;
      console.error(`LEAK: ${file} contains the value of ${name}`);
    }
  }
}

// An interrupted build leaves an empty .next.
if (scanned === 0) {
  fail(
    `${nextDir}/ holds no files — nothing to check. Run \`pnpm build\` to completion first.`,
  );
}

if (leaks > 0) {
  fail(
    `${leaks} occurrence(s) of a @sensitive value under ${nextDir}/ (${scanned} files scanned).`,
  );
}

console.log(
  `ok — none of the ${sensitive.length} @sensitive values (${sensitive.map((s) => s.name).join(", ")}) appear in ${scanned} files under ${nextDir}/`,
);
