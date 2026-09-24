import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { currentSession } from "../../auth/guard";
import { AppShell } from "../../ui/app-shell";

/**
 * Everything behind a login lives under this group.
 *
 * The route group `(app)` adds no path segment: `/menino` and `/admin` are the
 * URLs. What it adds is one place where "you have to be logged in" is written,
 * so a page added later inherits it by being put in the right folder rather
 * than by remembering a line.
 *
 * This is navigation, not the guard. It stops a browser without a cookie from
 * *rendering* a screen; it does nothing about a POST straight at a server
 * action, which is what `requireAccess` inside each action is for (#13).
 */
export default async function AuthenticatedLayout({
  children,
}: {
  children: ReactNode;
}) {
  const session = await currentSession();
  if (session === null) {
    redirect("/entrar");
  }

  return <AppShell session={session}>{children}</AppShell>;
}
