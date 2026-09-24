import { HEADING_CLASS } from "../../../../ui/style";
import { listKidsAction } from "../../../actions/people";
import { ReleaseForm } from "./release-form";

/**
 * Releasing hours onto the devices (#23).
 *
 * The page fetches and the form draws. A kid who types the URL is bounced by
 * `admin/layout.tsx`; a kid who sends the POST by hand is refused by the
 * `write` guard inside `releaseHoursAction` (`admin.test.ts` sends it).
 */
export default async function AdminReleasePage() {
  const kids = await listKidsAction();

  return (
    <section className="flex flex-col gap-4">
      <h1 className={HEADING_CLASS}>Liberar horas</h1>

      <ReleaseForm kids={kids} />
    </section>
  );
}
