import { HEADING_CLASS } from "../../../../ui/style";
import { listKidsAction } from "../../../actions/people";
import { ReleaseForm } from "./release-form";

export default async function AdminReleasePage({
  searchParams,
}: {
  searchParams: Promise<{ menino?: string | string[] }>;
}) {
  const [kids, { menino }] = await Promise.all([
    listKidsAction(),
    searchParams,
  ]);
  // The history shortcut names the boy; an unknown id falls back to the first.
  const initialUserId = kids.find((kid) => String(kid.id) === menino)?.id;

  return (
    <section className="flex flex-col gap-4 lg:max-w-2xl">
      <h1 className={HEADING_CLASS}>Tirar horas</h1>

      <ReleaseForm initialUserId={initialUserId} kids={kids} />
    </section>
  );
}
