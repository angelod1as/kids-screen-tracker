import { redirect } from "next/navigation";

import { currentSession } from "../auth/guard";
import { homePathFor } from "../ui/navigation";

/**
 * `/` is a signpost and nothing else: the two roles have different home
 * screens, and which one you get is the first thing the app decides about you.
 */
export default async function RootPage() {
  const session = await currentSession();

  redirect(session === null ? "/entrar" : homePathFor(session.role));
}
