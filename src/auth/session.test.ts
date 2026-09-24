import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SESSION_TTL_MS } from "./token";

/**
 * The cookie itself: how it is written, what it carries, and what logout does
 * to it (#12).
 *
 * `next/headers` is replaced by a jar that records what was set, because that
 * is the only way to see the *attributes* — `httpOnly`, `sameSite`, `secure`,
 * `maxAge`. Those are the whole security value of the cookie and none of them
 * is visible in any return value, so nothing else in the suite would notice
 * them being dropped.
 *
 * `./env` is replaced because it is the module that reads Varlock. The secret
 * below is invented (D23).
 */

type Recorded = {
  value: string;
  options: {
    httpOnly?: boolean;
    sameSite?: string;
    secure?: boolean;
    path?: string;
    maxAge?: number;
  };
};

const jar = vi.hoisted(() => new Map<string, Recorded>());

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => {
      const entry = jar.get(name);

      return entry === undefined ? undefined : { name, value: entry.value };
    },
    set: (name: string, value: string, options: Recorded["options"]) => {
      jar.set(name, { value, options });
    },
    delete: (name: string) => {
      jar.delete(name);
    },
  }),
}));

vi.mock("./env", () => ({
  sessionSecret: () => "test-session-secret-not-the-real-one",
}));

const {
  DEVICE_COOKIE_NAME,
  SESSION_COOKIE_NAME,
  endSession,
  readDeviceUsername,
  readSessionUsername,
  rememberDevice,
  startSession,
} = await import("./session");

function written(): Recorded {
  const entry = jar.get(SESSION_COOKIE_NAME);
  if (entry === undefined) {
    throw new Error("no session cookie was written");
  }

  return entry;
}

beforeEach(() => {
  jar.clear();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("the cookie's name", () => {
  it("is `kst_session`", () => {
    // A choice the PR body declares, and one nothing held: renaming it left
    // 459 tests green, because every test that mentions the name mocks this
    // module and writes the string out itself. A rename would take the whole
    // suite with it and log everybody out on deploy, silently.
    expect(SESSION_COOKIE_NAME).toBe("kst_session");
  });

  it("is not a name half the internet uses", () => {
    // Deliberately not `session`: a name shared with another app on the same
    // host during development is a cookie that collides.
    expect(SESSION_COOKIE_NAME).not.toBe("session");
  });
});

describe("the cookie a login writes (#12)", () => {
  it("is httpOnly, so no script can read it", async () => {
    await startSession("kid1");

    expect(written().options.httpOnly).toBe(true);
  });

  it("is sameSite lax, so it is not sent on a cross-site POST", async () => {
    // Every mutation in this app is a server action, and a server action is a
    // POST. `strict` would additionally drop the cookie when the boy follows a
    // link to the app from WhatsApp, which is a real cost for no gain here.
    await startSession("kid1");

    expect(written().options.sameSite).toBe("lax");
  });

  it("lasts 30 days", async () => {
    await startSession("kid1");

    expect(written().options.maxAge).toBe(SESSION_TTL_MS / 1000);
    expect(written().options.maxAge).toBe(30 * 24 * 60 * 60);
  });

  it("covers the whole app", async () => {
    await startSession("kid1");

    expect(written().options.path).toBe("/");
  });

  it("is secure in production", async () => {
    vi.stubEnv("NODE_ENV", "production");

    await startSession("kid1");

    expect(written().options.secure).toBe(true);
  });

  it("is not secure outside it, so `next dev` over http can log in at all", async () => {
    vi.stubEnv("NODE_ENV", "development");

    await startSession("kid1");

    expect(written().options.secure).toBe(false);
  });
});

describe("what the cookie carries", () => {
  it("is a signed token, not the username in the clear", async () => {
    await startSession("kid1");

    expect(written().value).not.toBe("kid1");
    expect(written().value.split(".")).toHaveLength(2);
  });

  it("carries no password", async () => {
    // Tested on purpose: a cookie is a file on the phone, and a password in one
    // is a password on disk in every browser that ever logged in.
    await startSession("kid1");

    expect(written().value).not.toContain("unused");
  });

  it("reads back as the person who logged in", async () => {
    await startSession("kid2");

    await expect(readSessionUsername()).resolves.toBe("kid2");
  });
});

describe("a cookie that was not written by this app", () => {
  it("reads back as nobody when there is none", async () => {
    await expect(readSessionUsername()).resolves.toBeNull();
  });

  it("reads back as nobody when the value was edited", async () => {
    await startSession("kid1");
    const [payload, signature] = written().value.split(".");
    const forged = Buffer.from(
      JSON.stringify({ username: "admin1", expiresAt: Date.now() + 1000 }),
      "utf8",
    ).toString("base64url");
    jar.set(SESSION_COOKIE_NAME, {
      value: `${forged}.${signature}`,
      options: {},
    });

    expect(payload).not.toBe(forged);
    await expect(readSessionUsername()).resolves.toBeNull();
  });

  it("reads back as nobody when the value is not a token", async () => {
    jar.set(SESSION_COOKIE_NAME, { value: "kid1", options: {} });

    await expect(readSessionUsername()).resolves.toBeNull();
  });
});

describe("logout (#12)", () => {
  it("removes the cookie", async () => {
    await startSession("kid1");
    await endSession();

    expect(jar.has(SESSION_COOKIE_NAME)).toBe(false);
  });

  it("leaves the browser with nothing to present", async () => {
    await startSession("kid1");
    await endSession();

    await expect(readSessionUsername()).resolves.toBeNull();
  });
});

describe("the device cookie (D48)", () => {
  it("is httpOnly, lax, whole-app and lasts a year", async () => {
    await rememberDevice("admin1");

    const entry = jar.get(DEVICE_COOKIE_NAME);
    expect(entry?.options).toMatchObject({
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 365 * 24 * 60 * 60,
    });
  });

  it("reads back as the username it was written for", async () => {
    await rememberDevice("admin1");

    await expect(readDeviceUsername()).resolves.toBe("admin1");
  });

  it("survives logout", async () => {
    await startSession("admin1");
    await rememberDevice("admin1");
    await endSession();

    await expect(readDeviceUsername()).resolves.toBe("admin1");
  });

  it("does not open a session when copied into the session cookie", async () => {
    await rememberDevice("admin1");
    const device = jar.get(DEVICE_COOKIE_NAME)?.value ?? "";
    jar.set(SESSION_COOKIE_NAME, { value: device, options: {} });

    await expect(readSessionUsername()).resolves.toBeNull();
  });

  it("is not minted by copying a session cookie into it", async () => {
    await startSession("admin1");
    jar.set(DEVICE_COOKIE_NAME, { value: written().value, options: {} });

    await expect(readDeviceUsername()).resolves.toBeNull();
  });
});
