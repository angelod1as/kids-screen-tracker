import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { currentSession } from "../../auth/guard";
import { homePathFor } from "../../ui/navigation";
import { BORDER_CLASS, SHELL_CLASS } from "../../ui/style";
import { LoginForm } from "./login-form";

export const metadata: Metadata = {
  title: "Entrar — Quanto Tempo Vale?",
};

/** The only page without a session. A logged-in visitor goes home: the cookie lasts 30 days. */
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
