import { HEADING_CLASS } from "../../../../ui/style";
import { listKidsAction } from "../../../actions/people";
import { ReleaseForm } from "./release-form";

export default async function AdminReleasePage() {
  const kids = await listKidsAction();

  return (
    <section className="flex flex-col gap-4">
      <h1 className={HEADING_CLASS}>Liberar horas</h1>

      <ReleaseForm kids={kids} />
    </section>
  );
}
