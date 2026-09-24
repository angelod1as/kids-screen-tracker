import { ENV } from "varlock/env";

/*
 * Server-side only: a client read of `ENV` builds fine and kills the process on
 * the first request. The only Varlock reader in `src/auth/`, so the rest takes
 * secrets as arguments (D23); read lazily, so importing is not a read.
 */

export function sessionSecret(): string {
  return ENV.SESSION_SECRET;
}
