import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { currentSession } from "../../../auth/guard";
import { homePathFor } from "../../../ui/navigation";

/**
 * `/menino/*` shows the logged-in boy his own data, so it is for kids.
 *
 * An admin arriving here is sent to the admin home rather than shown an error:
 * these screens read `session.userId`, and an admin has no balance, no history
 * and no timer of his own. He sees both boys from `/admin` (#21), which is
 * where the rule "admin vê tudo dos dois" is actually served.
 */
export default async function KidLayout({ children }: { children: ReactNode }) {
  const session = await currentSession();
  if (session === null) {
    redirect("/entrar");
  }
  if (session.role !== "kid") {
    redirect(homePathFor(session.role));
  }

  return children;
}
