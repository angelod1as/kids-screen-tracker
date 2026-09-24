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
import { FREE_FAILURES, loginThrottle } from "../../auth/login-throttle";
import { hashPassword } from "../../auth/password-hash";
import { EMPTY_LOGIN_STATE } from "./login-state";
import { loginAction, logoutAction } from "./session";

/**
 * No password in a log, response or error: it leaks when someone prints the
 * input that failed. Every password is a marker string searched for in
 * everything that leaves the action. Invented, hashed here (D23, D45).
 */

const PASSWORD_MARKER = "zzMARKERzz-kid1-password-9f13";
const ADMIN_MARKER = "zzMARKERzz-admin1-password-4c07";
/** Kid2's, with a space at each end, on purpose — see "a password is taken as typed". */
const SPACED_MARKER = "  zzMARKERzz-kid2-password-77de  ";

const mocked = vi.hoisted(() => ({
  started: [] as string[],
  ended: 0,
  device: null as string | null,
  remembered: [] as string[],
  deactivated: new Set<string>(),
  accounts: new Map<string, StoredAccount>(),
}));

/** Replaced so a case can say "inactive" without a database; `guard.test.ts` covers the real read. */
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
  readDeviceUsername: async () => mocked.device,
  rememberDevice: async (username: string) => {
    mocked.remembered.push(username);
  },
  startSession: async (username: string) => {
    mocked.started.push(username);
  },
  endSession: async () => {
    mocked.ended += 1;
  },
}));

/** Throws like Next's `redirect`, so code after it must not run, but readably. */
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
  mocked.device = null;
  mocked.remembered = [];
  loginThrottle.clear();

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

    // The whole object: it is serialised into the page.
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
  // Before this, the right password still authenticated a deactivated account.
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
  // `.trim()` on the password went uncaught, and a padded password silently
  // stops matching.
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
    // A phone keyboard adds a capital and a paste adds a space; not so the password.
    const result = await login("  Kid2  ", SPACED_MARKER);

    expect(result.to).toBe("/menino");
    expect(mocked.started).toEqual(["kid2"]);
  });
});

describe("repeated failures delay, they do not lock (D48)", () => {
  async function failTimes(username: string, times: number): Promise<void> {
    for (let i = 0; i < times; i += 1) {
      await login(username, "not-the-password");
    }
  }

  it("refuses the right password, with the usual message, right after the free failures", async () => {
    await failTimes("admin1", FREE_FAILURES);

    const { state, to } = await login("admin1", ADMIN_MARKER);

    expect(to).toBeUndefined();
    expect(state).toEqual({ error: LOGIN_FAILED_MESSAGE });
    expect(mocked.started).toEqual([]);
  });

  it("lets the right password in once the wait is over", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      await failTimes("admin1", FREE_FAILURES);
      vi.setSystemTime(Date.now() + 1000);

      const result = await login("admin1", ADMIN_MARKER);

      expect(result.to).toBe("/admin");
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not delay the owner's own device when a sibling fails on another", async () => {
    await failTimes("admin1", FREE_FAILURES + 3);
    mocked.device = "admin1";

    const result = await login("admin1", ADMIN_MARKER);

    expect(result.to).toBe("/admin");
  });

  it("trusts a device only for the username it logged in as", async () => {
    await failTimes("admin1", FREE_FAILURES);
    mocked.device = "kid1";

    const { to } = await login("admin1", ADMIN_MARKER);

    expect(to).toBeUndefined();
  });

  it("still limits a trusted device, separately", async () => {
    mocked.device = "admin1";
    await failTimes("admin1", FREE_FAILURES);

    const { to } = await login("admin1", ADMIN_MARKER);

    expect(to).toBeUndefined();
  });

  it("delays an unknown username exactly like a real one", async () => {
    await failTimes("mallory", FREE_FAILURES);
    await failTimes("kid1", FREE_FAILURES);

    const unknown = await login("mallory", "whatever");
    const known = await login("kid1", "whatever");

    expect(unknown.state).toEqual({ error: LOGIN_FAILED_MESSAGE });
    expect(known.state).toEqual(unknown.state);
  });

  it("counts a capitalised username as the same one", async () => {
    await failTimes("KID1", FREE_FAILURES);

    const { to } = await login("kid1", PASSWORD_MARKER);

    expect(to).toBeUndefined();
  });

  it("lets only the free failures through when fired in parallel", async () => {
    const results = await Promise.all(
      Array.from({ length: 20 }, () => login("kid1", PASSWORD_MARKER)),
    );

    expect(results.filter((r) => r.to !== undefined)).toHaveLength(
      FREE_FAILURES,
    );
  });

  it("marks the device on a successful login", async () => {
    await login("kid1", PASSWORD_MARKER);

    expect(mocked.remembered).toEqual(["kid1"]);
  });

  it("marks no device on a failed one", async () => {
    await login("kid1", "not-the-password");

    expect(mocked.remembered).toEqual([]);
  });

  it("starts over after a success", async () => {
    await failTimes("kid1", FREE_FAILURES - 1);
    await login("kid1", PASSWORD_MARKER);
    await failTimes("kid1", FREE_FAILURES - 1);

    const { to } = await login("kid1", PASSWORD_MARKER);

    expect(to).toBe("/menino");
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
    // The structural half: nobody left a `console.log` from debugging. The CLI
    // scripts under `scripts/` print on purpose.
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
