import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { currentSession } from "../../auth/guard";
import { AppShell } from "../../ui/app-shell";

/**
 * One place that says "logged in", inherited by folder. Navigation only: a POST
 * straight at an action meets `requireAccess` (#13).
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
