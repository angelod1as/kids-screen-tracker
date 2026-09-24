import { defineConfig } from "drizzle-kit";

/**
 * Only for `drizzle-kit generate`: the SQL is committed and applied at runtime
 * by `scripts/db-migrate.ts`, which is why `tsx` is a dependency and not a
 * devDependency (the container installs `--prod`).
 */
export default defineConfig({
  dialect: "sqlite",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
});
