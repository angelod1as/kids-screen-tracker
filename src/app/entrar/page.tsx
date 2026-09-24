import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { currentSession } from "../../auth/guard";
import { homePathFor } from "../../ui/navigation";
import { BORDER_CLASS, SHELL_CLASS } from "../../ui/style";
import { LoginForm } from "./login-form";

export const metadata: Metadata = {
  title: "Entrar — Quanto Tempo Vale?",
};

/**
 * The only page reachable without a session.
 *
 * Someone who already has one is sent to their own home instead of being shown
 * a form they do not need — the cookie lasts 30 days and the usual way back
 * into the app is a bookmark, so this is the common case, not the edge one.
 */
export default async function LoginPage() {
  const session = await currentSession();
  if (session !== null) {
    redirect(homePathFor(session.role));
  }

  return (
    <div
      className={`${SHELL_CLASS} ${BORDER_CLASS} flex min-h-dvh flex-col justify-center gap-8 border-b-0 border-t-0 bg-white p-6 text-black`}
    >
      <h1 className="text-3xl font-bold">Quanto Tempo Vale?</h1>
      <LoginForm />
    </div>
  );
}
