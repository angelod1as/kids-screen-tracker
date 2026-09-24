import type { Account, StoredAccount } from "./accounts";
import { normalizeUsername } from "./accounts";
import { verifyPassword } from "./password-hash";

/** Reads one active account by normalized username; `undefined` if there is none. */
export type AccountLookup = (username: string) => StoredAccount | undefined;

/** #12: one message for every failure, so the form cannot list the accounts. */
export const LOGIN_FAILED_MESSAGE = "Usuário ou senha incorretos.";

/**
 * Login is the one endpoint reachable without a cookie, so hashing an
 * attacker's arbitrarily long input is bounded here. Nothing leaks either way.
 */
export const MAX_PASSWORD_LENGTH = 256;

/**
 * Swapped in for an over-long password rather than returning early: every path
 * does one derivation, and `credentials.test.ts` counts them.
 */
const OVERLONG_PASSWORD = "password over the length limit";

/**
 * No early return: an unknown or inactive name and a row without a hash each
 * cost one derivation against a decoy and return the same `null` (D45). An
 * empty password never authenticates, even against a hash of "".
 */
export async function verifyCredentials(
  username: string,
  password: string,
  lookup: AccountLookup,
): Promise<Account | null> {
  const account = lookup(normalizeUsername(username));

  const withinLimit = password.length <= MAX_PASSWORD_LENGTH;
  const submitted = withinLimit ? password : OVERLONG_PASSWORD;

  const passwordMatches = await verifyPassword(
    submitted,
    account?.passwordHash ?? null,
  );

  return account !== undefined &&
    password.length > 0 &&
    withinLimit &&
    passwordMatches
    ? { username: account.username, role: account.role }
    : null;
}
