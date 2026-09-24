import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { MAX_PASSWORD_LENGTH } from "../src/auth/credentials";
import { verifyPassword } from "../src/auth/password-hash";

// D45: the only way a password reaches `users`. Piped stdin only; the TTY
// prompt needs a real terminal.

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const tsx = join(root, "node_modules", ".bin", "tsx");

function run(input: string) {
  return spawnSync(tsx, ["scripts/hash-password.ts"], {
    cwd: root,
    input,
    encoding: "utf8",
  });
}

describe("pnpm auth:hash", () => {
  it("rejects an empty password", () => {
    const result = run("");

    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("de 1 a 256 caracteres");
  });

  it("rejects a password one character over the limit", () => {
    const result = run("a".repeat(MAX_PASSWORD_LENGTH + 1));

    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
  });

  it("prints a hash of a password at the limit that verifies", async () => {
    const password = "a".repeat(MAX_PASSWORD_LENGTH);
    const result = run(password);

    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/^scrypt\$16384\$8\$5\$[\w-]+\$[\w-]+\n$/);
    expect(await verifyPassword(password, result.stdout.trim())).toBe(true);
  });

  it("drops exactly one trailing newline", async () => {
    const result = run("abc \n\n");

    expect(result.status).toBe(0);
    expect(await verifyPassword("abc \n", result.stdout.trim())).toBe(true);
  });
});
