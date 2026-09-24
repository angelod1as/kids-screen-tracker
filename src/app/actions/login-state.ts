/**
 * What the login form gets back from `loginAction`.
 *
 * In its own module and not next to the action, because a `"use server"` file
 * may only export async functions — Next refuses the build outright with
 * `A "use server" file can only export async functions, found object`, since
 * every export of such a file becomes a callable endpoint and a plain object
 * cannot be one. The type would have been erased, but `EMPTY_LOGIN_STATE` is a
 * value.
 *
 * There is no `username` field here and no `password` field either: this value
 * is serialised into the page, so anything put in it is a value the browser
 * receives. The form keeps what was typed in the username box in client state
 * instead — see `LoginForm`, and note that "keeps it on its own, uncontrolled"
 * was the earlier claim here and was false: React 19 resets an uncontrolled
 * form once the action finishes, and the measured value after a failed login
 * was the empty string.
 */
export type LoginState = {
  error: string | null;
};

export const EMPTY_LOGIN_STATE: LoginState = { error: null };
