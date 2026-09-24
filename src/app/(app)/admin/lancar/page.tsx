import { HEADING_CLASS } from "../../../../ui/style";
import { fetchLaunchDataAction } from "../../../actions/admin";
import { listKidsAction } from "../../../actions/people";
import { LaunchForm } from "./launch-form";

/**
 * Launching an activity for a boy (#22).
 *
 * The page fetches and the form draws, the same split the queue uses. Both
 * halves go through admin-only endpoints: a kid who types the URL is bounced by
 * `admin/layout.tsx`, and a kid who sends the POST by hand is refused by the
 * `write` guard inside every action this screen calls (`admin.test.ts` sends
 * it).
 */
export default async function AdminLaunchPage() {
  const [kids, data] = await Promise.all([
    listKidsAction(),
    fetchLaunchDataAction(),
  ]);

  return (
    <section className="flex flex-col gap-4">
      <h1 className={HEADING_CLASS}>Lançar atividade</h1>

      <LaunchForm data={data} kids={kids} />
    </section>
  );
}
