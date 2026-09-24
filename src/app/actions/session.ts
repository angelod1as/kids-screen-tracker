"use server";

import { redirect } from "next/navigation";

import {
  LOGIN_FAILED_MESSAGE,
  verifyCredentials,
} from "../../auth/credentials";
import { findLoginAccount } from "../../auth/guard";
import { endSession, startSession } from "../../auth/session";
import { homePathFor } from "../../ui/navigation";
import type { LoginState } from "./login-state";

/**
 * The login endpoint (#12).
 *
 * Unguarded on purpose, and the only such action in the app: it is how a
 * session begins, so there is nothing to check yet. `guarded.test.ts` holds a
 * list of the exceptions and this is one of the two on it.
 *
 * Everything that can go wrong returns the same `LOGIN_FAILED_MESSAGE` and
 * nothing else — wrong password, unknown username, an account with no password
 * hash (D45), and one that has been deactivated (D14). Nothing is logged: a
 * `console.error` on a failed login is the classic way a password ends up in a
 * container log, because the natural thing to print is "the input that failed".
 */
export async function loginAction(
  _previous: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const username = String(formData.get("username") ?? "");
  const password = String(formData.get("password") ?? "");

  const account = await verifyCredentials(username, password, findLoginAccount);

  if (account === null) {
    return { error: LOGIN_FAILED_MESSAGE };
  }

  await startSession(account.username);

  // Outside the failure branch, so it is never inside a `try` that would
  // swallow the control-flow error `redirect` throws.
  redirect(homePathFor(account.role));
}

/**
 * Logout (#12). Deletes the cookie and sends the browser to the login screen.
 *
 * Unguarded, and the second and last entry on `guarded.test.ts`'s list: there
 * is nothing to protect. It reads nothing and writes nothing but the caller's
 * own cookie, so the worst a forged call can do is log its own sender out.
 *
 * On what "invalidates" means for a stateless token, see `endSession`.
 */
export async function logoutAction(): Promise<void> {
  await endSession();

  redirect("/entrar");
}
