import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { StoredAccount } from "./accounts";
import type { AccountLookup } from "./credentials";
import {
  LOGIN_FAILED_MESSAGE,
  MAX_PASSWORD_LENGTH,
  verifyCredentials,
} from "./credentials";
import { hashPassword, verifyPassword } from "./password-hash";

/**
 * The spy passes through to the real derivation and only counts calls: two
 * identical `null`s say nothing about the clock, the count does (#12).
 */
vi.mock("./password-hash", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./password-hash")>();

  return { ...actual, verifyPassword: vi.fn(actual.verifyPassword) };
});

const ACCOUNTS: StoredAccount[] = [
  { username: "admin1", role: "admin", passwordHash: null },
  { username: "kid1", role: "kid", passwordHash: null },
  { username: "kid2", role: "kid", passwordHash: null },
];

function lookupIn(accounts: StoredAccount[]): AccountLookup {
  return (username) => accounts.find((a) => a.username === username);
}

const lookup = lookupIn(ACCOUNTS);

beforeAll(async () => {
  for (const account of ACCOUNTS) {
    account.passwordHash = await hashPassword(
      `test-${account.username}-password`,
    );
  }
});

beforeEach(() => {
  vi.mocked(verifyPassword).mockClear();
});

describe("a login that works", () => {
  it("returns the account when the password matches its hash", async () => {
    await expect(
      verifyCredentials("kid1", "test-kid1-password", lookup),
    ).resolves.toEqual({ username: "kid1", role: "kid" });
    await expect(
      verifyCredentials("admin1", "test-admin1-password", lookup),
    ).resolves.toEqual({ username: "admin1", role: "admin" });
  });

  it("accepts the capitalisation a phone keyboard produces", async () => {
    await expect(
      verifyCredentials(" Kid1 ", "test-kid1-password", lookup),
    ).resolves.toMatchObject({ username: "kid1" });
  });

  it("does not accept another account's password", async () => {
    await expect(
      verifyCredentials("kid1", "test-kid2-password", lookup),
    ).resolves.toBeNull();
  });

  it("returns no hash and no field that could hold one", async () => {
    const account = await verifyCredentials(
      "kid2",
      "test-kid2-password",
      lookup,
    );

    expect(Object.keys(account ?? {}).sort()).toEqual(["role", "username"]);
  });
});

describe("a login that fails tells you nothing about why", () => {
  it("answers a wrong password and an unknown username identically", async () => {
    await expect(
      verifyCredentials("kid2", "wrong", lookup),
    ).resolves.toBeNull();
    await expect(
      verifyCredentials("mallory", "wrong", lookup),
    ).resolves.toBeNull();
  });

  it("does the same work for an unknown username as for a wrong password", async () => {
    await verifyCredentials("kid2", "wrong", lookup);
    const forKnownUser = vi.mocked(verifyPassword).mock.calls.length;

    vi.mocked(verifyPassword).mockClear();
    await verifyCredentials("mallory", "wrong", lookup);
    const forUnknownUser = vi.mocked(verifyPassword).mock.calls.length;

    expect(forKnownUser).toBe(1);
    expect(forUnknownUser).toBe(1);
  });

  it("has one message, and it names neither the user nor the password", () => {
    expect(LOGIN_FAILED_MESSAGE).toBe("Usuário ou senha incorretos.");
    expect(LOGIN_FAILED_MESSAGE.toLowerCase()).not.toContain("não existe");
    expect(LOGIN_FAILED_MESSAGE.toLowerCase()).not.toContain("encontrad");
  });
});

describe("an account without a usable hash authenticates nobody (D45)", () => {
  it("refuses every password when the hash is null", async () => {
    const noHash = lookupIn([
      { username: "kid2", role: "kid", passwordHash: null },
    ]);

    await expect(verifyCredentials("kid2", "", noHash)).resolves.toBeNull();
    await expect(
      verifyCredentials("kid2", "test-kid2-password", noHash),
    ).resolves.toBeNull();
  });

  it("refuses every password when the hash is empty or malformed", async () => {
    for (const passwordHash of [
      "",
      "plain-text",
      "scrypt$1$1$1$$",
      "bcrypt$x",
    ]) {
      const broken = lookupIn([
        { username: "kid2", role: "kid", passwordHash },
      ]);

      await expect(
        verifyCredentials("kid2", passwordHash, broken),
      ).resolves.toBeNull();
    }
  });

  it("refuses an empty password even against a hash of the empty string", async () => {
    const emptyHash = lookupIn([
      { username: "kid2", role: "kid", passwordHash: await hashPassword("") },
    ]);

    await expect(verifyCredentials("kid2", "", emptyHash)).resolves.toBeNull();
  });

  it("still costs one derivation, like every other failure", async () => {
    const noHash = lookupIn([
      { username: "kid2", role: "kid", passwordHash: null },
    ]);
    await verifyCredentials("kid2", "", noHash);

    expect(vi.mocked(verifyPassword)).toHaveBeenCalledTimes(1);
  });
});

describe("a password nobody could have typed", () => {
  const huge = "a".repeat(100_000);

  it("is refused", async () => {
    await expect(verifyCredentials("kid1", huge, lookup)).resolves.toBeNull();
  });

  it("is refused even when it starts with the right password", async () => {
    await expect(
      verifyCredentials(
        "kid1",
        `test-kid1-password${"a".repeat(MAX_PASSWORD_LENGTH)}`,
        lookup,
      ),
    ).resolves.toBeNull();
  });

  it("costs one derivation, over no more than the limit", async () => {
    await verifyCredentials("kid1", huge, lookup);

    expect(vi.mocked(verifyPassword)).toHaveBeenCalledTimes(1);
    const submitted = vi.mocked(verifyPassword).mock.calls[0]?.[0] ?? "";
    expect(submitted.length).toBeLessThanOrEqual(MAX_PASSWORD_LENGTH);
  });

  it("accepts one of exactly the limit", async () => {
    const atLimit = "a".repeat(MAX_PASSWORD_LENGTH);
    const account = lookupIn([
      {
        username: "kid1",
        role: "kid",
        passwordHash: await hashPassword(atLimit),
      },
    ]);

    await expect(
      verifyCredentials("kid1", atLimit, account),
    ).resolves.toMatchObject({ username: "kid1" });
  });
});
