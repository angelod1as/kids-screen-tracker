import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import type { StoredAccount } from "../../auth/accounts";
import { LOGIN_FAILED_MESSAGE } from "../../auth/credentials";
import { hashPassword } from "../../auth/password-hash";
import { EMPTY_LOGIN_STATE } from "./login-state";
import { loginAction, logoutAction } from "./session";

/**
 * The login and logout endpoints (#12), and the criterion that has to be tested
 * on purpose because nothing else would notice it: **no password appears in a
 * log, a response or an error message**.
 *
 * A password does not leak because someone printed it. It leaks because
 * someone printed *the input that failed*, which is the natural thing to print,
 * and because a returned error object carries more than the message it was
 * built for. So every password used below is a distinctive marker string, and
 * every value that leaves the action is searched for it.
 *
 * The four passwords are invented, and their hashes are made here (D23, D45).
 */

const PASSWORD_MARKER = "zzMARKERzz-kid1-password-9f13";
const ADMIN_MARKER = "zzMARKERzz-admin1-password-4c07";
/** Kid2's, with a space at each end, on purpose — see "a password is taken as typed". */
const SPACED_MARKER = "  zzMARKERzz-kid2-password-77de  ";

const mocked = vi.hoisted(() => ({
  started: [] as string[],
  ended: 0,
  deactivated: new Set<string>(),
  accounts: new Map<string, StoredAccount>(),
}));

/**
 * `../../auth/guard` is the module that opens the database. Replacing it is how
 * a case says "this person's row is `active = false`" without a SQLite file;
 * that the guard reads the row correctly is `guard.test.ts`'s job, against a
 * real migrated and seeded database.
 */
vi.mock("../../auth/guard", () => ({
  findLoginAccount: (username: string) =>
    mocked.deactivated.has(username)
      ? undefined
      : mocked.accounts.get(username),
}));

vi.mock("../../auth/env", () => ({
  sessionSecret: () => "test-session-secret",
}));

beforeAll(async () => {
  const passwords: [string, "admin" | "kid", string][] = [
    ["admin1", "admin", ADMIN_MARKER],
    ["admin2", "admin", "zzMARKERzz-admin2-password-2ba8"],
    ["kid1", "kid", PASSWORD_MARKER],
    ["kid2", "kid", SPACED_MARKER],
  ];
  for (const [username, role, password] of passwords) {
    mocked.accounts.set(username, {
      username,
      role,
      passwordHash: await hashPassword(password),
    });
  }
});

vi.mock("../../auth/session", () => ({
  SESSION_COOKIE_NAME: "kst_session",
  readSessionUsername: async () => null,
  startSession: async (username: string) => {
    mocked.started.push(username);
  },
  endSession: async () => {
    mocked.ended += 1;
  },
}));

/**
 * `redirect` throws a control-flow error inside Next. Replacing it with a
 * throw of our own keeps that shape — the code after it must not run — while
 * making the destination readable.
 */
class Redirected extends Error {
  constructor(readonly to: string) {
    super(`redirect:${to}`);
  }
}

vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Redirected(to);
  },
}));

/** A `console.error` named in a comment is prose, not a call. */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|\s)\/\/.*$/gm, "$1");
}

function form(username: string, password: string): FormData {
  const data = new FormData();
  data.set("username", username);
  data.set("password", password);

  return data;
}

/** Runs `loginAction`, returning either the state or the redirect it threw. */
async function login(
  username: string,
  password: string,
): Promise<{ state?: { error: string | null }; to?: string }> {
  try {
    return {
      state: await loginAction(EMPTY_LOGIN_STATE, form(username, password)),
    };
  } catch (thrown) {
    if (thrown instanceof Redirected) {
      return { to: thrown.to };
    }

    throw thrown;
  }
}

const CONSOLE_METHODS = [
  "log",
  "info",
  "warn",
  "error",
  "debug",
  "trace",
] as const;
const spies: ReturnType<typeof vi.spyOn>[] = [];

beforeEach(() => {
  mocked.started = [];
  mocked.ended = 0;
  mocked.deactivated = new Set();

  for (const method of CONSOLE_METHODS) {
    spies.push(vi.spyOn(console, method).mockImplementation(() => undefined));
  }
});

afterEach(() => {
  for (const spy of spies.splice(0)) {
    spy.mockRestore();
  }
});

describe("a login that works", () => {
  it("starts a session and sends a kid to his own home", async () => {
    const result = await login("kid1", PASSWORD_MARKER);

    expect(result.to).toBe("/menino");
    expect(mocked.started).toEqual(["kid1"]);
  });

  it("sends an admin to the admin home", async () => {
    const result = await login("admin1", ADMIN_MARKER);

    expect(result.to).toBe("/admin");
    expect(mocked.started).toEqual(["admin1"]);
  });

  it("accepts the capitalisation a phone keyboard produces", async () => {
    const result = await login("Kid1", PASSWORD_MARKER);

    expect(result.to).toBe("/menino");
    // The session is opened under the stored username, not the typed one.
    expect(mocked.started).toEqual(["kid1"]);
  });
});

describe("a login that fails", () => {
  it("says the same thing for a wrong password and an unknown user", async () => {
    const wrongPassword = await login("kid1", "not-the-password");
    const unknownUser = await login("mallory", "not-the-password");

    expect(wrongPassword.state).toEqual({ error: LOGIN_FAILED_MESSAGE });
    expect(unknownUser.state).toEqual(wrongPassword.state);
  });

  it("does not reveal whether the username exists", async () => {
    const { state } = await login("mallory", "whatever");

    expect(state?.error).toBe("Usuário ou senha incorretos.");
  });

  it("does not accept another account's password", async () => {
    const { state, to } = await login("kid1", ADMIN_MARKER);

    expect(to).toBeUndefined();
    expect(state).toEqual({ error: LOGIN_FAILED_MESSAGE });
  });

  it("starts no session", async () => {
    await login("kid1", "not-the-password");
    await login("mallory", "not-the-password");

    expect(mocked.started).toEqual([]);
  });
});

describe("no password reaches a response, a log or an error", () => {
  it("keeps the wrong password out of the state it returns", async () => {
    const { state } = await login(
      "kid1",
      PASSWORD_MARKER.replace("9f13", "0000"),
    );

    // The whole object, not just the message: this value is serialised into
    // the page, so every field of it is a field the browser receives.
    expect(JSON.stringify(state)).not.toContain("zzMARKERzz");
  });

  it("keeps the right password out of the state it returns", async () => {
    const result = await login("kid1", PASSWORD_MARKER);

    expect(JSON.stringify(result)).not.toContain("zzMARKERzz");
  });

  it("returns a state with one field, and that field is the message", async () => {
    const { state } = await login("kid1", "not-the-password");

    expect(Object.keys(state ?? {})).toEqual(["error"]);
  });

  it("keeps the username out of the message as well", async () => {
    const { state } = await login("kid1", "not-the-password");

    expect(state?.error).not.toContain("kid1");
  });

  it("writes nothing to the console, on success or on failure", async () => {
    await login("kid1", PASSWORD_MARKER);
    await login("kid1", "not-the-password");
    await login("mallory", PASSWORD_MARKER);

    for (const spy of spies) {
      expect(spy).not.toHaveBeenCalled();
    }
  });
});

describe("a deactivated account cannot log in (D14)", () => {
  // Nothing is deleted from this database, so `active = false` is how a person
  // stops being one. Before this, the right password still authenticated: the
  // cookie was written and the redirect issued, and the first screen bounced
  // them back with no message.
  it("is refused, with the same message as every other failure", async () => {
    mocked.deactivated.add("kid1");

    const { state, to } = await login("kid1", PASSWORD_MARKER);

    expect(to).toBeUndefined();
    expect(state).toEqual({ error: LOGIN_FAILED_MESSAGE });
  });

  it("gets no cookie", async () => {
    mocked.deactivated.add("kid1");

    await login("kid1", PASSWORD_MARKER);

    expect(mocked.started).toEqual([]);
  });

  it("leaves everybody else logging in", async () => {
    mocked.deactivated.add("kid1");

    const result = await login("admin1", ADMIN_MARKER);

    expect(result.to).toBe("/admin");
  });
});

describe("a password is taken as typed", () => {
  // `.trim()` on the password was a mutation nothing caught, and it is the
  // worst kind: a password with a space at either end silently stops being the
  // password, with no message and nothing in a log. `.env` is edited by hand,
  // and a trailing space in a hand-edited file is not exotic.
  it("accepts a password whose spaces are part of it", async () => {
    const result = await login("kid2", SPACED_MARKER);

    expect(result.to).toBe("/menino");
    expect(mocked.started).toEqual(["kid2"]);
  });

  it("refuses the same password with its spaces removed", async () => {
    const { state, to } = await login("kid2", SPACED_MARKER.trim());

    expect(to).toBeUndefined();
    expect(state).toEqual({ error: LOGIN_FAILED_MESSAGE });
    expect(mocked.started).toEqual([]);
  });

  it("still trims the username, which is not a secret", async () => {
    // The username is normalised on purpose: a phone keyboard adds a capital,
    // and a long-press paste adds a space. Neither is true of the password box.
    const result = await login("  Kid2  ", SPACED_MARKER);

    expect(result.to).toBe("/menino");
    expect(mocked.started).toEqual(["kid2"]);
  });
});

describe("logout", () => {
  it("ends the session and returns to the login screen", async () => {
    let thrown: unknown;
    try {
      await logoutAction();
    } catch (error) {
      thrown = error;
    }

    expect(mocked.ended).toBe(1);
    expect(thrown).toBeInstanceOf(Redirected);
    expect((thrown as Redirected).to).toBe("/entrar");
  });
});

describe("nothing under src/ prints anything", () => {
  it("has no console call outside the tests", () => {
    // The structural half of "nenhuma senha aparece em log". The behavioural
    // half above proves the login path is quiet today; this proves nobody
    // reached for `console.log` while debugging it and left the line in.
    //
    // The two CLI scripts under `scripts/` do print, on purpose, and are not
    // part of the running app.
    const src = join(import.meta.dirname, "..", "..");
    const offenders = readdirSync(src, { recursive: true, withFileTypes: true })
      .filter(
        (entry) =>
          entry.isFile() &&
          /\.tsx?$/.test(entry.name) &&
          !/\.test\.tsx?$/.test(entry.name),
      )
      .map((entry) => join(entry.parentPath, entry.name))
      .filter((file) =>
        /\bconsole\s*\./.test(stripComments(readFileSync(file, "utf8"))),
      );

    expect(offenders).toEqual([]);
  });
});
