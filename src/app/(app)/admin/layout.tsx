import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { currentSession } from "../../../auth/guard";
import { homePathFor } from "../../../ui/navigation";

/**
 * `/admin/*` is for Admin1 and Admin2.
 *
 * A kid who types the URL is sent back to his own home. This is the navigation
 * half of the rule and the cheap half — the half that matters is that every
 * action these screens call refuses him too (#13).
 */
export default async function AdminLayout({
  children,
}: {
  children: ReactNode;
}) {
  const session = await currentSession();
  if (session === null) {
    redirect("/entrar");
  }
  if (session.role !== "admin") {
    redirect(homePathFor(session.role));
  }

  return children;
}
