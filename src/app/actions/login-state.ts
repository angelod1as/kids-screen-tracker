/**
 * Outside the action because a `"use server"` file may only export async
 * functions. No `username`: this value is serialised into the page.
 */
export type LoginState = {
  error: string | null;
};

export const EMPTY_LOGIN_STATE: LoginState = { error: null };
