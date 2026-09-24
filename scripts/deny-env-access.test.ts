import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * The hook is the only thing that enforces D23 — an instruction in CLAUDE.md is
 * advice, this is the fence. It had no test until a review pointed out that the
 * eleven cases proving it worked lived in a pull request description, where no
 * future edit can run into them.
 *
 * A previous version resolved `~/.env` to the absolute path `/.env`, found
 * nothing there, and let a read of the owner's real file through. Every case
 * below that looked safe by eye and was not is kept here on purpose.
 */

const HOOK = join(
  import.meta.dirname,
  "..",
  ".claude",
  "hooks",
  "deny-env-access.sh",
);

const BLOCKED = 2;
const ALLOWED = 0;

/** Runs the hook the way Claude Code does: JSON on stdin, meaning in the exit code. */
function run(command: string, cwd: string, payload?: string): number {
  const stdin =
    payload ??
    JSON.stringify({ tool_name: "Bash", tool_input: { command }, cwd });
  try {
    execFileSync(HOOK, { input: stdin, stdio: ["pipe", "ignore", "ignore"] });
    return ALLOWED;
  } catch (error) {
    return (error as { status?: number }).status ?? -1;
  }
}

/** A worktree that already holds a filled-in .env, like `wt/main` does. */
let withEnv: string;
/** A fresh worktree with no .env, like every worktree an agent is handed. */
let withoutEnv: string;

beforeAll(() => {
  withEnv = mkdtempSync(join(tmpdir(), "kst-hook-with-"));
  withoutEnv = mkdtempSync(join(tmpdir(), "kst-hook-without-"));
  writeFileSync(join(withEnv, ".env"), "SESSION_SECRET=not-a-real-secret\n");
  writeFileSync(join(withEnv, ".env.schema"), "SESSION_SECRET=\n");
  writeFileSync(join(withoutEnv, ".env.schema"), "SESSION_SECRET=\n");
});

afterAll(() => {
  rmSync(withEnv, { recursive: true, force: true });
  rmSync(withoutEnv, { recursive: true, force: true });
});

describe("a .env that exists is the owner's", () => {
  it.each([
    ["reads it", "head -n 5 .env"],
    ["reads it through a pipe", "grep . .env | sort"],
    ["copies it out", "cp .env /tmp/stolen"],
    ["overwrites it", "printf 'A=1\\n' > .env"],
    ["deletes it", "rm .env"],
    ["reads it by absolute path", "cat {DIR}/.env"],
    // Quoting a path is the ordinary way to write shell, and it was the second
    // bypass to ship: the token ended in a quote, so it matched none of the
    // classification patterns and was skipped before any rule could see it.
    ["reads it single-quoted", "cat '.env'"],
    ["reads it double-quoted", 'cat ".env"'],
    ["deletes it quoted", "rm '.env'"],
    ["overwrites it quoted", "printf 'A=1\\n' > \"./.env\""],
    ["reads it quoted by absolute path", "cat '{DIR}/.env'"],
  ])("refuses a command that %s", (_label, template) => {
    expect(run(template.replace("{DIR}", withEnv), withEnv)).toBe(BLOCKED);
  });

  it("refuses a relative path reaching into another worktree", () => {
    expect(run(`cat ${withEnv}/.env`, withoutEnv)).toBe(BLOCKED);
  });
});

describe("a path the shell expands and the hook does not", () => {
  // The bypass that shipped and had to be fixed: the tilde was not part of the
  // captured path, so `~/.env` resolved to `/.env`, which does not exist, and
  // the command was allowed while the shell read the real file.
  it.each([
    ["a tilde", "cat ~/.env"],
    ["a bare variable", "cat $HOME/.env"],
    // The braces are the point of this case: it is a shell variable inside a
    // command string, not a JS template literal.
    // biome-ignore lint/suspicious/noTemplateCurlyInString: shell syntax under test
    ["a braced variable", "cat ${HOME}/.env"],
    ["a command substitution", "cat `pwd`/.env"],
    ["a modern command substitution", "cat $(pwd)/.env"],
    ["a glob", "cat ../*/.env"],
    ["a quoted variable", 'cat "$HOME/.env"'],
    ["a quoted tilde path", 'cat "~/.env"'],
  ])(
    "refuses %s, because it cannot tell which file that is",
    (_label, command) => {
      expect(run(command, withoutEnv)).toBe(BLOCKED);
    },
  );
});

describe("a payload that cannot be parsed", () => {
  it("refuses when it still mentions a .env", () => {
    // `\$` is not a valid JSON escape, so jq gives up. Extracting nothing and
    // allowing the call would turn a parse error into a way through.
    const malformed =
      '{"tool_name":"Bash","tool_input":{"command":"cat \\$HOME/.env"},"cwd":"/tmp"}';
    expect(run("", withoutEnv, malformed)).toBe(BLOCKED);
  });

  it("allows a malformed payload that mentions no .env at all", () => {
    expect(
      run("", withoutEnv, '{"tool_input":{"command":"pnpm \\$build"}}'),
    ).toBe(ALLOWED);
  });
});

describe("a .env that does not exist has nothing to leak", () => {
  it.each([
    ["writes the throwaway CI writes", "printf 'A=1\\n' > .env"],
    ["writes it with a heredoc", "cat > .env <<'EOF'\nA=1\nEOF"],
    ["builds", "pnpm build"],
    ["seeds", "pnpm db:seed"],
  ])("allows a command that %s", (_label, command) => {
    expect(run(command, withoutEnv)).toBe(ALLOWED);
  });

  it("stops allowing reads the moment the throwaway exists", () => {
    const dir = mkdtempSync(join(tmpdir(), "kst-hook-fresh-"));
    try {
      expect(run("printf 'A=1\\n' > .env", dir)).toBe(ALLOWED);
      writeFileSync(join(dir, ".env"), "A=1\n");
      expect(run("head .env", dir)).toBe(BLOCKED);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("the schema is versioned and stays readable", () => {
  it.each([
    ["reads it where a .env also exists", "cat .env.schema"],
    ["reads it by relative path", "cat ./.env.schema"],
  ])("allows a command that %s", (_label, command) => {
    expect(run(command, withEnv)).toBe(ALLOWED);
  });
});

describe("varlock subcommands that print resolved values", () => {
  it.each([
    ["reveal", "varlock reveal"],
    ["reveal through pnpm dlx", "pnpm dlx varlock reveal"],
    ["load", "npx varlock load"],
  ])("refuses %s", (_label, command) => {
    expect(run(command, withoutEnv)).toBe(BLOCKED);
  });

  it("allows varlock run, which launches instead of dumping", () => {
    expect(run("varlock run -- pnpm dev", withoutEnv)).toBe(ALLOWED);
  });
});
