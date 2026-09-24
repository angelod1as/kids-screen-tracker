"use server";

import { redirect } from "next/navigation";

import { normalizeUsername } from "../../auth/accounts";
import {
  LOGIN_FAILED_MESSAGE,
  verifyCredentials,
} from "../../auth/credentials";
import { findLoginAccount } from "../../auth/guard";
import { loginThrottle, throttleKey } from "../../auth/login-throttle";
import {
  endSession,
  readDeviceUsername,
  rememberDevice,
  startSession,
} from "../../auth/session";
import { homePathFor } from "../../ui/navigation";
import type { LoginState } from "./login-state";

/**
 * Unguarded: it is how a session begins (`guarded.test.ts` lists it). Every
 * failure, a throttled one included (D48), returns the same message, and nothing
 * is logged: the natural thing to print on a failed login is the password.
 */
export async function loginAction(
  _previous: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const username = String(formData.get("username") ?? "");
  const password = String(formData.get("password") ?? "");

  const normalized = normalizeUsername(username);
  const trusted = (await readDeviceUsername()) === normalized;
  const key = throttleKey(normalized, trusted);
  if (!loginThrottle.begin(key, Date.now())) {
    return { error: LOGIN_FAILED_MESSAGE };
  }

  const account = await verifyCredentials(username, password, findLoginAccount);

  if (account === null) {
    return { error: LOGIN_FAILED_MESSAGE };
  }

  loginThrottle.succeed(key);
  await startSession(account.username);
  await rememberDevice(account.username);

  // Outside the failure branch, so it is never inside a `try` that would
  // swallow the control-flow error `redirect` throws.
  redirect(homePathFor(account.role));
}

/** Unguarded (`guarded.test.ts` lists it): a forged call can only log out its own sender. */
export async function logoutAction(): Promise<void> {
  await endSession();

  redirect("/entrar");
}
