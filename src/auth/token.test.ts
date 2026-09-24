import { createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  assertUsableSecret,
  issuedAt,
  MIN_SESSION_SECRET_LENGTH,
  SESSION_TTL_DAYS,
  SESSION_TTL_MS,
  signSessionToken,
  verifySessionToken,
} from "./token";

/** A secret that is not the real one, and is never read from anywhere (D23). */
const SECRET = "test-session-secret-not-the-real-one";
const OTHER_SECRET = "another-test-session-secret-entirely";

const NOW = Date.UTC(2026, 8, 2, 12, 0, 0);

describe("the session cookie's validity", () => {
  it("lasts 30 days (#12)", () => {
    expect(SESSION_TTL_DAYS).toBe(30);
    expect(SESSION_TTL_MS).toBe(30 * 24 * 60 * 60 * 1000);
  });

  it("expires exactly 30 days after it was issued", () => {
    const token = issuedAt("kid1", NOW);

    expect(token.expiresAt).toBe(NOW + SESSION_TTL_MS);
  });

  it("is still good one millisecond before the end", () => {
    const value = signSessionToken(issuedAt("kid1", NOW), SECRET);

    expect(
      verifySessionToken(value, SECRET, NOW + SESSION_TTL_MS - 1),
    ).not.toBeNull();
  });

  it("is refused from the expiry instant on", () => {
    const value = signSessionToken(issuedAt("kid1", NOW), SECRET);

    expect(verifySessionToken(value, SECRET, NOW + SESSION_TTL_MS)).toBeNull();
    expect(
      verifySessionToken(value, SECRET, NOW + SESSION_TTL_MS + 1),
    ).toBeNull();
  });
});

describe("a token this app signed", () => {
  it("round-trips the username", () => {
    const value = signSessionToken(issuedAt("kid2", NOW), SECRET);

    expect(verifySessionToken(value, SECRET, NOW)?.username).toBe("kid2");
  });

  it("carries a username and an expiry, and nothing else", () => {
    // No password, obviously — but also no role and no user id. Both are read
    // from the database on every request instead, so a deactivated person is
    // logged out on their next click rather than in thirty days, and a
    // database rebuilt from the seed cannot leave a month-old cookie pointing
    // at a different row.
    const value = signSessionToken(issuedAt("kid2", NOW), SECRET);
    const payload = JSON.parse(
      Buffer.from(value.split(".")[0] ?? "", "base64url").toString("utf8"),
    );

    expect(Object.keys(payload).sort()).toEqual(["expiresAt", "username"]);
  });

  it("is two base64url parts, safe in a cookie value", () => {
    const value = signSessionToken(issuedAt("admin1", NOW), SECRET);

    expect(value.split(".")).toHaveLength(2);
    expect(value).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  });
});

describe("a token this app did not sign", () => {
  it("is refused when the payload was edited", () => {
    // The attack the signature exists for: take Kid1's own valid cookie and
    // rewrite the name in it. Nothing else about the token changes.
    const mine = signSessionToken(issuedAt("kid1", NOW), SECRET);
    const signature = mine.split(".")[1] ?? "";
    const forgedPayload = Buffer.from(
      JSON.stringify({ username: "admin1", expiresAt: NOW + SESSION_TTL_MS }),
      "utf8",
    ).toString("base64url");

    expect(
      verifySessionToken(`${forgedPayload}.${signature}`, SECRET, NOW),
    ).toBeNull();
  });

  it("is refused when the expiry was pushed out", () => {
    const mine = signSessionToken(issuedAt("kid1", NOW), SECRET);
    const signature = mine.split(".")[1] ?? "";
    const forgedPayload = Buffer.from(
      JSON.stringify({
        username: "kid1",
        expiresAt: NOW + SESSION_TTL_MS * 100,
      }),
      "utf8",
    ).toString("base64url");

    expect(
      verifySessionToken(`${forgedPayload}.${signature}`, SECRET, NOW),
    ).toBeNull();
  });

  it("is refused when the signature was edited", () => {
    const value = signSessionToken(issuedAt("kid1", NOW), SECRET);
    const [payload, signature = ""] = value.split(".");
    const flipped = (signature[0] === "A" ? "B" : "A") + signature.slice(1);

    expect(verifySessionToken(`${payload}.${flipped}`, SECRET, NOW)).toBeNull();
  });

  it("is refused when it was signed with a different secret", () => {
    // Which is what rotating SESSION_SECRET does: it logs everyone out at once.
    const value = signSessionToken(issuedAt("kid1", NOW), OTHER_SECRET);

    expect(verifySessionToken(value, SECRET, NOW)).toBeNull();
  });
});

describe("a value that is not a token at all", () => {
  it.each([
    ["an empty string", ""],
    ["a bare word", "kid1"],
    ["one part", "eyJ1c2VybmFtZSI6ImFydGh1ciJ9"],
    ["three parts", "a.b.c"],
    ["an empty signature", "eyJ1c2VybmFtZSI6ImFydGh1ciJ9."],
    ["a signature of the wrong length", "eyJ1c2VybmFtZSI6ImFydGh1ciJ9.AAAA"],
    ["characters base64url cannot hold", "eyJ1c2Vy!!!.AAAA"],
  ])("refuses %s", (_label, value) => {
    expect(verifySessionToken(value, SECRET, NOW)).toBeNull();
  });

  it("refuses a correctly signed payload that is not a session", () => {
    // The signature check passes here and the parse is what has to refuse:
    // `verifySessionToken` returns a typed object, and a caller that trusted a
    // `username` of `undefined` would look up nobody and get whatever the
    // database does with that.
    const payload = Buffer.from(JSON.stringify([1, 2, 3]), "utf8").toString(
      "base64url",
    );
    const signature = createHmac("sha256", SECRET)
      .update(payload, "utf8")
      .digest("base64url");

    expect(
      verifySessionToken(`${payload}.${signature}`, SECRET, NOW),
    ).toBeNull();
  });
});

describe("a secret too short to sign with (#12)", () => {
  // Varlock guarantees the variable exists; nothing guaranteed it was any
  // good. The security review set it to "x" and forged a valid cookie in 26
  // attempts, and set it to "" and watched tokens verify normally.
  const WEAK = ["", "x", "short-secret", "a".repeat(31)];

  it.each(WEAK.map((secret) => ({ length: secret.length, secret })))(
    "refuses to sign with a secret of $length characters",
    ({ secret }) => {
      expect(() => signSessionToken(issuedAt("kid1", NOW), secret)).toThrow(
        /at least 32/,
      );
    },
  );

  it.each(WEAK.map((secret) => ({ length: secret.length, secret })))(
    "refuses to verify with a secret of $length characters",
    ({ secret }) => {
      const value = signSessionToken(issuedAt("kid1", NOW), SECRET);

      // Not `null`: a null here would read as "that cookie is not valid" and
      // the app would sit there asking everyone to log in again, forever.
      expect(() => verifySessionToken(value, secret, NOW)).toThrow(
        /at least 32/,
      );
    },
  );

  it("says what to do about it, and never prints the secret", () => {
    const error = (() => {
      try {
        assertUsableSecret("zzMARKERzz-too-short");
      } catch (thrown) {
        return thrown as Error;
      }

      throw new Error("a 20-character secret was accepted");
    })();

    expect(error.message).toContain("openssl rand -base64 48");
    expect(error.message).toContain("length 20");
    expect(error.message).not.toContain("zzMARKERzz");
  });

  it("refuses one Varlock never resolved, with the same message", () => {
    // `ENV.SESSION_SECRET` is typed `string` and is `undefined` at runtime when
    // Varlock could not read the file — `next dev` prints its report and keeps
    // serving. Against a running instance in that state, the check read
    // `undefined.length` and the deploy saw a TypeError from a minified chunk.
    expect(() =>
      assertUsableSecret(undefined as unknown as string),
    ).toThrowError(/not set[\s\S]*openssl rand/);
  });

  it("accepts one of exactly the minimum length, and the real generator's", () => {
    // `openssl rand -base64 48` produces 64 characters, twice the floor.
    expect(() =>
      assertUsableSecret("a".repeat(MIN_SESSION_SECRET_LENGTH)),
    ).not.toThrow();
    expect(MIN_SESSION_SECRET_LENGTH).toBe(32);
  });
});
