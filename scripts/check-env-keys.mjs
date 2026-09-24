// #4, D40: a key the env file sets but `.env.schema` does not declare still
// becomes an item under `@defaultSensitive=true`, and a short value then matches
// ordinary text in a client chunk and fails `next build` as a leak. Names only.

import { readFileSync } from "node:fs";

function fail(message) {
  console.error(`check-env-keys: ERROR: ${message}`);
  process.exit(1);
}

if (!process.env.__VARLOCK_ENV) {
  fail(
    "__VARLOCK_ENV is not set — run this through `varlock run`, which is what `pnpm build` does.",
  );
}

let schema;
try {
  schema = readFileSync(".env.schema", "utf8");
} catch {
  fail("no .env.schema — nothing to compare against.");
}

const declared = new Set(
  schema
    .split("\n")
    .map((line) => line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=/)?.[1])
    .filter(Boolean),
);

// A guard with nothing to compare against must fail.
if (declared.size === 0) {
  fail("no item declared in .env.schema — nothing to compare against.");
}

const graph = JSON.parse(process.env.__VARLOCK_ENV);
const undeclared = Object.keys(graph.config ?? {}).filter(
  (name) => !declared.has(name),
);

if (undeclared.length > 0) {
  for (const name of undeclared) {
    console.error(
      `check-env-keys: ${name} is set but not declared in .env.schema`,
    );
  }
  fail(
    `delete ${undeclared.length === 1 ? "that line" : "those lines"} from .env, or declare the item in .env.schema.`,
  );
}

console.log(
  `check-env-keys: ok — all ${Object.keys(graph.config ?? {}).length} resolved item(s) are declared in .env.schema`,
);
