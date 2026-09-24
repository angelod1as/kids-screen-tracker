import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { currentSession } from "../../../auth/guard";
import { homePathFor } from "../../../ui/navigation";

/** An admin is sent to `/admin`: these screens read `session.userId`, and he has no balance of his own. */
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
