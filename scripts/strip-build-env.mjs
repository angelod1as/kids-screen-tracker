// #60, D40: removes the build environment `next build` leaves in .next in clear
// text: varlock's unused `__VARLOCK_ENV || "<json>"` fallback and the env files
// standalone copies. Fails rather than trusting its own regex.

import {
  existsSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

const nextDir = ".next";
const injected =
  /^process\.env\.__VARLOCK_ENV = process\.env\.__VARLOCK_ENV \|\| "(?:[^"\\\n]|\\.)*";(?:\n|$)/gm;
// Any spelling of a literal assignment; varlock's own init assigns a call.
const residual =
  /__VARLOCK_ENV\s*(?:\|\||\?\?)?=\s*(?:process\.env\.__VARLOCK_ENV\s*(?:\|\||\?\?)\s*)?["'`]/;

function fail(message) {
  console.error(`strip-build-env: ERROR: ${message}`);
  process.exit(1);
}

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(path);
    else if (entry.isFile() && entry.name.endsWith(".js")) yield path;
  }
}

if (!existsSync(nextDir)) {
  fail("no .next directory — run `next build` first.");
}

let runtimeFiles = 0;
let stripped = 0;
const leftovers = [];
for (const file of walk(nextDir)) {
  if (file.endsWith("[turbopack]_runtime.js")) runtimeFiles++;
  const source = readFileSync(file, "utf8");
  const matches = source.match(injected);
  let result = source;
  if (matches) {
    result = source.replace(injected, "");
    writeFileSync(file, result);
    stripped += matches.length;
  }
  if (residual.test(result)) leftovers.push(file);
}

if (runtimeFiles === 0) {
  fail(
    `no [turbopack]_runtime.js under ${nextDir}/ — the files varlock injects into have moved, so this script cannot vouch for the build.`,
  );
}

if (leftovers.length > 0) {
  for (const file of leftovers) {
    console.error(
      `strip-build-env: ${file} still assigns a literal to __VARLOCK_ENV`,
    );
  }
  fail(
    "the injected environment is still in the build — its format no longer matches what this script removes.",
  );
}

let removed = 0;
for (const name of [".env", ".env.production"]) {
  const path = join(nextDir, "standalone", name);
  if (existsSync(path)) {
    rmSync(path);
    removed++;
  }
}

console.log(
  `strip-build-env: removed ${stripped} inlined environment line(s) across ${runtimeFiles} runtime file(s) and ${removed} env file(s) from ${nextDir}/standalone`,
);
