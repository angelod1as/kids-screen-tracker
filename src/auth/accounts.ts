/*
 * No sign-up, no recovery (#12). The accounts live only in the `users` table,
 * written by hand with SQL and never by the app (D45). Pure, so any caller can import it.
 */

export type Role = "admin" | "kid";

export type Account = {
  /** Lowercase, as the `users` row stores it; accents are compared as typed. */
  username: string;
  role: Role;
};

/** What login needs from a `users` row. `null` hash: nobody gets in (D45). */
export type StoredAccount = Account & { passwordHash: string | null };

/**
 * Normalized because a phone keyboard capitalises the first letter. Usernames
 * are not secret; hiding whether one matched is `verifyCredentials`'.
 */
export function normalizeUsername(username: string): string {
  return username.trim().toLowerCase();
}
