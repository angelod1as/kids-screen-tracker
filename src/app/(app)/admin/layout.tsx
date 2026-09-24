import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { currentSession } from "../../../auth/guard";
import { homePathFor } from "../../../ui/navigation";

/** Navigation only: every action these screens call refuses a kid too (#13). */
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
