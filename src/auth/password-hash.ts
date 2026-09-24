import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

/*
 * Stored as `scrypt$N$r$p$salt$hash`, salt and hash in base64url. The cost
 * travels with the hash, so raising it later leaves older hashes verifiable.
 */

/** OWASP's scrypt tier with a 16 MiB block: a burst of logins cannot exhaust memory. */
const COST = { N: 2 ** 14, r: 8, p: 5 } as const;
const SALT_BYTES = 16;
const KEY_BYTES = 32;
const PREFIX = "scrypt";

type Parsed = {
  N: number;
  r: number;
  p: number;
  salt: Buffer;
  hash: Buffer;
};

function derive(
  password: string,
  salt: Buffer,
  cost: { N: number; r: number; p: number },
  keyBytes: number,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(
      password,
      salt,
      keyBytes,
      { ...cost, maxmem: 256 * cost.N * cost.r + 1024 * 1024 },
      (error, key) => (error === null ? resolve(key) : reject(error)),
    );
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const hash = await derive(password, salt, COST, KEY_BYTES);

  return [
    PREFIX,
    COST.N,
    COST.r,
    COST.p,
    salt.toString("base64url"),
    hash.toString("base64url"),
  ].join("$");
}

function parse(stored: string): Parsed | null {
  const [prefix, N, r, p, salt, hash, ...rest] = stored.split("$");
  if (prefix !== PREFIX || hash === undefined || rest.length > 0) {
    return null;
  }

  const cost = [N, r, p].map(Number);
  const saltBytes = Buffer.from(salt ?? "", "base64url");
  const hashBytes = Buffer.from(hash, "base64url");
  const positive = cost.every((n) => Number.isSafeInteger(n) && n > 0);
  if (!positive || saltBytes.length === 0 || hashBytes.length === 0) {
    return null;
  }

  return {
    N: cost[0] ?? 0,
    r: cost[1] ?? 0,
    p: cost[2] ?? 0,
    salt: saltBytes,
    hash: hashBytes,
  };
}

/** Same cost as a real hash, so an account without one answers no faster. */
let decoy: Promise<Parsed> | undefined;

function decoyHash(): Promise<Parsed> {
  decoy ??= hashPassword(randomBytes(SALT_BYTES).toString("hex")).then(
    (stored) => parse(stored) as Parsed,
  );

  return decoy;
}

/**
 * `null` or a malformed value is checked against a decoy and never matches:
 * no stored hash means nobody gets in, and it costs one derivation like any other.
 */
export async function verifyPassword(
  password: string,
  stored: string | null,
): Promise<boolean> {
  const parsed = stored === null ? null : parse(stored);
  const target = parsed ?? (await decoyHash());
  // A cost scrypt rejects (N not a power of two) is a bad hash, not a crash.
  const derived = await derive(
    password,
    target.salt,
    target,
    target.hash.length,
  ).catch(() => null);

  return (
    derived !== null && timingSafeEqual(derived, target.hash) && parsed !== null
  );
}
