import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Widest net: a narrow `include` silently misses real tests. `.next` is
    // kept out by `exclude`.
    include: ["**/*.{test,spec}.?(c|m)[jt]s?(x)"],
    exclude: [...configDefaults.exclude, ".next/**"],
  },
});
