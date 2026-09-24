import { randomBytes, scryptSync } from "node:crypto";

import { describe, expect, it } from "vitest";

import { hashPassword, verifyPassword } from "./password-hash";

describe("hashPassword", () => {
  it("writes scrypt with its cost, a salt and a 32-byte key", async () => {
    const [prefix, N, r, p, salt, hash, ...rest] = (
      await hashPassword("secret")
    ).split("$");

    expect([prefix, N, r, p]).toEqual(["scrypt", "16384", "8", "5"]);
    expect(Buffer.from(salt ?? "", "base64url")).toHaveLength(16);
    expect(Buffer.from(hash ?? "", "base64url")).toHaveLength(32);
    expect(rest).toEqual([]);
  });

  it("salts each hash, so one password never hashes the same twice", async () => {
    expect(await hashPassword("secret")).not.toBe(await hashPassword("secret"));
  });

  it("never contains the password", async () => {
    expect(await hashPassword("zzMARKERzz")).not.toContain("zzMARKERzz");
  });
});

describe("verifyPassword", () => {
  it("accepts the password the hash was made from, and nothing else", async () => {
    const stored = await hashPassword("secret");

    expect(await verifyPassword("secret", stored)).toBe(true);
    expect(await verifyPassword("Secret", stored)).toBe(false);
    expect(await verifyPassword("secret ", stored)).toBe(false);
    expect(await verifyPassword("", stored)).toBe(false);
  });

  it("verifies a hash made at another cost, so the cost can change later", async () => {
    const salt = randomBytes(16);
    const key = scryptSync("secret", salt, 32, { N: 1024, r: 8, p: 1 });
    const stored = [
      "scrypt",
      1024,
      8,
      1,
      salt.toString("base64url"),
      key.toString("base64url"),
    ].join("$");

    expect(await verifyPassword("secret", stored)).toBe(true);
    expect(await verifyPassword("other", stored)).toBe(false);
  });

  it("matches nothing when there is no hash or it is malformed", async () => {
    for (const stored of [
      null,
      "",
      "secret",
      "scrypt$16384$8$5$$",
      "scrypt$0$8$5$c2FsdA$aGFzaA",
      "scrypt$x$8$5$c2FsdA$aGFzaA",
      "scrypt$1000$8$5$c2FsdA$aGFzaA",
      "argon2$16384$8$5$c2FsdA$aGFzaA",
    ]) {
      expect(await verifyPassword("secret", stored)).toBe(false);
    }
  });
});
