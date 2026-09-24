import { HEADING_CLASS } from "../../../../ui/style";
import { fetchLaunchDataAction } from "../../../actions/admin";
import { listKidsAction } from "../../../actions/people";
import { LaunchForm } from "./launch-form";

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
