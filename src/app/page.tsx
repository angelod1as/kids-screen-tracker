import { redirect } from "next/navigation";

import { currentSession } from "../auth/guard";
import { homePathFor } from "../ui/navigation";

export default async function RootPage() {
  const session = await currentSession();

  redirect(session === null ? "/entrar" : homePathFor(session.role));
}
